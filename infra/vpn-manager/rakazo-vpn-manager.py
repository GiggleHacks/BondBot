#!/usr/bin/env python3
"""Host-side multi-tunnel WireGuard VPN manager for Rakazo bot computers.

Manages one WireGuard interface per .conf file in RAKAZO_VPN_PROFILES_DIR and applies
per-bridge (rakazo-c<hash>) fwmark routing + optional per-bridge fail-closed kill-switch
rules in iptables without interrupting host traffic or restarting containers.

Profiles come from two places: files the operator drops into the folder (shared by every
Space) and files people upload in the app (POST /profiles), which are written next to them
with a <id>.json sidecar naming the Space that owns them. Private keys never leave this host.

Serves:
  - Unix socket (RAKAZO_VPN_SOCK) for rakazo-supervisor
  - Local read-only HTTP dashboard on 127.0.0.1:5174
"""

from __future__ import annotations

import concurrent.futures
import glob
import hashlib
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer

# The sibling modules ship beside this file. A root daemon on a boot drive leaves no bytecode there.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rakazo_vpn_http  # noqa: E402
from rakazo_vpn_http import (  # noqa: E402,F401
    ApiHandler,
    TcpApiHandler,
    ThreadingUnixStreamServer,
    render_dashboard_html,
)
from rakazo_vpn_profiles import (  # noqa: E402,F401
    COUNTRY_NAMES,
    MAX_CONFIG_BYTES,
    OWNER_RE,
    clean_name,
    label_from_text,
    log,
    meta_path_for,
    parse_profile_file,
    parse_trace,
    read_meta,
    valid_country,
    validate_config,
    with_keepalive,
    write_private,
)

PROFILES_DIR = os.environ.get("RAKAZO_VPN_PROFILES_DIR", "/boot/config/wireguard/rakazo-profiles")
STATE_PATH = os.environ.get("RAKAZO_VPN_STATE_PATH", "/boot/config/rakazo-vpn-state.json")
SOCK_PATH = os.environ.get("RAKAZO_VPN_SOCK", "/var/run/rakazo-vpn/vpn.sock")
HTTP_PORT = int(os.environ.get("RAKAZO_VPN_HTTP_PORT", "5174"))
# Host headers the TCP dashboard answers to. Anything else (DNS rebinding, a proxy
# in front) is refused; add e.g. the tailscale serve name via RAKAZO_VPN_ALLOWED_HOSTS.
ALLOWED_HOSTS = {f"127.0.0.1:{HTTP_PORT}", f"localhost:{HTTP_PORT}"} | {
    h.strip().lower() for h in os.environ.get("RAKAZO_VPN_ALLOWED_HOSTS", "").split(",") if h.strip()
}

# tailscale serve forwards the tailnet name as the Host header (e.g. cccbox.<tailnet>.ts.net[:port]).
TAILSCALE_HOST_RE = re.compile(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d+)?")

MANGLE_CHAIN = "RAKAZO-VPN-MANGLE"
KS_CHAIN = "RAKAZO-VPN-KS"
RULE_PRIO = "100"
IPT = ["iptables", "-w"]
IPT6 = ["ip6tables", "-w"]
STALE_AFTER = 180
STARTUP_GRACE = 25
TRACE_URL = "https://1.1.1.1/cdn-cgi/trace"
# wg-quick only reads a file whose name is a valid interface name: 15 characters at most.
UPLOAD_ID_RE = re.compile(r"^vpn-[a-f0-9]{10}\Z")


# \Z, not $: "$" would also accept a trailing newline.
BRIDGE_RE = re.compile(r"^rakazo-c[a-f0-9]{7}\Z")
BOT_CONTAINER_RE = re.compile(r"^rakazo-bot-([a-z0-9-]+)$")

LOCK = threading.RLock()
STATE: dict[str, dict] = {"bridges": {}}
PROFILES: dict[str, dict] = {}
PROBE_CACHE: dict[str, dict] = {}
# Local change 2026-11-21 (David): one failed internet check no longer flips a computer to "blocked".
# The last good result is kept until FAIL_TOLERANCE checks in a row fail. Tunnel health is unaffected:
# a down tunnel still shows blocked at once, and the kill switch (iptables) is untouched.
PROBE_FAILS: dict[str, int] = {}
LAST_GOOD: dict[str, dict] = {}
LAST_RUNNING: dict[str, str] = {}
FAIL_TOLERANCE = 3
LAST_GOOD_MAX_AGE = 120
HOST_IP_CACHE: dict[str, object] = {"ip": None, "country": None, "at": 0.0}
STARTED_AT = time.time()


def sh(args: list[str], timeout: int = 12, input_text: str | None = None) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            args,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except Exception as exc:
        return 1, "", str(exc)


