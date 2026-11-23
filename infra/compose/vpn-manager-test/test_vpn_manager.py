#!/usr/bin/env python3
"""Tests for infra/compose/rakazo-vpn-manager.py with every host command mocked.

Run: python3 infra/compose/vpn-manager-test/test_vpn_manager.py
"""

import http.client
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from socketserver import ThreadingMixIn
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
MANAGER = os.path.join(HERE, "..", "rakazo-vpn-manager.py")

TMP = tempfile.mkdtemp(prefix="vpnfix-")
os.environ["RAKAZO_VPN_PROFILES_DIR"] = os.path.join(TMP, "profiles")
os.environ["RAKAZO_VPN_STATE_PATH"] = os.path.join(TMP, "state", "state.json")
os.environ["RAKAZO_VPN_SOCK"] = os.path.join(TMP, "vpn.sock")
spec = importlib.util.spec_from_file_location("vpnmgr", MANAGER)
mgr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mgr)

BR_A = "rakazo-caaaaaaa"
BR_B = "rakazo-cbbbbbbb"
BR_C = "rakazo-cccccccc"
CONF = "[Interface]\nPrivateKey = x\nAddress = 10.2.0.2/32, 2a07:b944::2:2/128\nDNS = 10.2.0.1\n[Peer]\nPublicKey = y\n"


class FakeHost:
    """Stand-in for sh(): records calls and simulates iptables/ip6tables chains and iptables-restore."""

    def __init__(self):
        self.calls = []
        self.restore_fail = False
        self.fail_strip_for = set()
        self.chains = {}  # (binary, table, chain) -> list of "-A ..." lines
        self.restored = []  # payloads accepted
        self.forward_min = None  # fewest jump rules ever seen in FORWARD (after the first one existed)

    def rules(self, key):
        return self.chains.setdefault(key, [])

    def __call__(self, args, timeout=12, input_text=None):
        self.calls.append((list(args), input_text))
        exe = args[0]
        if exe == "iptables-restore":
            if self.restore_fail:
                return 1, "", "iptables-restore: simulated failure"
            self.restored.append(input_text)
            table = None
            for line in input_text.splitlines():
                if line.startswith("*"):
                    table = line[1:]
                elif line.startswith(":"):
                    self.chains[("iptables", table, line[1:].split()[0])] = []
                elif line.startswith("-F "):
                    self.chains[("iptables", table, line.split()[1])] = []
                elif line.startswith("-A "):
                    self.rules(("iptables", table, line.split()[1])).append(line)
            return 0, "", ""
        if exe in ("iptables", "ip6tables"):
            a = [x for x in args[1:] if x != "-w"]
            table = "filter"
            if a[:1] == ["-t"]:
                table, a = a[1], a[2:]
            key = (exe, table, a[1])
            if a[0] == "-S":
                return 0, "\n".join(self.rules(key)), ""
            if a[0] == "-I":
                self.rules(key).insert(int(a[2]) - 1, f"-A {a[1]} " + " ".join(a[3:]))
            elif a[0] == "-D":
                if a[2].isdigit():
                    del self.rules(key)[int(a[2]) - 1]
                else:
                    line = f"-A {a[1]} " + " ".join(a[2:])
                    if line not in self.rules(key):
                        return 1, "", "no such rule"
                    self.rules(key).remove(line)
            elif a[0] == "-C":
                line = f"-A {a[1]} " + " ".join(a[2:])
                return (0 if line in self.rules(key) else 1), "", ""
            elif a[0] in ("-A", "-N"):
                if a[0] == "-A":
                    self.rules(key).append(f"-A {a[1]} " + " ".join(a[2:]))
            if key == ("iptables", "filter", "FORWARD"):
                n = sum(1 for l in self.rules(key) if "-j RAKAZO-VPN-KS" in l)
                if n or self.forward_min is not None:
                    self.forward_min = n if self.forward_min is None else min(self.forward_min, n)
            return 0, "", ""
        if exe == "wg-quick":
            if args[2] in self.fail_strip_for:
                return 1, "", "bad conf"
            return 0, "[Interface]\nPrivateKey = x", ""
        if exe == "wg":
            return 0, "", ""
        if exe == "ip" and args[1:3] == ["rule", "del"]:
            return 1, "", "no such rule"  # the manager loops until this fails
        if exe == "ip" and args[1:3] == ["link", "show"]:
            return 0, "1: wg UP", ""
        return 0, "", ""

    def idx(self, pred):
        for i, (args, _) in enumerate(self.calls):
            if pred(args):
                return i
        return None


