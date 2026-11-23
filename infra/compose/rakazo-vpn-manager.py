#!/usr/bin/env python3
"""Host-side multi-tunnel Proton WireGuard VPN manager for Rakazo bot computers.

Manages one WireGuard interface per .conf file in /boot/config/wireguard/rakazo-profiles/
and applies per-bridge (rakazo-c<hash>) fwmark routing + optional per-bridge fail-closed
kill-switch rules in iptables without interrupting host traffic or restarting containers.

Serves:
  - Unix socket (/var/run/rakazo-vpn.sock) for rakazo-supervisor
  - Local HTTP dashboard & API on 127.0.0.1:5174
"""

from __future__ import annotations

import concurrent.futures
import glob
import hashlib
import html
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import unquote

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

COUNTRY_NAMES = {
    "AU": "Australia",
    "CA": "Canada",
    "CH": "Switzerland",
    "DE": "Germany",
    "FR": "France",
    "GB": "United Kingdom",
    "HK": "Hong Kong",
    "JP": "Japan",
    "KR": "South Korea",
    "NL": "Netherlands",
    "SG": "Singapore",
    "TH": "Thailand",
    "TW": "Taiwan",
    "US": "United States",
}

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
FAIL_TOLERANCE = 3
LAST_GOOD_MAX_AGE = 120
HOST_IP_CACHE: dict[str, object] = {"ip": None, "country": None, "at": 0.0}
STARTED_AT = time.time()


def valid_country(loc: object) -> str | None:
    return loc if isinstance(loc, str) and re.fullmatch(r"[A-Z]{2}", loc) else None


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


def parse_profile_file(path: str, used_tables: set[int], used_marks: set[int]) -> dict:
    stem = os.path.splitext(os.path.basename(path))[0]
    profile_id = re.sub(r"[^a-z0-9_-]+", "-", stem.lower()).strip("-") or "vpn"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    country_code = None
    server_label = stem
    m_file = re.search(r"(?:^|[-_])([A-Za-z]{2})(?:[-_](\d+))?(?:$|[-_])", stem)
    if m_file:
        country_code = m_file.group(1).upper()
        if m_file.group(2):
            server_label = f"{country_code}#{m_file.group(2)}"

    for line in raw.splitlines():
        s = line.strip()
        m_srv = re.match(r"^#\s*([A-Za-z]{2}#\d+)\b", s)
        if m_srv:
            server_label = m_srv.group(1).upper()
            country_code = server_label[:2]
            break

    if not country_code or country_code not in COUNTRY_NAMES:
        # Still keep 2-letter code if matched in filename
        country_code = country_code or "UN"

    digest = hashlib.sha256(profile_id.encode("utf-8")).hexdigest()
    iface = f"wgrk_{digest[:6]}"

    table = 7110 + (int(digest[:4], 16) % 20000)
    while table in used_tables:
        table += 1
    used_tables.add(table)

    mark = 0x7101 + (int(digest[4:8], 16) % 0x0E00)
    while mark in used_marks:
        mark += 1
    used_marks.add(mark)

    addr_v4 = None
    for line in raw.splitlines():
        m_addr = re.match(r"^\s*Address\s*=\s*(.+)$", line, re.IGNORECASE)
        if m_addr:
            for part in m_addr.group(1).split(","):
                p = part.strip()
                if "." in p:
                    addr_v4 = p
                    break
            break

    return {
        "id": profile_id,
        "path": path,
        "countryCode": country_code,
        "countryName": COUNTRY_NAMES.get(country_code, country_code),
        "serverLabel": server_label,
        "iface": iface,
        "table": table,
        "mark": mark,
        "markHex": f"0x{mark:x}",
        "addrV4": addr_v4,
    }


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