def bridge_for_home_key(home_key: str) -> str:
    return "rakazo-c" + hashlib.sha256(home_key.encode("utf-8")).hexdigest()[:7]


def load_profiles() -> dict[str, dict]:
    used_tables: set[int] = set()
    used_marks: set[int] = set()
    loaded: dict[str, dict] = {}
    if not os.path.isdir(PROFILES_DIR):
        return loaded
    for path in sorted(glob.glob(os.path.join(PROFILES_DIR, "*.conf"))):
        try:
            p = parse_profile_file(path, used_tables, used_marks)
        except Exception as exc:
            log(f"skipping unreadable profile {path}: {exc}")
            continue
        loaded[p["id"]] = p
    return loaded


def read_state_file(path: str) -> dict[str, dict]:
    """Parse one state file; raises if it is unreadable or not a state document."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    bridges = data["bridges"]
    if not isinstance(bridges, dict):
        raise ValueError("bridges is not an object")
    clean: dict[str, dict] = {}
    for bridge, cfg in bridges.items():
        if not BRIDGE_RE.fullmatch(bridge) or not isinstance(cfg, dict):
            continue
        profile = cfg.get("profile")
        locked = bool(cfg.get("locked", False)) and bool(profile)
        clean[bridge] = {
            "profile": str(profile) if profile else None,
            "locked": locked,
        }
    return {"bridges": clean}


def load_state() -> dict[str, dict]:
    # A damaged state file must never turn into "no locks": fall back to the previous copy.
    failed = False
    for path in (STATE_PATH, f"{STATE_PATH}.bak"):
        if not os.path.exists(path):
            continue
        try:
            state = read_state_file(path)
        except Exception as exc:
            failed = True
            log(f"state file {path} is unusable: {exc}")
            continue
        if path != STATE_PATH:
            log(f"using backup state {path}")
        return state
    if failed:
        log("ERROR: no usable state file, starting with NO locked bridges; reconcile from the API to restore them")
        try:
            os.replace(STATE_PATH, f"{STATE_PATH}.corrupt")
        except OSError:
            pass
    return {"bridges": {}}


def save_state() -> None:
    tmp = f"{STATE_PATH}.tmp"
    bak = f"{STATE_PATH}.bak"
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    # Keep the previous good state as .bak (never overwrite it with a damaged file).
    try:
        read_state_file(STATE_PATH)
        with open(STATE_PATH, "rb") as src, open(f"{bak}.tmp", "wb") as dst:
            dst.write(src.read())
            dst.flush()
            os.fsync(dst.fileno())
        os.replace(f"{bak}.tmp", bak)
    except Exception:
        pass
    os.replace(tmp, STATE_PATH)


def cleanup_legacy_single_tunnel() -> None:
    # Tear down the old single-tunnel wgrk setup cleanly if present.
    while sh([*IPT, "-t", "mangle", "-D", "PREROUTING", "-i", "rakazo-c+", "-j", "MARK", "--set-mark", "0x7100"])[0] == 0:
        pass
    while sh([*IPT, "-t", "nat", "-D", "POSTROUTING", "-o", "wgrk", "-j", "MASQUERADE"])[0] == 0:
        pass
    while sh([*IPT, "-t", "mangle", "-D", "FORWARD", "-o", "wgrk", "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] == 0:
        pass
    while sh(["ip", "rule", "del", "fwmark", "0x7100", "lookup", "7100", "priority", RULE_PRIO])[0] == 0:
        pass
    sh(["ip", "route", "flush", "table", "7100"])
    sh(["ip", "link", "del", "wgrk"])


def ensure_tunnel_up(profile: dict) -> None:
    iface = profile["iface"]
    table = str(profile["table"])
    mark = profile["markHex"]
    conf = profile["path"]
    addr = profile["addrV4"]
    if not addr:
        raise RuntimeError(f"Profile {profile['id']} missing IPv4 Address")

    rc, stripped, err = sh(["wg-quick", "strip", conf])
    if rc != 0 or not stripped:
        raise RuntimeError(f"wg-quick strip failed for {conf}: {err}")
    stripped = with_keepalive(stripped)

    # Recreate cleanly if missing; if already present, update wg conf in place.
    rc_link, _, _ = sh(["ip", "link", "show", "dev", iface])
    if rc_link != 0:
        rc, _, err = sh(["ip", "link", "add", iface, "type", "wireguard"])
        if rc != 0:
            raise RuntimeError(f"ip link add {iface} failed: {err}")

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=True) as tf:
        tf.write(stripped + "\n")
        tf.flush()
        rc, _, err = sh(["wg", "setconf", iface, tf.name])
    if rc != 0:
        sh(["ip", "link", "del", iface])
        raise RuntimeError(f"wg setconf {iface} failed: {err}")

    sh(["ip", "addr", "flush", "dev", iface])
    rc, _, err = sh(["ip", "addr", "add", addr, "dev", iface])
    if rc != 0:
        raise RuntimeError(f"ip addr add {addr} dev {iface} failed: {err}")
    rc, _, err = sh(["ip", "link", "set", iface, "mtu", "1420", "up"])
    if rc != 0:
        raise RuntimeError(f"ip link set {iface} up failed: {err}")
    sh(["sysctl", "-qw", f"net.ipv4.conf.{iface}.rp_filter=2"])

    rc, _, err = sh(["ip", "route", "replace", "blackhole", "default", "table", table, "metric", "4000"])
    if rc != 0:
        raise RuntimeError(f"ip route blackhole table {table} failed: {err}")
    rc, _, err = sh(["ip", "route", "replace", "default", "dev", iface, "table", table])
    if rc != 0:
        raise RuntimeError(f"ip route default dev {iface} table {table} failed: {err}")
    # Any rule left for this mark or table (a profile removed, or numbers that moved after a
    # restart) would steer traffic into the wrong tunnel, so clear both before adding ours.
    clear_rules(mark, table)
    rc, _, err = sh(["ip", "rule", "add", "fwmark", f"{mark}/0xffff", "lookup", table, "priority", RULE_PRIO])
    if rc != 0:
        raise RuntimeError(f"ip rule add fwmark {mark} table {table} failed: {err}")

    if sh([*IPT, "-t", "nat", "-C", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])[0] != 0:
        rc, _, err = sh([*IPT, "-t", "nat", "-A", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])
        if rc != 0:
            raise RuntimeError(f"iptables MASQUERADE for {iface} failed: {err}")
    if sh([*IPT, "-t", "mangle", "-C", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] != 0:
        rc, _, err = sh([*IPT, "-t", "mangle", "-A", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])
        if rc != 0:
            log(f"TCPMSS clamp for {iface} failed: {err}")


def clear_rules(mark: str, table: str) -> None:
    for selector in (["fwmark", f"{mark}/0xffff"], ["lookup", table]):
        for _ in range(64):
            if sh(["ip", "rule", "del", *selector, "priority", RULE_PRIO])[0] != 0:
                break


def teardown_tunnel(profile: dict) -> None:
    """Undo ensure_tunnel_up for a profile that is being removed."""
    iface = profile["iface"]
    clear_rules(profile["markHex"], str(profile["table"]))
    sh(["ip", "route", "flush", "table", str(profile["table"])])
    while sh([*IPT, "-t", "nat", "-D", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])[0] == 0:
        pass
    while sh([*IPT, "-t", "mangle", "-D", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] == 0:
        pass
    sh(["ip", "link", "del", iface])


class ProfileInUse(Exception):
    pass


def add_profile(config: object, name: object, owner: object) -> dict:
    """Store an uploaded file, bring its tunnel up and return what callers may see of it."""
    if not isinstance(owner, str) or not OWNER_RE.fullmatch(owner):
        raise ValueError("owner is required")
    text = validate_config(config)
    label = clean_name(name)
    with LOCK:
        pid = f"vpn-{secrets.token_hex(5)}"
        while pid in PROFILES:
            pid = f"vpn-{secrets.token_hex(5)}"
        os.makedirs(PROFILES_DIR, mode=0o700, exist_ok=True)
        conf_path = os.path.join(PROFILES_DIR, f"{pid}.conf")
        meta = {"name": label, "owner": owner, "createdAt": int(time.time())}
        write_private(meta_path_for(conf_path), json.dumps(meta))
        write_private(conf_path, text)
        prof = None
        try:
            prof = parse_profile_file(
                conf_path,
                {p["table"] for p in PROFILES.values()},
                {p["mark"] for p in PROFILES.values()},
            )
            rc, _, err = sh(["wg-quick", "strip", conf_path])
            if rc != 0:
                raise ValueError("This WireGuard file could not be read. Download it from your VPN again.")
            ensure_tunnel_up(prof)
        except Exception:
            if prof:
                teardown_tunnel(prof)
            for path in (conf_path, meta_path_for(conf_path)):
                try:
                    os.unlink(path)
                except OSError:
                    pass
            raise
        PROFILES[pid] = prof
        log(f"profile {pid} added for {owner}")
        return profile_public(prof)


def remove_profile(pid: str, owner: object) -> None:
    with LOCK:
        prof = PROFILES.get(pid)
        if not prof:
            raise ValueError(f"Unknown VPN profile: {pid}")
        if not prof.get("owner"):
            raise ValueError("This VPN file was added on the server. Remove it from the server's VPN folder.")
        if owner != prof["owner"]:
            raise ValueError(f"Unknown VPN profile: {pid}")
        if any(cfg.get("profile") == pid for cfg in STATE["bridges"].values()):
            raise ProfileInUse("A bot still uses this VPN. Give it another VPN first.")
        teardown_tunnel(prof)
        for path in (prof["path"], meta_path_for(prof["path"])):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
        PROFILES.pop(pid, None)
        log(f"profile {pid} removed")


def trace_through(iface: str, max_time: int) -> tuple[str | None, str | None, int | None]:
    """One request out of the tunnel: where it came out, and the TCP round trip in ms."""
    rc, out, _ = sh(
        ["curl", "-4", "-s", "--max-time", str(max_time), "--interface", iface,
         "-w", "\ntime_connect=%{time_connect}\n", TRACE_URL],
        timeout=max_time + 4,
    )
    if rc != 0 or not out:
        return None, None, None
    exit_ip, exit_country = parse_trace(out)
    m = re.search(r"^time_connect=([0-9]+(?:\.[0-9]+)?)$", out, re.MULTILINE)
    seconds = float(m.group(1)) if m else 0.0
    return exit_ip, exit_country, max(1, round(seconds * 1000)) if seconds > 0 else None


def test_profile(pid: str) -> dict:
    """Send one request through the tunnel and say whether it came out somewhere else.

    result: "connected", "no_handshake" (the server never answered: an old, revoked or
    mistyped file), "no_internet" (the server answered but nothing got through) or
    "not_private" (the request left from this host's own address).
    """
    with LOCK:
        prof = PROFILES.get(pid)
        if not prof:
            raise ValueError(f"Unknown VPN profile: {pid}")
        prof = dict(prof)
    if sh(["ip", "link", "show", "dev", prof["iface"]])[0] != 0:
        with LOCK:
            ensure_tunnel_up(prof)
    host_ip, _ = refresh_host_ip()
    exit_ip, exit_country, latency = trace_through(prof["iface"], 8)
    if exit_ip:
        # The first request may have waited for the tunnel's handshake: keep the quicker one.
        again = trace_through(prof["iface"], 4)[2]
        latency = min((ms for ms in (latency, again) if ms is not None), default=None)
    status = collect_tunnel_statuses([prof])[0]
    if exit_ip and host_ip and exit_ip == host_ip:
        result = "not_private"
    elif exit_ip:
        result = "connected"
    elif status["handshakeAgeSec"] is None:
        result = "no_handshake"
    else:
        result = "no_internet"

    if result == "connected" and exit_country and prof["countryCode"] == "UN" and prof.get("owner"):
        # The file did not say where it goes: remember where the test came out.
        with LOCK:
            live = PROFILES.get(pid)
            if live:
                meta = read_meta(live["path"])
                meta["countryCode"] = exit_country
                try:
                    write_private(meta_path_for(live["path"]), json.dumps(meta))
                except OSError as exc:
                    log(f"could not save the country of {pid}: {exc}")
                live["countryCode"] = exit_country
                live["countryName"] = COUNTRY_NAMES.get(exit_country, exit_country)
                prof = dict(live)
    return {
        "profile": {**profile_public(prof), "up": status["up"], "handshakeAgeSec": status["handshakeAgeSec"]},
        "result": result,
        "exitIp": exit_ip if result == "connected" else None,
        "exitCountry": exit_country if result == "connected" else None,
        "latencyMs": latency if result == "connected" else None,
    }


def tunnel_status(profile: dict) -> dict:
    iface = profile["iface"]
    rc, out, _ = sh(["wg", "show", iface, "latest-handshakes"])
    age = None
    if rc == 0 and out:
        parts = out.split()
        try:
            ts = int(parts[-1])
            if ts > 0:
                age = max(0, int(time.time() - ts))
        except ValueError:
            age = None

    _, ep_out, _ = sh(["wg", "show", iface, "endpoints"])
    endpoint = ep_out.split()[-1] if ep_out else None

    rc_link, link_out, _ = sh(["ip", "link", "show", "dev", iface])
    link_up = rc_link == 0 and "UP" in link_out

    if not link_up:
        up = False
    elif age is not None:
        up = age < STALE_AFTER
    else:
        # Allow a brief window right after interface creation for initial handshake.
        up = (time.time() - STARTED_AT) < STARTUP_GRACE

    return {
        **profile_public(profile),
        "up": up,
        "handshakeAgeSec": age,
        "endpoint": endpoint,
    }


def profile_public(profile: dict) -> dict:
    """What callers may see of a profile: never its path, key or routing numbers."""
    return {
        "id": profile["id"],
        "name": profile.get("name") or profile["id"],
        "owner": profile.get("owner"),
        "countryCode": profile["countryCode"],
        "countryName": profile["countryName"],
        "serverLabel": profile["serverLabel"],
        "iface": profile["iface"],
    }


_DEFAULT_TUNNEL_STATUS = tunnel_status


def collect_tunnel_statuses(profiles: list[dict]) -> list[dict]:
    """Query all WireGuard tunnels in 2 batched commands instead of 3*N, outside LOCK."""
    if not profiles:
        return []
    if tunnel_status is not _DEFAULT_TUNNEL_STATUS:
        return [tunnel_status(p) for p in profiles]

    rc_wg, wg_out, _ = sh(["wg", "show", "all", "dump"], timeout=8)
    rc_link, link_out, _ = sh(["ip", "link", "show"], timeout=8)
    if rc_wg != 0 or rc_link != 0:
        return [tunnel_status(p) for p in profiles]

    handshakes: dict[str, int] = {}
    endpoints: dict[str, str] = {}
    for line in wg_out.splitlines():
        cols = line.split("\t")
        # Peer rows have 9 tab-separated fields: iface, pubkey, psk, endpoint, allowed-ips, handshake, rx, tx, keepalive
        if len(cols) >= 6:
            iface = cols[0]
            ep = cols[3]
            if ep and ep != "(none)":
                endpoints[iface] = ep
            try:
                ts = int(cols[5])
                if ts > 0:
                    handshakes[iface] = max(handshakes.get(iface, 0), ts)
            except ValueError:
                pass

    up_ifaces: set[str] = set()
    for line in link_out.splitlines():
        m = re.match(r"^\d+:\s+([^:@\s]+)(?:@[^:\s]+)?:\s+<([^>]*)>", line)
        if m and "UP" in m.group(2).split(","):
            up_ifaces.add(m.group(1))

    now = time.time()
    out: list[dict] = []
    for profile in profiles:
        iface = profile["iface"]
        ts = handshakes.get(iface)
        age = max(0, int(now - ts)) if ts else None
        link_up = iface in up_ifaces
        if not link_up:
            up = False
        elif age is not None:
            up = age < STALE_AFTER
        else:
            up = (now - STARTED_AT) < STARTUP_GRACE
        out.append({
            **profile_public(profile),
            "up": up,
            "handshakeAgeSec": age,
            "endpoint": endpoints.get(iface),
        })
    return out


def ensure_jump(base: list[str], chain: str, jump: str) -> None:
    """Keep exactly one `-i rakazo-c+ -j <jump>` rule at the top of `chain`.

    The new rule goes in before any stale copy is deleted (by index), so the jump is never absent.
    """
    wanted = f"-A {chain} -i rakazo-c+ -j {jump}"
    rc, out, err = sh([*base, "-S", chain])
    if rc != 0:
        raise RuntimeError(f"{base[0]} -S {chain} failed: {err}")
    rules = [l.strip() for l in out.splitlines() if l.strip().startswith(f"-A {chain} ")]
    hits = [i for i, l in enumerate(rules, 1) if l == wanted]
    if not hits or hits[0] != 1:
        rc, _, err = sh([*base, "-I", chain, "1", "-i", "rakazo-c+", "-j", jump])
        if rc != 0:
            raise RuntimeError(f"{base[0]} -I {chain} failed: {err}")
        hits = [1] + [h + 1 for h in hits]
    for idx in reversed(hits[1:]):
        rc, _, err = sh([*base, "-D", chain, str(idx)])
        if rc != 0:
            raise RuntimeError(f"{base[0]} -D {chain} {idx} failed: {err}")


def ensure_forward_hook_position() -> None:
    """Keep the jumps to RAKAZO-VPN-KS / RAKAZO-VPN-MANGLE at rule #1 (above DOCKER-FORWARD) and block IPv6."""
    ensure_jump(IPT, "FORWARD", KS_CHAIN)
    ensure_jump([*IPT, "-t", "mangle"], "PREROUTING", MANGLE_CHAIN)
    try:
        ensure_jump(IPT6, "FORWARD", "DROP")
    except RuntimeError as exc:
        # Hosts without usable ip6tables never carried IPv6 for the computers; do not block IPv4 policy on it.
        log(f"ipv6 FORWARD drop not ensured: {exc}")


def restore_table(payload: str) -> None:
    """Apply one table's rules in a single atomic iptables-restore transaction (only declared chains are touched)."""
    rc, _, err = sh(["iptables-restore", "-w", "--noflush"], timeout=20, input_text=payload)
    if rc != 0:
        raise RuntimeError(f"iptables-restore failed (rc={rc}), previous rules kept: {err}")


def build_policy_payloads(tunnels: dict[str, dict]) -> tuple[str, str]:
    """iptables-restore payloads (filter, mangle) for RAKAZO-VPN-KS and RAKAZO-VPN-MANGLE from STATE + tunnel health."""
    mangle_rules: list[str] = []
    ks_rules = [f"-A {KS_CHAIN} -o rakazo-c+ -j RETURN"]

    for bridge, cfg in sorted(STATE["bridges"].items()):
        if not BRIDGE_RE.fullmatch(bridge):
            continue
        pid = cfg.get("profile")
        locked = bool(cfg.get("locked", False))
        prof = PROFILES.get(pid) if pid else None
        t_info = tunnels.get(pid) if pid else None

        if prof and (locked or (t_info and t_info["up"])):
            mangle_rules.append(
                f"-A {MANGLE_CHAIN} -i {bridge} -j MARK --set-xmark {prof['markHex']}/0xffff"
            )

        if locked:
            if prof:
                ks_rules.append(f"-A {KS_CHAIN} -i {bridge} -o {prof['iface']} -j RETURN")
            ks_rules.append(f"-A {KS_CHAIN} -i {bridge} -j DROP")

    def table(name: str, chain: str, rules: list[str]) -> str:
        return "\n".join([f"*{name}", f":{chain} - [0:0]", f"-F {chain}", *rules, "COMMIT"]) + "\n"

    return table("filter", KS_CHAIN, ks_rules), table("mangle", MANGLE_CHAIN, mangle_rules)


def apply_iptables_policies() -> dict[str, dict]:
    """Rewrite RAKAZO-VPN-MANGLE and RAKAZO-VPN-KS from STATE + tunnel health, one atomic restore per table.

    Raises RuntimeError if a table could not be applied; that table then keeps its previous rules.
    """
    with LOCK:
        profile_list = list(PROFILES.values())
    tunnel_list = collect_tunnel_statuses(profile_list)
    tunnels = {t["id"]: t for t in tunnel_list}
    with LOCK:
        filter_payload, mangle_payload = build_policy_payloads(tunnels)

        # Kill switch first: a newly locked bridge is dropped before its traffic is marked.
        restore_table(filter_payload)
        restore_table(mangle_payload)

        ensure_forward_hook_position()
        return tunnels


def refresh_host_ip() -> tuple[str | None, str | None]:
    now = time.time()
    if now - float(HOST_IP_CACHE["at"]) > 300 or not HOST_IP_CACHE["ip"]:
        rc, out, _ = sh(["curl", "-4", "-s", "--max-time", "5", "https://1.1.1.1/cdn-cgi/trace"], timeout=8)
        if rc == 0 and out:
            info = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
            ip = info.get("ip")
            loc = valid_country(info.get("loc"))
            if ip and re.fullmatch(r"[0-9.]{7,15}", ip):
                HOST_IP_CACHE.update(ip=ip, country=loc, at=now)
    return HOST_IP_CACHE["ip"], HOST_IP_CACHE["country"]  # type: ignore[return-value]


def list_bot_containers_checked() -> tuple[bool, dict[str, str]]:
    """Return (ok, mapping of bridge_name -> container_name) for running bot containers."""
    rc, out, err = sh(["docker", "ps", "--format", "{{.Names}}"], timeout=6)
    if rc != 0:
        log(f"docker ps failed (rc={rc}): {err}")
        return False, {}
    mapping: dict[str, str] = {}
    for name in out.split():
        m = BOT_CONTAINER_RE.match(name)
        if not m:
            continue
        home_key = m.group(1)
        bridge = bridge_for_home_key(home_key)
        mapping[bridge] = name
    return True, mapping


def list_bot_containers() -> dict[str, str]:
    """Return mapping of bridge_name -> container_name for running bot containers."""
    _, mapping = list_bot_containers_checked()
    return mapping


def probe_one_container(bridge: str, container_name: str) -> tuple[str, dict]:
    t0 = time.time()
    rc, out, err = sh(
        ["docker", "exec", container_name, "curl", "-4", "-s", "--max-time", "6", "https://1.1.1.1/cdn-cgi/trace"],
        timeout=9,
    )
    took = time.time() - t0
    if rc == 0 and out:
        info = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        ip = info.get("ip")
        loc = valid_country(info.get("loc"))
        if ip and re.fullmatch(r"[0-9.]{7,15}", ip):
            return bridge, {
                "containerName": container_name,
                "exitIp": ip,
                "exitCountry": loc,
                "reachable": True,
                "probedAt": int(time.time()),
            }
    return bridge, {
        "containerName": container_name,
        "exitIp": None,
        "exitCountry": None,
        "reachable": False,
        "probedAt": int(time.time()),
        "failReason": f"rc={rc} took={took:.1f}s out={out[:60]!r} err={err[:120]!r}",
    }


def probe_bridges(target_bridges: set[str] | None = None) -> None:
    ok, containers = list_bot_containers_checked()
    if not ok:
        # docker ps failed/timed out: keep existing PROBE_CACHE instead of flipping bots to blocked.
        return
    with LOCK:
        LAST_RUNNING.clear()
        LAST_RUNNING.update(containers)
    to_probe = [
        (b, c)
        for b, c in containers.items()
        if target_bridges is None or b in target_bridges
    ]
    results: dict[str, dict] = {}
    if to_probe:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            futs = [pool.submit(probe_one_container, b, c) for b, c in to_probe]
            for fut in concurrent.futures.as_completed(futs):
                try:
                    b, res = fut.result()
                    results[b] = res
                except Exception:
                    pass
    with LOCK:
        now = time.time()
        for b, res in list(results.items()):
            if target_bridges is not None:
                # A policy change: earlier results say nothing about the new setup.
                LAST_GOOD.pop(b, None)
                PROBE_FAILS.pop(b, None)
            if res.get("reachable"):
                PROBE_FAILS[b] = 0
                LAST_GOOD[b] = res
                continue
            PROBE_FAILS[b] = PROBE_FAILS.get(b, 0) + 1
            print(
                f"[rakazo-vpn-manager] probe failed {time.strftime('%F %T')} bridge={b} "
                f"container={res.get('containerName')} streak={PROBE_FAILS[b]} {res.get('failReason')}",
                flush=True,
            )
            good = LAST_GOOD.get(b)
            if (
                target_bridges is None
                and good
                and PROBE_FAILS[b] < FAIL_TOLERANCE
                and now - good["probedAt"] < LAST_GOOD_MAX_AGE
                and good.get("containerName") == res.get("containerName")
            ):
                results[b] = dict(good)
        if target_bridges is None:
            PROBE_CACHE.clear()
        PROBE_CACHE.update(results)


def build_snapshot() -> dict:
    host_ip, host_country = refresh_host_ip()
    with LOCK:
        profile_list = list(PROFILES.values())
    tunnels = collect_tunnel_statuses(profile_list)
    docker_ok, running_fresh = list_bot_containers_checked()
    with LOCK:
        if docker_ok:
            LAST_RUNNING.clear()
            LAST_RUNNING.update(running_fresh)
            running = running_fresh
        else:
            running = dict(LAST_RUNNING)
        tunnel_map = {t["id"]: t for t in tunnels}
        all_bridges = set(STATE["bridges"].keys()) | set(running.keys()) | set(PROBE_CACHE.keys())

        bridges_out: dict[str, dict] = {}
        for bridge in sorted(all_bridges):
            cfg = STATE["bridges"].get(bridge, {"profile": None, "locked": False})
            profile_id = cfg.get("profile")
            locked = bool(cfg.get("locked", False))
            probe = PROBE_CACHE.get(bridge)
            cname = running.get(bridge) or (probe["containerName"] if probe else None)
            is_running = bridge in running
            t_info = tunnel_map.get(profile_id) if profile_id else None
            exit_ip = probe.get("exitIp") if probe else None
            exit_country = probe.get("exitCountry") if probe else None
            reachable = bool(probe.get("reachable")) if probe else False

            if not is_running:
                status = "stopped"
            elif locked:
                if not t_info or not t_info["up"] or not reachable:
                    status = "blocked"
                elif host_ip and exit_ip == host_ip:
                    status = "blocked"
                else:
                    status = "vpn"
            elif profile_id:
                if not t_info or not t_info["up"]:
                    status = "fallback"
                elif not reachable:
                    status = "blocked"
                elif host_ip and exit_ip == host_ip:
                    status = "fallback"
                else:
                    status = "vpn"
            else:
                status = "direct" if reachable else "blocked"

            bridges_out[bridge] = {
                "bridge": bridge,
                "profile": profile_id,
                "locked": locked,
                "running": is_running,
                "containerName": cname,
                "state": status,
                "exitIp": exit_ip,
                "exitCountry": exit_country,
                "probedAt": probe.get("probedAt") if probe else None,
            }

        return {
            "hostIp": host_ip,
            "hostCountry": host_country,
            "profiles": tunnels,
            "bridges": bridges_out,
            "updated": int(time.time()),
        }


def set_bridge_policy(bridge: str, profile_id: str | None, locked: bool) -> dict:
    if not BRIDGE_RE.fullmatch(bridge):
        raise ValueError(f"Invalid bridge name: {bridge}")
    with LOCK:
        if profile_id is not None and profile_id not in PROFILES:
            raise ValueError(f"Unknown VPN profile: {profile_id}")
        if locked and not profile_id:
            raise ValueError("Cannot lock a bridge without a VPN profile")
        previous = dict(STATE["bridges"])
        if profile_id is None and not locked:
            STATE["bridges"].pop(bridge, None)
        else:
            STATE["bridges"][bridge] = {"profile": profile_id, "locked": locked}
        try:
            save_state()
            apply_iptables_policies()
        except Exception:
            # Not applied: keep the old policy (rules and state) and let the caller see the error.
            STATE["bridges"] = previous
            try:
                save_state()
            except Exception as exc:
                log(f"state rollback save failed: {exc}")
            try:
                # A partially applied change (one table restored) must not outlive the rolled-back state.
                apply_iptables_policies()
            except Exception as exc:
                log(f"rules rollback apply failed: {exc}")
            raise

    probe_bridges({bridge})
    snap = build_snapshot()
    return snap["bridges"].get(bridge, {"bridge": bridge, "profile": profile_id, "locked": locked, "state": "stopped"})


def reconcile_bridges(desired: dict[str, dict]) -> dict:
    with LOCK:
        previous = dict(STATE["bridges"])
        next_bridges: dict[str, dict] = {}
        explicit: set[str] = set()
        for bridge, cfg in desired.items():
            if not BRIDGE_RE.fullmatch(bridge) or not isinstance(cfg, dict):
                continue
            explicit.add(bridge)
            profile_id = cfg.get("profile")
            locked = bool(cfg.get("locked", False))
            if profile_id and profile_id not in PROFILES:
                # Unknown profile: keep locked bridges fail-closed if profile missing!
                if locked:
                    next_bridges[bridge] = {"profile": str(profile_id), "locked": True}
                continue
            if profile_id:
                next_bridges[bridge] = {"profile": str(profile_id), "locked": locked}
        # Locks are a union: only an explicit payload entry may change or unlock a bridge.
        for bridge, cfg in previous.items():
            if bridge not in explicit and cfg.get("locked"):
                next_bridges[bridge] = dict(cfg)
        STATE["bridges"] = next_bridges
        try:
            save_state()
            apply_iptables_policies()
        except Exception:
            STATE["bridges"] = previous
            try:
                save_state()
            except Exception as exc:
                log(f"state rollback save failed: {exc}")
            try:
                # A partially applied change (one table restored) must not outlive the rolled-back state.
                apply_iptables_policies()
            except Exception as exc:
                log(f"rules rollback apply failed: {exc}")
            raise
    with LOCK:
        LAST_GOOD.clear()
        PROBE_FAILS.clear()
    probe_bridges(None)
    return build_snapshot()


class _Manager:
    """This module as the HTTP handlers see it, read at call time."""

    def __getattr__(self, name: str):
        return globals()[name]


rakazo_vpn_http.manager = _Manager()


def monitor_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            apply_iptables_policies()
        except Exception as exc:
            print(f"[rakazo-vpn-manager] monitor apply error: {exc}", file=sys.stderr, flush=True)
        try:
            probe_bridges(None)
        except Exception as exc:
            print(f"[rakazo-vpn-manager] monitor error: {exc}", file=sys.stderr, flush=True)
        stop_event.wait(12)


def bootstrap() -> None:
    global PROFILES, STATE, STARTED_AT
    STARTED_AT = time.time()
    cleanup_legacy_single_tunnel()
    with LOCK:
        PROFILES = load_profiles()
        STATE = load_state()
        # Policy first: locked bridges are dropped (fail closed) before any tunnel exists.
        # A failure here is retried by the monitor loop and must not stop the manager.
        try:
            apply_iptables_policies()
        except Exception as exc:
            log(f"initial policy apply failed: {exc}")
        for prof in PROFILES.values():
            try:
                ensure_tunnel_up(prof)
            except Exception as exc:
                log(f"profile {prof['id']} skipped, tunnel not brought up: {exc}")
        try:
            apply_iptables_policies()
        except Exception as exc:
            log(f"policy apply after tunnels failed: {exc}")


def main() -> int:
    bootstrap()
    stop_event = threading.Event()

    def handle_sig(*_args) -> None:
        stop_event.set()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sig)
    signal.signal(signal.SIGINT, handle_sig)

    threading.Thread(target=monitor_loop, args=(stop_event,), daemon=True).start()

    if os.path.exists(SOCK_PATH):
        os.unlink(SOCK_PATH)
    os.makedirs(os.path.dirname(SOCK_PATH), exist_ok=True)
    unix_srv = ThreadingUnixStreamServer(SOCK_PATH, ApiHandler)
    # Socket is bind-mounted into rakazo-supervisor-1 (root)
    os.chmod(SOCK_PATH, 0o660)
    threading.Thread(target=unix_srv.serve_forever, daemon=True).start()

    http_srv = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), TcpApiHandler)
    print(f"rakazo-vpn-manager ready: {len(PROFILES)} profiles loaded, unix={SOCK_PATH}, http=127.0.0.1:{HTTP_PORT}", flush=True)
    http_srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