def write_profiles(names):
    d = os.environ["RAKAZO_VPN_PROFILES_DIR"]
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    for n in names:
        with open(os.path.join(d, n), "w") as f:
            f.write(CONF)


def clear_state_files():
    d = os.path.dirname(mgr.STATE_PATH)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)


def reset():
    clear_state_files()
    mgr.PROFILES = {}
    mgr.STATE = {"bridges": {}}
    mgr.PROBE_CACHE.clear()
    mgr.LAST_GOOD.clear()
    mgr.PROBE_FAILS.clear()
    mgr.HOST_IP_CACHE.update(ip=None, country=None, at=0.0)


def profile(pid, mark):
    return {"id": pid, "iface": f"wgrk_{pid[:6]}", "markHex": f"0x{mark:x}", "countryCode": "SG",
            "countryName": "Singapore", "serverLabel": "SG#1", "table": 7200, "mark": mark,
            "path": f"/p/{pid}.conf", "addrV4": "10.2.0.2/32"}


class Base(unittest.TestCase):
    def setUp(self):
        reset()
        self.host = FakeHost()
        p = mock.patch.object(mgr, "sh", self.host)
        p.start()
        self.addCleanup(p.stop)


class BootstrapTests(Base):
    def test_policy_installed_before_tunnels_and_again_after(self):
        write_profiles(["wg-SG-155.conf", "wg-TW-32.conf"])
        with open(mgr.STATE_PATH, "w") as f:
            json.dump({"bridges": {BR_A: {"profile": "wg-sg-155", "locked": True}}}, f)
        mgr.bootstrap()
        first_restore = self.host.idx(lambda a: a[0] == "iptables-restore")
        first_tunnel = self.host.idx(lambda a: a[:2] == ["wg-quick", "strip"])
        self.assertIsNotNone(first_restore)
        self.assertLess(first_restore, first_tunnel)
        # the very first payload already drops the locked bridge
        first_payload = [c for c in self.host.calls if c[0][0] == "iptables-restore"][0][1]
        self.assertIn(f"-A RAKAZO-VPN-KS -i {BR_A} -j DROP", first_payload)
        # and the policy is re-applied once tunnels exist
        last_restore = max(i for i, (a, _) in enumerate(self.host.calls) if a[0] == "iptables-restore")
        last_tunnel = max(i for i, (a, _) in enumerate(self.host.calls) if a[:2] == ["wg", "setconf"])
        self.assertGreater(last_restore, last_tunnel)

    def test_failing_profile_does_not_abort_bootstrap(self):
        write_profiles(["wg-SG-155.conf", "wg-TW-32.conf"])
        self.host.fail_strip_for = {os.path.join(os.environ["RAKAZO_VPN_PROFILES_DIR"], "wg-SG-155.conf")}
        mgr.bootstrap()  # must not raise
        setconf = [a for a, _ in self.host.calls if a[:2] == ["wg", "setconf"]]
        self.assertEqual(len(setconf), 1)  # the good profile still came up
        self.assertEqual(setconf[0][2], mgr.PROFILES["wg-tw-32"]["iface"])

    def test_policy_apply_failure_at_boot_does_not_abort(self):
        write_profiles(["wg-SG-155.conf"])
        self.host.restore_fail = True
        mgr.bootstrap()  # must not raise
        self.assertTrue(self.host.idx(lambda a: a[:2] == ["wg", "setconf"]) is not None)

    def test_ensure_tunnel_up_runtimeerror_is_logged_and_skipped(self):
        write_profiles(["wg-SG-155.conf", "wg-TW-32.conf"])
        calls = []

        def fake_up(prof):
            calls.append(prof["id"])
            if prof["id"] == "wg-sg-155":
                raise RuntimeError("boom")

        with mock.patch.object(mgr, "ensure_tunnel_up", fake_up):
            mgr.bootstrap()
        self.assertEqual(sorted(calls), ["wg-sg-155", "wg-tw-32"])


