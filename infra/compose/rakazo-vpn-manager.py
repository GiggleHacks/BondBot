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
from socketserver import UnixStreamServer
from urllib.parse import unquote

PROFILES_DIR = os.environ.get("RAKAZO_VPN_PROFILES_DIR", "/boot/config/wireguard/rakazo-profiles")
STATE_PATH = os.environ.get("RAKAZO_VPN_STATE_PATH", "/boot/config/rakazo-vpn-state.json")
SOCK_PATH = os.environ.get("RAKAZO_VPN_SOCK", "/var/run/rakazo-vpn/vpn.sock")
HTTP_PORT = int(os.environ.get("RAKAZO_VPN_HTTP_PORT", "5174"))

MANGLE_CHAIN = "RAKAZO-VPN-MANGLE"
KS_CHAIN = "RAKAZO-VPN-KS"
RULE_PRIO = "100"
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

BRIDGE_RE = re.compile(r"^rakazo-c[a-f0-9]{7}$")
BOT_CONTAINER_RE = re.compile(r"^rakazo-bot-([a-z0-9-]+)$")

LOCK = threading.RLock()
STATE: dict[str, dict] = {"bridges": {}}
PROFILES: dict[str, dict] = {}
PROBE_CACHE: dict[str, dict] = {}
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
        p = parse_profile_file(path, used_tables, used_marks)
        loaded[p["id"]] = p
    return loaded


def load_state() -> dict[str, dict]:
    if not os.path.exists(STATE_PATH):
        return {"bridges": {}}
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        bridges = data.get("bridges", {})
        clean: dict[str, dict] = {}
        if isinstance(bridges, dict):
            for bridge, cfg in bridges.items():
                if not BRIDGE_RE.match(bridge) or not isinstance(cfg, dict):
                    continue
                profile = cfg.get("profile")
                locked = bool(cfg.get("locked", False)) and bool(profile)
                clean[bridge] = {
                    "profile": str(profile) if profile else None,
                    "locked": locked,
                }
        return {"bridges": clean}
    except Exception:
        return {"bridges": {}}


def save_state() -> None:
    tmp = f"{STATE_PATH}.tmp"
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE, f, indent=2, sort_keys=True)
    os.replace(tmp, STATE_PATH)


