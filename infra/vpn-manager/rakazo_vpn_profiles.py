"""WireGuard profile files: reading, checking and describing them. No state and no host commands."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sys
import time

MAX_CONFIG_BYTES = 8192
# Keeps handshakes fresh on idle tunnels, so "up" means the server still answers.
KEEPALIVE_SEC = 25
OWNER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}\Z")
WG_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=\Z")
HOOK_KEYS = {"preup", "postup", "predown", "postdown"}
COUNTRY_NAMES = {
    "AU": "Australia",
    "BR": "Brazil",
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
# Two-letter country codes, so "wg" in a file name is not read as a country.
ISO_COUNTRIES = frozenset("""
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ
BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM
DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS
GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN
KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ
MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM
PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV
SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI
VN VU WF WS XK YE YT ZA ZM ZW
""".split())


def log(msg: str) -> None:
    print(f"[rakazo-vpn-manager] {time.strftime('%F %T')} {msg}", file=sys.stderr, flush=True)


def valid_country(loc: object) -> str | None:
    return loc if isinstance(loc, str) and re.fullmatch(r"[A-Z]{2}", loc) else None


def meta_path_for(conf_path: str) -> str:
    return os.path.splitext(conf_path)[0] + ".json"


def read_meta(conf_path: str) -> dict:
    """The sidecar of an uploaded profile; operator files have none."""
    try:
        with open(meta_path_for(conf_path), "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as exc:
        log(f"ignoring unreadable profile metadata for {conf_path}: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def write_private(path: str, text: str) -> None:
    """Write a root-only file atomically (it holds a private key)."""
    tmp = f"{path}.tmp-{secrets.token_hex(4)}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def iso_country(code: str) -> str | None:
    cc = code.upper()
    cc = "GB" if cc == "UK" else cc  # some providers name British servers UK
    return cc if cc in ISO_COUNTRIES else None


def label_from_text(stem: str, raw: str) -> tuple[str | None, str]:
    """Country code and server label from a "# US-CA#759" comment or a name like wg-JP-412."""
    for line in raw.splitlines():
        m_srv = re.match(r"^#\s*([A-Za-z]{2}(?:-[A-Za-z]{2})?#\d+)\b", line.strip())
        if m_srv:
            label = m_srv.group(1).upper()
            if iso_country(label[:2]):
                return iso_country(label[:2]), label

    tokens = re.split(r"[-_ .#()]+", stem)
    for i, token in enumerate(tokens):
        if not re.fullmatch(r"[A-Za-z]{2}", token) or not iso_country(token):
            continue
        rest = tokens[i + 1 : i + 3]
        state = rest[0] if rest and re.fullmatch(r"[A-Za-z]{2}", rest[0]) else None
        after = rest[1:] if state else rest[:1]
        number = after[0] if after and after[0].isdigit() else None
        # A lowercase pair is an ordinary word ("my-laptop") unless a server number follows.
        if not token.isupper() and not number:
            continue
        server = token.upper() + (f"-{state.upper()}" if state else "")
        return iso_country(token), f"{server}#{number}" if number else stem
    return None, stem


def parse_profile_file(path: str, used_tables: set[int], used_marks: set[int]) -> dict:
    stem = os.path.splitext(os.path.basename(path))[0]
    profile_id = re.sub(r"[^a-z0-9_-]+", "-", stem.lower()).strip("-") or "vpn"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    meta = read_meta(path)
    name = meta.get("name") if isinstance(meta.get("name"), str) and meta.get("name") else None
    owner = meta.get("owner") if isinstance(meta.get("owner"), str) and OWNER_RE.fullmatch(meta.get("owner")) else None

    country_code, server_label = label_from_text(name or stem, raw)
    if valid_country(meta.get("countryCode")):
        country_code = meta["countryCode"]
    # "UN" until a test learns the exit country.
    country_code = country_code or "UN"
    if name is None:
        name = stem

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
        "name": name,
        "owner": owner,
        "countryCode": country_code,
        "countryName": COUNTRY_NAMES.get(country_code, country_code),
        "serverLabel": server_label,
        "iface": iface,
        "table": table,
        "mark": mark,
        "markHex": f"0x{mark:x}",
        "addrV4": addr_v4,
    }


def validate_config(text: object) -> str:
    """Check an uploaded WireGuard file; the messages are shown to the person who uploaded it."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("This file is empty.")
    if len(text.encode("utf-8")) > MAX_CONFIG_BYTES:
        raise ValueError("This file is too big to be a WireGuard file.")
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    if any((ord(c) < 32 and c not in "\n\t") or ord(c) == 127 for c in text):
        raise ValueError("This is not a WireGuard file. Upload the .conf file your VPN gave you.")

    section = None
    interfaces: list[dict[str, str]] = []
    peers: list[dict[str, str]] = []
    for line in text.split("\n"):
        s = line.split("#", 1)[0].strip()
        if not s:
            continue
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1].strip().lower()
            if section == "interface":
                interfaces.append({})
            elif section == "peer":
                peers.append({})
            else:
                raise ValueError(f"This file has an unknown section [{s[1:-1].strip()}].")
            continue
        if "=" not in s or section is None:
            raise ValueError("This is not a WireGuard file. Upload the .conf file your VPN gave you.")
        key, value = (part.strip() for part in s.split("=", 1))
        if key.lower() in HOOK_KEYS:
            raise ValueError("This file runs commands (PreUp, PostUp, PreDown or PostDown). Remove those lines and upload it again.")
        (interfaces if section == "interface" else peers)[-1][key.lower()] = value

    if len(interfaces) != 1:
        raise ValueError("This is not a WireGuard file: it needs one [Interface] section.")
    iface = interfaces[0]
    if not WG_KEY_RE.fullmatch(iface.get("privatekey", "")):
        raise ValueError("This file has no private key. Download the full file from your VPN again.")
    addresses = [a.strip() for a in iface.get("address", "").split(",") if a.strip()]
    if not any(re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}(?:/\d{1,2})?", a) for a in addresses):
        raise ValueError("This file has no IPv4 address (Address = ...), which bots need.")
    if not peers:
        raise ValueError("This file has no server ([Peer] section).")
    for peer in peers:
        if not WG_KEY_RE.fullmatch(peer.get("publickey", "")):
            raise ValueError("This file's server has no public key.")
        if not peer.get("endpoint"):
            raise ValueError("This file's server has no address (Endpoint = ...).")
        allowed = [a.strip() for a in peer.get("allowedips", "").split(",")]
        if "0.0.0.0/0" not in allowed:
            raise ValueError("This file only sends some traffic through the VPN. Download one that sends all traffic (AllowedIPs = 0.0.0.0/0).")
    return text if text.endswith("\n") else text + "\n"


def clean_name(name: object) -> str:
    raw = name if isinstance(name, str) else ""
    raw = os.path.basename(raw.replace("\\", "/"))
    if raw.lower().endswith(".conf"):
        raw = raw[:-5]
    raw = "".join(c for c in raw if c.isprintable()).strip()
    return raw[:80] or "VPN"


def with_keepalive(stripped: str) -> str:
    """Add PersistentKeepalive to every peer that has none."""
    out: list[str] = []
    in_peer = False
    has_keepalive = False

    def close_peer() -> None:
        if in_peer and not has_keepalive:
            out.append(f"PersistentKeepalive = {KEEPALIVE_SEC}")

    for line in stripped.splitlines():
        s = line.strip()
        if s.startswith("["):
            close_peer()
            in_peer = s.lower() == "[peer]"
            has_keepalive = False
        elif in_peer and s.split("=", 1)[0].strip().lower() == "persistentkeepalive":
            has_keepalive = True
        out.append(line)
    close_peer()
    return "\n".join(out)


def parse_trace(out: str) -> tuple[str | None, str | None]:
    info = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    ip = info.get("ip")
    if not ip or not re.fullmatch(r"[0-9.]{7,15}", ip):
        return None, None
    return ip, valid_country(info.get("loc"))