class PolicyTests(Base):
    def setUp(self):
        super().setUp()
        mgr.PROFILES = {"p1": profile("p1", 0x7101), "p2": profile("p2", 0x7102)}
        mgr.STATE = {"bridges": {
            BR_A: {"profile": "p1", "locked": True},
            BR_B: {"profile": "p2", "locked": False},
            BR_C: {"profile": "ghost", "locked": True},
        }}

    def tunnels(self, up=True):
        return {"p1": {"up": up}, "p2": {"up": up}}

    def test_payload_contents(self):
        flt, man = mgr.build_policy_payloads(self.tunnels())
        self.assertEqual(flt.splitlines()[:3], ["*filter", ":RAKAZO-VPN-KS - [0:0]", "-F RAKAZO-VPN-KS"])
        self.assertEqual(flt.splitlines()[-1], "COMMIT")
        self.assertIn("-A RAKAZO-VPN-KS -o rakazo-c+ -j RETURN", flt)
        self.assertIn(f"-A RAKAZO-VPN-KS -i {BR_A} -o wgrk_p1 -j RETURN", flt)
        self.assertIn(f"-A RAKAZO-VPN-KS -i {BR_A} -j DROP", flt)
        self.assertNotIn(f"-i {BR_B}", flt)  # unlocked: no kill switch
        self.assertIn(f"-A RAKAZO-VPN-KS -i {BR_C} -j DROP", flt)  # locked, profile missing: fail closed
        self.assertNotIn(f"-i {BR_C} -o", flt)
        self.assertEqual(man.splitlines()[:3], ["*mangle", ":RAKAZO-VPN-MANGLE - [0:0]", "-F RAKAZO-VPN-MANGLE"])
        self.assertIn(f"-A RAKAZO-VPN-MANGLE -i {BR_A} -j MARK --set-xmark 0x7101/0xffff", man)
        self.assertIn(f"-A RAKAZO-VPN-MANGLE -i {BR_B} -j MARK --set-xmark 0x7102/0xffff", man)
        self.assertNotIn(BR_C, man)
        # only our own chains are touched
        for payload in (flt, man):
            for line in payload.splitlines():
                if line.startswith(("-A", "-F", ":")):
                    self.assertIn("RAKAZO-VPN-", line)

    def test_unlocked_bridge_marked_only_when_tunnel_up(self):
        _, man = mgr.build_policy_payloads(self.tunnels(up=False))
        self.assertNotIn(BR_B, man)
        self.assertIn(BR_A, man)  # locked is always marked

    def test_apply_is_one_restore_per_table_with_w(self):
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}):
            mgr.apply_iptables_policies()
        restores = [(a, i) for a, i in self.host.calls if a[0] == "iptables-restore"]
        self.assertEqual(len(restores), 2)
        for a, _ in restores:
            self.assertEqual(a, ["iptables-restore", "-w", "--noflush"])
        # no rule-by-rule appends to our chains
        for a, _ in self.host.calls:
            if a[0] == "iptables":
                self.assertNotIn("-A", a)
        for a, _ in self.host.calls:
            if a[0] in ("iptables", "ip6tables"):
                self.assertIn("-w", a)
        self.assertEqual(self.host.rules(("iptables", "filter", "FORWARD")),
                         ["-A FORWARD -i rakazo-c+ -j RAKAZO-VPN-KS"])
        self.assertEqual(self.host.rules(("iptables", "mangle", "PREROUTING")),
                         ["-A PREROUTING -i rakazo-c+ -j RAKAZO-VPN-MANGLE"])
        self.assertEqual(self.host.rules(("ip6tables", "filter", "FORWARD")),
                         ["-A FORWARD -i rakazo-c+ -j DROP"])

    def test_forward_jump_never_absent_and_deduped(self):
        fwd = self.host.rules(("iptables", "filter", "FORWARD"))
        fwd.extend(["-A FORWARD -j DOCKER-USER", "-A FORWARD -i rakazo-c+ -j RAKAZO-VPN-KS",
                    "-A FORWARD -j DOCKER-FORWARD", "-A FORWARD -i rakazo-c+ -j RAKAZO-VPN-KS"])
        self.host.forward_min = 2
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}):
            mgr.apply_iptables_policies()
        self.assertEqual(fwd, ["-A FORWARD -i rakazo-c+ -j RAKAZO-VPN-KS",
                               "-A FORWARD -j DOCKER-USER", "-A FORWARD -j DOCKER-FORWARD"])
        self.assertGreaterEqual(self.host.forward_min, 1)

    def test_steady_state_makes_no_hook_changes(self):
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}):
            mgr.apply_iptables_policies()
            n = len(self.host.calls)
            mgr.apply_iptables_policies()
        later = [a for a, _ in self.host.calls[n:]]
        self.assertFalse([a for a in later if "-I" in a or "-D" in a])

    def test_restore_failure_raises_and_keeps_old_rules(self):
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}):
            mgr.apply_iptables_policies()
        before = {k: list(v) for k, v in self.host.chains.items()}
        n = len(self.host.calls)
        mgr.STATE["bridges"][BR_B] = {"profile": "p2", "locked": True}
        self.host.restore_fail = True
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}):
            with self.assertRaises(RuntimeError):
                mgr.apply_iptables_policies()
        self.assertEqual(before, self.host.chains)
        # nothing else was attempted after the failed transaction
        self.assertFalse([a for a, _ in self.host.calls[n:] if a[0] in ("iptables", "ip6tables")
                          and ("-A" in a or "-D" in a or "-I" in a)])

    def test_set_bridge_policy_failure_rolls_back_state_and_reports(self):
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        mgr.save_state()
        saved = open(mgr.STATE_PATH).read()
        self.host.restore_fail = True
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}), \
             mock.patch.object(mgr, "probe_bridges") as probe:
            with self.assertRaises(RuntimeError):
                mgr.set_bridge_policy(BR_A, None, False)
            probe.assert_not_called()  # no success path
        self.assertEqual(mgr.STATE["bridges"], {BR_A: {"profile": "p1", "locked": True}})
        self.assertEqual(json.load(open(mgr.STATE_PATH)),
                         {"bridges": {BR_A: {"profile": "p1", "locked": True}}})
        self.assertEqual(json.loads(saved), json.load(open(mgr.STATE_PATH)))

    def test_bridge_name_with_newline_never_reaches_payload(self):
        mgr.STATE["bridges"][BR_A + "\n"] = {"profile": "p1", "locked": True}
        flt, man = mgr.build_policy_payloads(self.tunnels())
        self.assertNotIn(BR_A + "\n", flt)
        self.assertNotIn(BR_A + "\n", man)


