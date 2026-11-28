"""The manager's HTTP API and status page, served on its unix socket and on 127.0.0.1."""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import unquote

# The running manager, set by rakazo-vpn-manager.py before it serves anything.
manager = None


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
            snap = manager.build_snapshot()
            self.send_json(200, {
                "hostIp": snap["hostIp"],
                "hostCountry": snap["hostCountry"],
                "profiles": snap["profiles"],
            })
            return
        if path in ("/status", "/status.json"):
            self.send_json(200, manager.build_snapshot())
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
            res = manager.set_bridge_policy(bridge, profile or None, locked)
            self.send_json(200, res)
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_DELETE(self) -> None:
        path = self.path.split("?", 1)[0]
        m = re.fullmatch(r"/profiles/([a-z0-9_-]{1,64})", path)
        if not m:
            self.send_json(404, {"error": "Not found"})
            return
        try:
            data = self.read_json()
            manager.remove_profile(m.group(1), data.get("owner"))
            manager.apply_iptables_policies()
            self.send_json(200, {"ok": True})
        except manager.ProfileInUse as exc:
            self.send_json(409, {"error": str(exc)})
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/profiles":
            try:
                data = self.read_json()
                self.send_json(201, manager.add_profile(data.get("config"), data.get("name"), data.get("owner")))
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return
        m = re.fullmatch(r"/profiles/([a-z0-9_-]{1,64})/test", path)
        if m:
            try:
                self.send_json(200, manager.test_profile(m.group(1)))
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return
        if path == "/reconcile":
            try:
                data = self.read_json()
                bridges = data.get("bridges")
                if not isinstance(bridges, dict):
                    raise ValueError("bridges must be an object")
                res = manager.reconcile_bridges(bridges)
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
        return host in manager.ALLOWED_HOSTS or bool(manager.TAILSCALE_HOST_RE.fullmatch(host))

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
