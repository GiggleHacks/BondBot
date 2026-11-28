import type { PendingVpnChoice } from "../computer-vpn-control";
import { TeamComputerVpnDialog } from "../computer-vpn-control";
import type { ComputerVpnController } from "../use-computer-vpn";

/** Asks where a VPN picked on the Team computer should go, then applies it. */
export function TeamComputerVpnChoice({
  vpn,
  choice,
  onClose,
}: {
  vpn: ComputerVpnController;
  choice: PendingVpnChoice | null;
  onClose: () => void;
}) {
  return (
    <TeamComputerVpnDialog
      choice={choice}
      busy={Boolean(choice && vpn.pendingBotId === choice.botId)}
      onClose={onClose}
      onConfirm={(switchToDedicated) => {
        if (!choice) return;
        onClose();
        void vpn.setBotVpn({
          botId: choice.botId,
          profile: choice.profile,
          locked: choice.locked,
          switchToDedicated,
        });
      }}
    />
  );
}