def log(msg: str) -> None:
    print(f"[rakazo-vpn-manager] {time.strftime('%F %T')} {msg}", file=sys.stderr, flush=True)


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
    sh(["ip", "addr", "add", addr, "dev", iface])
    sh(["ip", "link", "set", iface, "mtu", "1420", "up"])
    sh(["sysctl", "-qw", f"net.ipv4.conf.{iface}.rp_filter=2"])

    sh(["ip", "route", "replace", "blackhole", "default", "table", table, "metric", "4000"])
    sh(["ip", "route", "replace", "default", "dev", iface, "table", table])
    while sh(["ip", "rule", "del", "fwmark", f"{mark}/0xffff", "lookup", table, "priority", RULE_PRIO])[0] == 0:
        pass
    sh(["ip", "rule", "add", "fwmark", f"{mark}/0xffff", "lookup", table, "priority", RULE_PRIO])

    if sh([*IPT, "-t", "nat", "-C", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])[0] != 0:
        sh([*IPT, "-t", "nat", "-A", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])
    if sh([*IPT, "-t", "mangle", "-C", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] != 0:
        sh([*IPT, "-t", "mangle", "-A", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])


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
        "id": profile["id"],
        "countryCode": profile["countryCode"],
        "countryName": profile["countryName"],
        "serverLabel": profile["serverLabel"],
        "iface": iface,
        "up": up,
        "handshakeAgeSec": age,
        "endpoint": endpoint,
    }


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
        tunnels = {pid: tunnel_status(p) for pid, p in PROFILES.items()}
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


def list_bot_containers() -> dict[str, str]:
    """Return mapping of bridge_name -> container_name for running bot containers."""
    _, out, _ = sh(["docker", "ps", "--format", "{{.Names}}"], timeout=6)
    mapping: dict[str, str] = {}
    for name in out.split():
        m = BOT_CONTAINER_RE.match(name)
        if not m:
            continue
        home_key = m.group(1)
        bridge = bridge_for_home_key(home_key)
        mapping[bridge] = name
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
    containers = list_bot_containers()
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
        tunnels = [tunnel_status(p) for p in PROFILES.values()]
        tunnel_map = {t["id"]: t for t in tunnels}
        running = list_bot_containers()
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