class ReviewFixTests(Base):
    def test_ipv6_jump_failure_is_not_fatal(self):
        calls = []

        def fake_jump(base, chain, target, *a, **k):
            calls.append((base[0], chain, target))
            if base[0] == "ip6tables":
                raise RuntimeError("ip6tables unavailable")

        with mock.patch.object(mgr, "ensure_jump", side_effect=fake_jump):
            mgr.ensure_forward_hook_position()  # must not raise
        self.assertEqual([c[0] for c in calls], ["iptables", "iptables", "ip6tables"])

    def test_ipv4_jump_failure_stays_fatal(self):
        with mock.patch.object(mgr, "ensure_jump", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                mgr.ensure_forward_hook_position()

    def test_rollback_reapplies_rules(self):
        mgr.PROFILES = {"p1": profile("p1", 0x7101)}
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        attempts = []

        def flaky_apply():
            attempts.append(json.dumps(mgr.STATE, sort_keys=True))
            if len(attempts) == 1:
                raise RuntimeError("mangle restore failed")
            return {}

        with mock.patch.object(mgr, "apply_iptables_policies", side_effect=flaky_apply), \
                mock.patch.object(mgr, "save_state"):
            with self.assertRaises(RuntimeError):
                mgr.set_bridge_policy(BR_A, None, False)
        self.assertEqual(len(attempts), 2)  # failed apply, then the rollback re-apply
        self.assertEqual(attempts[1], json.dumps({"bridges": {BR_A: {"profile": "p1", "locked": True}}}, sort_keys=True))
        self.assertTrue(mgr.STATE["bridges"][BR_A]["locked"])


class StateTests(Base):
    def test_bridge_re_rejects_trailing_newline(self):
        self.assertIsNone(mgr.BRIDGE_RE.fullmatch(BR_A + "\n"))
        self.assertIsNone(mgr.BRIDGE_RE.match(BR_A + "\n"))
        self.assertIsNotNone(mgr.BRIDGE_RE.fullmatch(BR_A))
        with self.assertRaises(ValueError):
            mgr.set_bridge_policy(BR_A + "\n", None, False)

    def test_fsync_and_bak_rotation(self):
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        with mock.patch.object(mgr.os, "fsync", wraps=os.fsync) as fs:
            mgr.save_state()
            self.assertGreaterEqual(fs.call_count, 1)
        self.assertFalse(os.path.exists(mgr.STATE_PATH + ".bak"))  # nothing to keep yet
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}, BR_B: {"profile": "p2", "locked": False}}}
        mgr.save_state()
        self.assertEqual(list(json.load(open(mgr.STATE_PATH + ".bak"))["bridges"]), [BR_A])
        self.assertEqual(len(json.load(open(mgr.STATE_PATH))["bridges"]), 2)
        self.assertFalse(os.path.exists(mgr.STATE_PATH + ".tmp"))

    def test_corrupt_state_falls_back_to_bak(self):
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        mgr.save_state()
        mgr.save_state()  # second save makes the .bak
        with open(mgr.STATE_PATH, "w") as f:
            f.write('{"bridges": {"rakazo-caa')  # truncated
        loaded = mgr.load_state()
        self.assertEqual(loaded, {"bridges": {BR_A: {"profile": "p1", "locked": True}}})
        # a later save must not clobber the good .bak with the damaged primary
        mgr.STATE = loaded
        mgr.save_state()
        self.assertEqual(json.load(open(mgr.STATE_PATH + ".bak"))["bridges"][BR_A]["locked"], True)

    def test_zero_length_state_falls_back_to_bak(self):
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        mgr.save_state()
        mgr.save_state()
        open(mgr.STATE_PATH, "w").close()
        self.assertTrue(mgr.load_state()["bridges"][BR_A]["locked"])

    def test_both_corrupt_starts_empty_but_keeps_evidence(self):
        for p in (mgr.STATE_PATH, mgr.STATE_PATH + ".bak"):
            with open(p, "w") as f:
                f.write("garbage")
        self.assertEqual(mgr.load_state(), {"bridges": {}})
        self.assertTrue(os.path.exists(mgr.STATE_PATH + ".corrupt"))

    def test_missing_state_is_empty(self):
        self.assertEqual(mgr.load_state(), {"bridges": {}})

    def test_reconcile_keeps_absent_locked_bridges(self):
        mgr.PROFILES = {"p1": profile("p1", 0x7101), "p2": profile("p2", 0x7102)}
        mgr.STATE = {"bridges": {
            BR_A: {"profile": "p1", "locked": True},       # absent from payload: must stay
            BR_B: {"profile": "p2", "locked": False},      # absent and unlocked: may go
        }}
        with mock.patch.object(mgr, "probe_bridges"), mock.patch.object(mgr, "build_snapshot", return_value={}):
            mgr.reconcile_bridges({BR_C: {"profile": "p2", "locked": False}})
            self.assertEqual(set(mgr.STATE["bridges"]), {BR_A, BR_C})
            self.assertTrue(mgr.STATE["bridges"][BR_A]["locked"])
            # a malformed entry for the locked bridge is not an explicit unlock
            mgr.reconcile_bridges({BR_A: "nope", "rakazo-cinvalid": {}})
            self.assertTrue(mgr.STATE["bridges"][BR_A]["locked"])
            # an empty payload cannot unlock anything
            mgr.reconcile_bridges({})
            self.assertTrue(mgr.STATE["bridges"][BR_A]["locked"])
            # only an explicit entry unlocks / changes
            mgr.reconcile_bridges({BR_A: {"profile": "p1", "locked": False}})
            self.assertFalse(mgr.STATE["bridges"][BR_A]["locked"])
            mgr.reconcile_bridges({BR_A: {"profile": None, "locked": False}})
            self.assertNotIn(BR_A, mgr.STATE["bridges"])

    def test_reconcile_failure_keeps_old_state(self):
        mgr.PROFILES = {"p1": profile("p1", 0x7101)}
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        self.host.restore_fail = True
        with mock.patch.object(mgr, "tunnel_status", lambda p: {"id": p["id"], "up": True}), \
             mock.patch.object(mgr, "probe_bridges") as probe:
            with self.assertRaises(RuntimeError):
                mgr.reconcile_bridges({BR_B: {"profile": "p1", "locked": False}})
            probe.assert_not_called()
        self.assertEqual(set(mgr.STATE["bridges"]), {BR_A})


