# VPN per bot

Each bot with its own computer can reach the internet through a VPN of your choice, in any
country your VPN offers. You upload the VPN's WireGuard files in **Settings › VPN** (or while
creating a bot), test them with one click, and pick one per bot. The optional **Kill Switch**
blocks a bot's internet whenever its VPN is down, so it never goes online from your own address.

Any VPN that gives out WireGuard files works (Proton VPN, Mullvad, IVPN, your own WireGuard
server, and so on).

## One-time server setup

The VPN needs a small helper, the **VPN manager**, running on the machine that runs the bot
computers. It needs Linux with Docker (WireGuard is built into Linux 5.6 and newer) and the
restricted computer network.

1. Turn on the restricted computer network if you have not already, and give computers their
   own DNS servers (the Kill Switch needs both). Run once, from the repository:

   ```bash
   sudo bash infra/compose/restrict-computer-egress.sh
   ```

   Then add these lines to `.env`:

   ```bash
   SANDBOX_COMPUTER_EGRESS=restricted
   SANDBOX_COMPUTER_DNS=1.1.1.1,1.0.0.1
   ```

   See [restricted computer egress](../self-host-docker-computers.md#restricted-computer-egress)
   for what the script does.

2. Start the VPN manager and recreate the supervisor, from `infra/compose` (add your usual
   `-f` files and `--env-file`):

   ```bash
   docker compose --profile vpn up -d --build vpn supervisor
   ```

   It keeps the uploaded files in the `vpn-data` volume and talks to the supervisor through
   `/var/run/rakazo-vpn`.

3. Open **Settings**. A **VPN** page appears once the supervisor sees the VPN manager.

### Without Docker for the VPN manager

The manager is one Python file, `infra/vpn-manager/rakazo-vpn-manager.py`, and can also run as
root straight on the host (this is how the original Unraid install runs it). It needs
`python3`, `wg`, `wg-quick`, `ip`, `iptables`, `curl` and the `docker` CLI. Point it at a folder
with `RAKAZO_VPN_PROFILES_DIR`, start it at boot, and mount `/var/run/rakazo-vpn` into the
supervisor. Run its tests with `python3 infra/vpn-manager/test/test_vpn_manager.py`.

## Getting a WireGuard file

Each WireGuard file is one connection to one VPN server. Your VPN plan limits how many can be
connected at once, so make one file per country (or per bot) you want.

With **Proton VPN**:

1. Sign in at account.protonvpn.com and open **Downloads**.
2. Scroll to **WireGuard configuration**. Type any device name (for example `bondbot-japan`),
   choose a platform such as **GNU/Linux**, and leave the VPN options as they are.
3. Press **Create** next to a server in the country you want, then **Download**. You get a
   `.conf` file.

Other VPNs have a similar page, usually called WireGuard configuration, manual setup or
router setup. Pick a file that sends **all** traffic through the VPN.

## Using it

- **Upload:** Settings › VPN › **Upload files**. Pick one or many `.conf` files at once. Each file
  is checked, connected and tested right away.
- **Test:** press **Test** on any file. You see where bots on it appear to be (country and IP)
  or what went wrong.
- **New bot:** in **New bot**, choose a VPN under the name (or press **Connect through a VPN**
  to upload one). The bot gets its own computer behind that VPN, with the Kill Switch on.
- **Existing bot:** click the bot's VPN chip (the small flag by its name) and pick a country.
  Switch **Lock to VPN (Kill Switch)** on or off there.
- **Remove:** the trash button on a file. A VPN still used by a bot cannot be removed until
  that bot gets another VPN.

Files belong to the Space they were uploaded in, and other Spaces never see them. Files an
operator places straight in the VPN manager's folder are shared with every Space and show
"Added on the server".

## When a test fails

| Message | What to do |
| --- | --- |
| The VPN server did not answer | The file is old, was deleted in your VPN account, or the plan's connection limit is reached. Make a new file and upload it. |
| The VPN server answered, but nothing got through it | The server is busy or blocking you. Try later or use another server. |
| Traffic did not go through the VPN | The file does not send all traffic through the VPN. Download it again with all traffic included. |

## Security notes

- The private keys stay on the machine running the VPN manager, in root-only files. The
  database and the app never store them, and the app never shows them again.
- Uploaded files that try to run commands (`PreUp`, `PostUp`, `PreDown`, `PostDown`) are refused.
- The manager's status page (`http://127.0.0.1:5174`) is read-only and only answers on the
  machine itself.