def cleanup_legacy_single_tunnel() -> None:
    # Tear down the old single-tunnel wgrk setup cleanly if present.
    while sh(["iptables", "-t", "mangle", "-D", "PREROUTING", "-i", "rakazo-c+", "-j", "MARK", "--set-mark", "0x7100"])[0] == 0:
        pass
    while sh(["iptables", "-t", "nat", "-D", "POSTROUTING", "-o", "wgrk", "-j", "MASQUERADE"])[0] == 0:
        pass
    while sh(["iptables", "-t", "mangle", "-D", "FORWARD", "-o", "wgrk", "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] == 0:
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

    if sh(["iptables", "-t", "nat", "-C", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])[0] != 0:
        sh(["iptables", "-t", "nat", "-A", "POSTROUTING", "-o", iface, "-j", "MASQUERADE"])
    if sh(["iptables", "-t", "mangle", "-C", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])[0] != 0:
        sh(["iptables", "-t", "mangle", "-A", "FORWARD", "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"])


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


def ensure_forward_hook_position() -> None:
    """Keep RAKAZO-VPN-KS at FORWARD rule #1 (above DOCKER-FORWARD) and block IPv6."""
    _, fwd_out, _ = sh(["iptables", "-S", "FORWARD"])
    lines = [l.strip() for l in fwd_out.splitlines() if l.strip().startswith("-A FORWARD")]
    wanted = f"-A FORWARD -i rakazo-c+ -j {KS_CHAIN}"
    if not lines or lines[0] != wanted:
        while sh(["iptables", "-D", "FORWARD", "-i", "rakazo-c+", "-j", KS_CHAIN])[0] == 0:
            pass
        sh(["iptables", "-I", "FORWARD", "1", "-i", "rakazo-c+", "-j", KS_CHAIN])

    _, m_out, _ = sh(["iptables", "-t", "mangle", "-S", "PREROUTING"])
    m_lines = [l.strip() for l in m_out.splitlines() if l.strip().startswith("-A PREROUTING")]
    m_wanted = f"-A PREROUTING -i rakazo-c+ -j {MANGLE_CHAIN}"
    if not m_lines or m_lines[0] != m_wanted:
        while sh(["iptables", "-t", "mangle", "-D", "PREROUTING", "-i", "rakazo-c+", "-j", MANGLE_CHAIN])[0] == 0:
            pass
        sh(["iptables", "-t", "mangle", "-I", "PREROUTING", "1", "-i", "rakazo-c+", "-j", MANGLE_CHAIN])

    _, fwd6_out, _ = sh(["ip6tables", "-S", "FORWARD"])
    lines6 = [l.strip() for l in fwd6_out.splitlines() if l.strip().startswith("-A FORWARD")]
    if not lines6 or lines6[0] != "-A FORWARD -i rakazo-c+ -j DROP":
        while sh(["ip6tables", "-D", "FORWARD", "-i", "rakazo-c+", "-j", "DROP"])[0] == 0:
            pass
        sh(["ip6tables", "-I", "FORWARD", "1", "-i", "rakazo-c+", "-j", "DROP"])


def apply_iptables_policies() -> dict[str, dict]:
    """Rewrite RAKAZO-VPN-MANGLE and RAKAZO-VPN-KS atomically from STATE + tunnel health."""
    with LOCK:
        tunnels = {pid: tunnel_status(p) for pid, p in PROFILES.items()}

        sh(["iptables", "-N", KS_CHAIN])
        sh(["iptables", "-t", "mangle", "-N", MANGLE_CHAIN])

        mangle_cmds = [f"-F {MANGLE_CHAIN}"]
        ks_cmds = [f"-F {KS_CHAIN}"]
        ks_cmds.append(f"-A {KS_CHAIN} -o rakazo-c+ -j RETURN")

        for bridge, cfg in sorted(STATE["bridges"].items()):
            pid = cfg.get("profile")
            locked = bool(cfg.get("locked", False))
            prof = PROFILES.get(pid) if pid else None
            t_info = tunnels.get(pid) if pid else None

            if prof and (locked or (t_info and t_info["up"])):
                mangle_cmds.append(
                    f"-A {MANGLE_CHAIN} -i {bridge} -j MARK --set-xmark {prof['markHex']}/0xffff"
                )

            if locked:
                if prof:
                    ks_cmds.append(f"-A {KS_CHAIN} -i {bridge} -o {prof['iface']} -j RETURN")
                ks_cmds.append(f"-A {KS_CHAIN} -i {bridge} -j DROP")

        # Apply rules
        for line in mangle_cmds:
            sh(["iptables", "-t", "mangle", *line.split()])
        for line in ks_cmds:
            sh(["iptables", *line.split()])

        ensure_forward_hook_position()
        return tunnels


def refresh_host_ip() -> tuple[str | None, str | None]:
    now = time.time()
    if now - float(HOST_IP_CACHE["at"]) > 300 or not HOST_IP_CACHE["ip"]:
        rc, out, _ = sh(["curl", "-4", "-s", "--max-time", "5", "https://1.1.1.1/cdn-cgi/trace"], timeout=8)
        if rc == 0 and out:
            info = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
            ip = info.get("ip")
            loc = info.get("loc")
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
    rc, out, _ = sh(
        ["docker", "exec", container_name, "curl", "-4", "-s", "--max-time", "4", "https://1.1.1.1/cdn-cgi/trace"],
        timeout=7,
    )
    if rc == 0 and out:
        info = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        ip = info.get("ip")
        loc = info.get("loc")
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
    if not BRIDGE_RE.match(bridge):
        raise ValueError(f"Invalid bridge name: {bridge}")
    with LOCK:
        if profile_id is not None and profile_id not in PROFILES:
            raise ValueError(f"Unknown VPN profile: {profile_id}")
        if locked and not profile_id:
            raise ValueError("Cannot lock a bridge without a VPN profile")
        if profile_id is None and not locked:
            STATE["bridges"].pop(bridge, None)
        else:
            STATE["bridges"][bridge] = {"profile": profile_id, "locked": locked}
        save_state()
        apply_iptables_policies()

    probe_bridges({bridge})
    snap = build_snapshot()
    return snap["bridges"].get(bridge, {"bridge": bridge, "profile": profile_id, "locked": locked, "state": "stopped"})


def reconcile_bridges(desired: dict[str, dict]) -> dict:
    with LOCK:
        next_bridges: dict[str, dict] = {}
        for bridge, cfg in desired.items():
            if not BRIDGE_RE.match(bridge) or not isinstance(cfg, dict):
                continue
            profile_id = cfg.get("profile")
            locked = bool(cfg.get("locked", False))
            if profile_id and profile_id not in PROFILES:
                # Unknown profile: keep locked bridges fail-closed if profile missing!
                if locked:
                    next_bridges[bridge] = {"profile": str(profile_id), "locked": True}
                continue
            if profile_id:
                next_bridges[bridge] = {"profile": str(profile_id), "locked": locked}
        STATE["bridges"] = next_bridges
        save_state()
        apply_iptables_policies()
    probe_bridges(None)
    return build_snapshot()


class ApiHandler(BaseHTTPRequestHandler):
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
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 1_048_576:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

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
            profile = data.get("profile")
            locked = bool(data.get("locked", False))
            res = set_bridge_policy(bridge, str(profile) if profile else None, locked)
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
                bridges = data.get("bridges", {})
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


class ThreadingUnixStreamServer(UnixStreamServer):
    daemon_threads = True

    def server_bind(self) -> None:
        super().server_bind()


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
async function tick(){
  const s=await (await fetch("status.json",{cache:"no-store"})).json();
  document.getElementById("host").textContent="Host Direct IP: "+(s.hostIp||"?")+" ("+(s.hostCountry||"?")+")";
  document.getElementById("tunnels").innerHTML=(s.profiles||[]).map(p=>`<tr><td>${p.serverLabel}</td><td>${p.countryName} (${p.countryCode})</td><td>${p.iface}</td><td>${p.up?(p.handshakeAgeSec==null?"starting":p.handshakeAgeSec+"s ago"):"DOWN"}</td><td>${p.endpoint||"—"}</td></tr>`).join("");
  document.getElementById("bridges").innerHTML=Object.values(s.bridges||{}).map(b=>`<tr><td>${b.containerName||"—"}</td><td><code>${b.bridge}</code></td><td>${b.profile||"Direct"}</td><td>${b.locked?"LOCKED":"Unlocked"}</td><td><span class="pill ${b.state}">${b.state}</span></td><td>${b.exitIp?(b.exitIp+" ("+(b.exitCountry||"?")+")"):"—"}</td></tr>`).join("");
}
tick();setInterval(tick,5000);
</script></body></html>"""


def monitor_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            apply_iptables_policies()
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
        for prof in PROFILES.values():
            ensure_tunnel_up(prof)
        apply_iptables_policies()


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

    http_srv = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), ApiHandler)
    print(f"rakazo-vpn-manager ready: {len(PROFILES)} profiles loaded, unix={SOCK_PATH}, http=127.0.0.1:{HTTP_PORT}", flush=True)
    http_srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
