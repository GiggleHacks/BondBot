# The VPN manager as a container, for hosts that would rather not run it as a root script.
# It changes the host's routing and firewall, so it runs with the host network and privileges.
FROM alpine:3.20
RUN apk add --no-cache bash curl docker-cli iproute2 ip6tables iptables iptables-legacy \
      python3 wireguard-tools-wg wireguard-tools-wg-quick
COPY infra/vpn-manager/rakazo-vpn-manager.py /usr/local/lib/rakazo/rakazo-vpn-manager.py
COPY infra/vpn-manager/entrypoint.sh /usr/local/bin/rakazo-vpn-entrypoint
ENV RAKAZO_VPN_PROFILES_DIR=/data/profiles \
    RAKAZO_VPN_STATE_PATH=/data/state.json \
    RAKAZO_VPN_SOCK=/var/run/rakazo-vpn/vpn.sock \
    PATH=/usr/local/rakazo-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
VOLUME /data
ENTRYPOINT ["/usr/local/bin/rakazo-vpn-entrypoint"]