class Http:
    """Tiny client for a server on a unix socket or TCP port."""

    def __init__(self, addr):
        self.addr = addr

    def request(self, method, path, body=None, headers=None, raw_headers=None):
        if isinstance(self.addr, str):
            conn = http.client.HTTPConnection("localhost")
            conn.sock = socket.socket(socket.AF_UNIX)
            conn.sock.connect(self.addr)
        else:
            conn = http.client.HTTPConnection(*self.addr, timeout=5)
        conn.timeout = 5
        h = dict(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if (raw_headers or {}).get("skip_host"):
            conn.putrequest(method, path, skip_host=True)
            conn.endheaders()
        else:
            conn.request(method, path, body=body, headers=h)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data.decode()


class HandlerBase(Base):
    def serve(self, server):
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))


class UnixApiTests(HandlerBase):
    def setUp(self):
        super().setUp()
        self.sock = os.path.join(TMP, "t.sock")
        if os.path.exists(self.sock):
            os.unlink(self.sock)
        self.srv = mgr.ThreadingUnixStreamServer(self.sock, mgr.ApiHandler)
        self.srv.handle_error = lambda *a: None  # a stalled client that hangs up is expected here
        self.serve(self.srv)
        self.c = Http(self.sock)
        mgr.PROFILES = {"p1": profile("p1", 0x7101)}
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        self.before = json.dumps(mgr.STATE, sort_keys=True)
        self.real_sbp = mgr.set_bridge_policy
        p = mock.patch.object(mgr, "set_bridge_policy", side_effect=AssertionError("must not be called"))
        self.sbp = p.start()
        self.addCleanup(p.stop)
        p2 = mock.patch.object(mgr, "reconcile_bridges", side_effect=AssertionError("must not be called"))
        self.rec = p2.start()
        self.addCleanup(p2.stop)

    def assert_unchanged(self):
        self.assertEqual(json.dumps(mgr.STATE, sort_keys=True), self.before)
        self.sbp.assert_not_called()
        self.rec.assert_not_called()

    def test_server_is_threaded_with_timeout(self):
        self.assertIsInstance(self.srv, ThreadingMixIn)
        self.assertTrue(self.srv.daemon_threads)
        self.assertEqual(mgr.ApiHandler.timeout, 15)
        # a stalled client must not block another one
        stalled = socket.socket(socket.AF_UNIX)
        stalled.connect(self.sock)
        stalled.sendall(b"PUT /bridges/x HTTP/1.1\r\nContent-Length: 50\r\n\r\n")  # never sends the body
        try:
            status, _ = self.c.request("GET", "/health")
            self.assertEqual(status, 200)
        finally:
            stalled.close()

    def test_put_empty_missing_oversized_invalid_body(self):
        path = f"/bridges/{BR_A}"
        self.assertEqual(self.c.request("PUT", path)[0], 400)  # no body at all
        self.assertEqual(self.c.request("PUT", path, body="", headers={"Content-Length": "0"})[0], 400)
        self.assertEqual(self.c.request("PUT", path, body="{not json")[0], 400)
        self.assertEqual(self.c.request("PUT", path, body="[1,2]")[0], 400)
        self.assertEqual(self.c.request("PUT", path, body="\xff\xfe".encode("latin-1"))[0], 400)
        s = socket.socket(socket.AF_UNIX)
        s.connect(self.sock)
        s.sendall(f"PUT {path} HTTP/1.1\r\nHost: x\r\nContent-Length: 5000000\r\n\r\n".encode() + b"{" * 100)
        self.assertIn(b" 400 ", s.recv(4096).split(b"\r\n")[0])
        s.close()
        self.assertEqual(self.c.request("PUT", path, body="x", headers={"Content-Length": "abc"})[0], 400)
        self.assert_unchanged()

    def test_put_requires_explicit_profile_and_locked(self):
        path = f"/bridges/{BR_A}"
        self.assertEqual(self.c.request("PUT", path, body={})[0], 400)
        self.assertEqual(self.c.request("PUT", path, body={"profile": None})[0], 400)
        self.assertEqual(self.c.request("PUT", path, body={"locked": False})[0], 400)
        self.assertEqual(self.c.request("PUT", path, body={"profile": 5, "locked": False})[0], 400)
        self.assertEqual(self.c.request("PUT", path, body={"profile": None, "locked": "no"})[0], 400)
        self.assert_unchanged()

    def test_put_newline_bridge_rejected_via_real_validation(self):
        # real set_bridge_policy (not the guard mock) must refuse the name before touching anything
        with mock.patch.object(mgr, "set_bridge_policy", self.real_sbp):
            status, body = self.c.request("PUT", f"/bridges/{BR_A}%0A", body={"profile": None, "locked": False})
        self.assertEqual(status, 400)
        self.assertIn("Invalid bridge name", body["error"])
        self.assertEqual(json.dumps(mgr.STATE, sort_keys=True), self.before)

    def test_put_valid_passes_through(self):
        with mock.patch.object(mgr, "set_bridge_policy", return_value={"bridge": BR_A}) as m:
            status, body = self.c.request("PUT", f"/bridges/{BR_A}", body={"profile": "p1", "locked": True})
        self.assertEqual((status, body), (200, {"bridge": BR_A}))
        m.assert_called_once_with(BR_A, "p1", True)

    def test_apply_failure_is_reported_not_success(self):
        with mock.patch.object(mgr, "set_bridge_policy", side_effect=RuntimeError("iptables-restore failed")):
            status, body = self.c.request("PUT", f"/bridges/{BR_A}", body={"profile": None, "locked": False})
        self.assertEqual(status, 500)
        self.assertIn("iptables-restore failed", body["error"])

    def test_reconcile_requires_body_and_bridges(self):
        self.assertEqual(self.c.request("POST", "/reconcile")[0], 400)
        self.assertEqual(self.c.request("POST", "/reconcile", body="{}")[0], 400)
        self.assertEqual(self.c.request("POST", "/reconcile", body={"bridges": []})[0], 400)
        self.assertEqual(self.c.request("POST", "/reconcile", body="{oops")[0], 400)
        self.assert_unchanged()


