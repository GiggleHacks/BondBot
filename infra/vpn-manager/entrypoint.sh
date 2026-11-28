#!/bin/sh
# Use the firewall backend the host already uses: rules written through the other one would
# sit in a table Docker and the kernel's active ruleset never look at.
set -eu
count() { "$1" 2>/dev/null | grep -c '^-' || true; }
legacy=$(count iptables-legacy-save)
nft=$(count iptables-nft-save)
mode=nft
[ "${legacy:-0}" -gt "${nft:-0}" ] && mode=legacy
mkdir -p /usr/local/rakazo-bin
for tool in iptables iptables-save iptables-restore ip6tables ip6tables-save ip6tables-restore; do
  ln -sf "$(command -v "${tool%%-*}-$mode${tool#"${tool%%-*}"}")" "/usr/local/rakazo-bin/$tool"
done
echo "rakazo-vpn: using the $mode firewall backend" >&2
mkdir -p "$(dirname "$RAKAZO_VPN_PROFILES_DIR")" "$RAKAZO_VPN_PROFILES_DIR"
chmod 700 "$RAKAZO_VPN_PROFILES_DIR"
exec python3 /usr/local/lib/rakazo/rakazo-vpn-manager.py