class ApiHandler(BaseHTTPRequestHandler):
    timeout = 15  # per-connection socket timeout, so a stalled client cannot pin a thread

    def address_string(self) -> str:
        return "local"

    def log_message(self, *args) -> None:
        pass

    def send_json(self, code: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        """Read a JSON object body; anything else raises ValueError (HTTP 400)."""
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            raise ValueError("invalid Content-Length") from None
        if length <= 0:
            raise ValueError("request body required")
        if length > 1_048_576:
            self.close_connection = True  # the unread body must not be parsed as the next request
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("incomplete request body")
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError as exc:  # includes JSONDecodeError and UnicodeDecodeError
            raise ValueError(f"invalid JSON body: {exc}") from None
        if not isinstance(data, dict):
            raise ValueError("request body must be a JSON object")
        return data

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self.send_json(200, {"ok": True})
            return
        if path == "/profiles":
            snap = build_snapshot()
            self.send_json(200, {
                "hostIp": snap["hostIp"],
                "hostCountry": snap["hostCountry"],
                "profiles": snap["profiles"],
            })
            return
        if path in ("/status", "/status.json"):
            self.send_json(200, build_snapshot())
            return
        if path in ("/", "/index.html"):
            body = render_dashboard_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json(404, {"error": "Not found"})

    def do_PUT(self) -> None:
        path = self.path.split("?", 1)[0]
        m = re.fullmatch(r"/bridges/([^/]+)", path)
        if not m:
            self.send_json(404, {"error": "Not found"})
            return
        bridge = unquote(m.group(1))
        try:
            data = self.read_json()
            if "profile" not in data or "locked" not in data:
                raise ValueError("profile and locked are required")
            profile = data["profile"]
            locked = data["locked"]
            if profile is not None and not isinstance(profile, str):
                raise ValueError("profile must be a string or null")
            if not isinstance(locked, bool):
                raise ValueError("locked must be a boolean")
            res = set_bridge_policy(bridge, profile or None, locked)
            self.send_json(200, res)
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/reconcile":
            try:
                data = self.read_json()
                bridges = data.get("bridges")
                if not isinstance(bridges, dict):
                    raise ValueError("bridges must be an object")
                res = reconcile_bridges(bridges)
                self.send_json(200, res)
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return
        self.send_json(404, {"error": "Not found"})


class TcpApiHandler(ApiHandler):
    """The 127.0.0.1 listener: read-only status and dashboard only. Changes go through the unix socket."""

    TCP_GET_PATHS = ("/", "/index.html", "/status", "/status.json")

    def host_allowed(self) -> bool:
        host = (self.headers.get("Host") or "").strip().lower()
        return host in ALLOWED_HOSTS or bool(TAILSCALE_HOST_RE.fullmatch(host))

    def do_GET(self) -> None:
        if not self.host_allowed():
            self.send_json(403, {"error": "Forbidden host"})
            return
        if self.path.split("?", 1)[0] not in self.TCP_GET_PATHS:
            self.send_json(404, {"error": "Not found"})
            return
        super().do_GET()

    def deny_write(self) -> None:
        self.close_connection = True  # a body we refuse to read must not be parsed as the next request
        self.send_json(405, {"error": "Read-only listener; use the unix socket"})

    do_PUT = do_POST = do_DELETE = do_PATCH = deny_write


class ThreadingUnixStreamServer(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True


def render_dashboard_html() -> str:
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rakazo Multi-VPN Status</title>
<style>
:root{--bg:#0e1013;--fg:#e8eaed;--mut:#98a2b3;--card:#171a1f;--bd:#262b33;--ok:#12a150;--warn:#d98a00;--bad:#d92d20;--dir:#2e6bd6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;padding:20px}
main{max-width:780px;margin:0 auto;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px 16px}
h1,h2{margin:0 0 10px;font-size:16px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid var(--bd);text-align:left}
th{color:var(--mut);font-weight:500;font-size:12px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff}
.vpn{background:var(--ok)}.direct{background:var(--dir)}.fallback{background:var(--warn)}.blocked{background:var(--bad)}.stopped{background:#475467}
</style></head><body><main>
<div class="card"><h1>Rakazo Per-Computer VPN Manager</h1><div id="host" style="color:var(--mut)">Loading...</div></div>
<div class="card"><h2>WireGuard Tunnels</h2><table><thead><tr><th>Profile</th><th>Country</th><th>Interface</th><th>Handshake</th><th>Endpoint</th></tr></thead><tbody id="tunnels"></tbody></table></div>
<div class="card"><h2>Bot Computers</h2><table><thead><tr><th>Container</th><th>Bridge</th><th>Config</th><th>Lock</th><th>State</th><th>Exit IP</th></tr></thead><tbody id="bridges"></tbody></table></div>
</main><script>
const STATES=["vpn","direct","fallback","blocked","stopped"];
function cell(v,tag){const td=document.createElement("td");if(tag){const e=document.createElement(tag);e.textContent=v;td.appendChild(e)}else{td.textContent=v}return td}
function row(cells){const tr=document.createElement("tr");cells.forEach(c=>tr.appendChild(c));return tr}
async function tick(){
  const s=await (await fetch("status.json",{cache:"no-store"})).json();
  document.getElementById("host").textContent="Host Direct IP: "+(s.hostIp||"?")+" ("+(s.hostCountry||"?")+")";
  document.getElementById("tunnels").replaceChildren(...(s.profiles||[]).map(p=>row([cell(p.serverLabel),cell(p.countryName+" ("+p.countryCode+")"),cell(p.iface),cell(p.up?(p.handshakeAgeSec==null?"starting":p.handshakeAgeSec+"s ago"):"DOWN"),cell(p.endpoint||"\u2014")])));
  document.getElementById("bridges").replaceChildren(...Object.values(s.bridges||{}).map(b=>{
    const pill=cell(b.state,"span");pill.firstChild.className="pill "+(STATES.includes(b.state)?b.state:"stopped");
    return row([cell(b.containerName||"\u2014"),cell(b.bridge,"code"),cell(b.profile||"Direct"),cell(b.locked?"LOCKED":"Unlocked"),pill,cell(b.exitIp?(b.exitIp+" ("+(b.exitCountry||"?")+")"):"\u2014")]);
  }));
}
tick();setInterval(tick,5000);
</script></body></html>"""


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
