import { useNow } from "@rakazo/chat-ui/hooks";
import type {
  BotVpnStatus,
  ComputerVpnOverview,
  SetComputerVpnInput,
} from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";

export interface ComputerVpnController {
  overview: ComputerVpnOverview | null;
  pendingBotId: string | null;
  refreshVpn: () => Promise<void>;
  setBotVpn: (input: SetComputerVpnInput) => Promise<BotVpnStatus | null>;
}

/** Polls live per-computer Proton VPN state and exit IPs, and exposes mutations. */
export function useComputerVpn({
  rpc,
  spaceId,
  refreshBots,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  spaceId: string | undefined;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
}): ComputerVpnController {
  const [overview, setOverview] = useState<ComputerVpnOverview | null>(null);
  const [pendingBotId, setPendingBotId] = useState<string | null>(null);
  const pollTick = useNow(spaceId ? 15_000 : null);

  const refreshVpn = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await rpc.computer.vpnState();
      setOverview(next);
    } catch {
      // Transient status poll failure should not break the shell.
    }
  }, [rpc, spaceId]);

  useEffect(() => {
    void pollTick;
    void refreshVpn();
  }, [pollTick, refreshVpn]);

  const setBotVpn = useCallback(
    async (input: SetComputerVpnInput): Promise<BotVpnStatus | null> => {
      setPendingBotId(input.botId);
      try {
        const updated = await rpc.computer.setVpn(input);
        if (input.switchToDedicated) {
          await refreshBots().catch(() => undefined);
        }
        await refreshVpn();
        return updated;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update VPN settings";
        toast.error(message);
        return null;
      } finally {
        setPendingBotId((current) => (current === input.botId ? null : current));
      }
    },
    [refreshBots, refreshVpn, rpc],
  );

  return { overview, pendingBotId, refreshVpn, setBotVpn };
}