class TcpApiTests(HandlerBase):
    def setUp(self):
        super().setUp()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), mgr.TcpApiHandler)
        self.serve(self.srv)
        self.c = Http(("127.0.0.1", self.srv.server_address[1]))
        self.good = {"Host": f"127.0.0.1:{mgr.HTTP_PORT}"}
        mgr.STATE = {"bridges": {BR_A: {"profile": "p1", "locked": True}}}
        self.before = json.dumps(mgr.STATE, sort_keys=True)
        for name in ("set_bridge_policy", "reconcile_bridges"):
            p = mock.patch.object(mgr, name, side_effect=AssertionError(f"{name} must not be called"))
            setattr(self, name, p.start())
            self.addCleanup(p.stop)
        p = mock.patch.object(mgr, "build_snapshot", return_value={"hostIp": "1.2.3.4", "bridges": {}, "profiles": []})
        p.start()
        self.addCleanup(p.stop)

    def test_get_status_and_dashboard_with_good_host(self):
        for host in (f"127.0.0.1:{mgr.HTTP_PORT}", f"localhost:{mgr.HTTP_PORT}", f"LOCALHOST:{mgr.HTTP_PORT}"):
            status, body = self.c.request("GET", "/status", headers={"Host": host})
            self.assertEqual(status, 200, host)
            self.assertEqual(body["hostIp"], "1.2.3.4")
        status, body = self.c.request("GET", "/", headers=self.good)
        self.assertEqual(status, 200)
        self.assertIn("<!doctype html>", body)
        self.assertEqual(self.c.request("GET", "/status.json", headers=self.good)[0], 200)

    def test_bad_host_rejected(self):
        for host in ("evil.example", "evil.example:5174", "127.0.0.1", "127.0.0.1:9999", "localhost.evil.com:5174",
                     "127.0.0.1:5174.evil.com"):
            self.assertEqual(self.c.request("GET", "/status", headers={"Host": host})[0], 403, host)
        self.assertEqual(self.c.request("GET", "/", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.c.request("GET", "/status", raw_headers={"skip_host": True})[0], 403)

    def test_writes_refused_on_tcp(self):
        path = f"/bridges/{BR_A}"
        body = {"profile": None, "locked": False}
        self.assertEqual(self.c.request("PUT", path, body=body, headers=self.good)[0], 405)
        self.assertEqual(self.c.request("POST", "/reconcile", body={"bridges": {}}, headers=self.good)[0], 405)
        self.assertEqual(self.c.request("DELETE", path, headers=self.good)[0], 405)
        self.assertEqual(self.c.request("PUT", path, body=body, headers={"Host": "evil.example"})[0], 405)
        self.assertEqual(json.dumps(mgr.STATE, sort_keys=True), self.before)
        self.set_bridge_policy.assert_not_called()
        self.reconcile_bridges.assert_not_called()

    def test_only_status_and_dashboard_paths(self):
        self.assertEqual(self.c.request("GET", "/profiles", headers=self.good)[0], 404)
        self.assertEqual(self.c.request("GET", "/health", headers=self.good)[0], 404)

    def test_tailscale_serve_hosts_allowed(self):
        for host in ("cccbox.tail2b1072.ts.net:5174", "cccbox.tail2b1072.ts.net", "CCCBOX.TAIL2B1072.TS.NET"):
            self.assertEqual(self.c.request("GET", "/status", headers={"Host": host})[0], 200, host)
        for host in ("evil.ts.net.evil.com", "evilts.net", "ts.net", "x.ts.net.", "a.ts.net:abc"):
            self.assertEqual(self.c.request("GET", "/status", headers={"Host": host})[0], 403, host)

    def test_extra_allowed_host_env(self):
        with mock.patch.object(mgr, "ALLOWED_HOSTS", mgr.ALLOWED_HOSTS | {"cccbox.tail.ts.net:5174"}):
            self.assertEqual(self.c.request("GET", "/status", headers={"Host": "cccbox.tail.ts.net:5174"})[0], 200)


class ProbeTests(Base):
    TRACE = "fl=1\nip={ip}\nloc={loc}\ncolo=XXX\n"

    def probe(self, loc, ip="5.6.7.8"):
        def fake(args, timeout=12, input_text=None):
            return 0, self.TRACE.format(ip=ip, loc=loc), ""
        with mock.patch.object(mgr, "sh", fake):
            return mgr.probe_one_container(BR_A, "rakazo-bot-x")[1]

    def test_container_loc_validation(self):
        self.assertEqual(self.probe("SG")["exitCountry"], "SG")
        for bad in ("sg", "SGP", "S", "<script>alert(1)</script>", "S1", "", "SG​", "'+alert(1)+'"):
            r = self.probe(bad)
            self.assertTrue(r["reachable"])
            self.assertIsNone(r["exitCountry"], bad)

    def test_host_loc_validation(self):
        def run(loc):
            mgr.HOST_IP_CACHE.update(ip=None, country=None, at=0.0)
            with mock.patch.object(mgr, "sh", lambda *a, **k: (0, self.TRACE.format(ip="9.9.9.9", loc=loc), "")):
                return mgr.refresh_host_ip()
        self.assertEqual(run("TH"), ("9.9.9.9", "TH"))
        self.assertEqual(run("<b>"), ("9.9.9.9", None))
        self.assertEqual(run("th"), ("9.9.9.9", None))


class DashboardTests(unittest.TestCase):
    def test_no_innerhtml_or_template_interpolation(self):
        page = mgr.render_dashboard_html()
        self.assertNotIn("innerHTML", page)
        self.assertNotIn("outerHTML", page)
        self.assertNotIn("insertAdjacentHTML", page)
        self.assertNotIn("${", page)
        self.assertIn("textContent", page)

    @unittest.skipUnless(shutil.which("node"), "node not available")
    def test_hostile_values_stay_text(self):
        page = mgr.render_dashboard_html()
        script = page.split("<script>")[1].split("</script>")[0]
        harness = r"""
const log = [];
function el(tag){const e={tag,children:[],className:"",_t:"",
  set textContent(v){this._t=String(v);log.push(["text",tag,String(v)])}, get textContent(){return this._t},
  set innerHTML(v){throw new Error("innerHTML used")},
  appendChild(c){this.children.push(c);return c}, get firstChild(){return this.children[0]},
  replaceChildren(...c){this.children=c}};return e}
const ids={};
global.document={createElement:el,getElementById:id=>ids[id]??(ids[id]=el("#"+id))};
const evil='<img src=x onerror=alert(1)>';
global.fetch=async()=>({json:async()=>({hostIp:evil,hostCountry:evil,
  profiles:[{serverLabel:evil,countryName:evil,countryCode:evil,iface:evil,up:true,handshakeAgeSec:3,endpoint:evil}],
  bridges:{a:{bridge:evil,containerName:evil,profile:evil,locked:true,state:evil,exitIp:evil,exitCountry:evil}}})});
global.setInterval=()=>0;
(async()=>{ %s
  await tick();
  const rows=ids.bridges.children, cells=rows[0].children;
  if(cells.length!==6) throw new Error("cells");
  const pill=cells[4].children[0];
  if(pill.className!=="pill stopped") throw new Error("class from data: "+pill.className);
  if(!log.some(l=>l[2]===evil)) throw new Error("hostile string not rendered as text");
  console.log("ok");
})().catch(e=>{console.error(e.message);process.exit(1)});
""" % script
        r = subprocess.run(["node", "-e", harness], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ok", r.stdout)


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
