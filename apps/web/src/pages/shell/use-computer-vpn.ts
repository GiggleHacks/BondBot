import type {
  BotVpnStatus,
  ComputerVpnOverview,
  SetComputerVpnInput,
} from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";
import { playVpnSound, primeVpnAudio } from "../../lib/vpn-sounds";

export interface ComputerVpnController {
  overview: ComputerVpnOverview | null;
  pendingBotId: string | null;
  refreshVpn: () => Promise<void>;
  setBotVpn: (input: SetComputerVpnInput) => Promise<BotVpnStatus | null>;
}

const POLL_MS = 15_000;

/** Nobody looks at a hidden tab, and an offline browser cannot answer. */
function pollingAllowed(): boolean {
  return document.visibilityState !== "hidden" && navigator.onLine !== false;
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
  const [polling, setPolling] = useState(pollingAllowed);
  // Counts requests, so an answer arriving after a newer request (or a space change) is dropped.
  const latestRequest = useRef(0);

  useEffect(() => {
    const update = () => setPolling(pollingAllowed());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const refreshVpn = useCallback(async () => {
    if (!spaceId) return;
    const request = ++latestRequest.current;
    try {
      const next = await rpc.computer.vpnState();
      if (request !== latestRequest.current) return;
      // Same answer as the last one: keep the object so nothing downstream re-renders.
      setOverview((current) =>
        current && JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    } catch {
      // Transient status poll failure should not break the shell.
    }
  }, [rpc, spaceId]);

  // Another space's computers must not show while this one loads (or if it never answers).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the space changes
  useEffect(() => {
    latestRequest.current += 1;
    setOverview(null);
  }, [spaceId]);

  // Refreshes at once, then every 15 s; stops while the tab is hidden or offline and
  // refreshes once more when it comes back.
  useEffect(() => {
    if (!spaceId || !polling) return;
    void refreshVpn();
    const timer = setInterval(() => void refreshVpn(), POLL_MS);
    return () => clearInterval(timer);
  }, [spaceId, polling, refreshVpn]);

  const setBotVpn = useCallback(
    async (input: SetComputerVpnInput): Promise<BotVpnStatus | null> => {
      primeVpnAudio();
      const previous = overview?.bots[input.botId];
      setPendingBotId(input.botId);
      try {
        const updated = await rpc.computer.setVpn(input);
        if (input.profile === null) {
          playVpnSound("vpn-off");
        } else if (
          previous &&
          previous.vpnProfile === input.profile &&
          previous.vpnLocked !== input.locked
        ) {
          playVpnSound(input.locked ? "lock-on" : "lock-off");
        } else {
          playVpnSound("vpn-on");
        }
        if (input.switchToDedicated) {
          await refreshBots().catch(() => undefined);
        }
        await refreshVpn();
        return updated;
      } catch (error) {
        playVpnSound("error");
        const message =
          error instanceof Error ? error.message : "Failed to update VPN settings";
        toast.error(message);
        return null;
      } finally {
        setPendingBotId((current) => (current === input.botId ? null : current));
      }
    },
    [overview, refreshBots, refreshVpn, rpc],
  );

  return useMemo(
    () => ({ overview, pendingBotId, refreshVpn, setBotVpn }),
    [overview, pendingBotId, refreshVpn, setBotVpn],
  );
}
