import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComputerStatus } from "@rakazo/contracts";

export function DesktopKindEmptyState({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Trans>
        This bot runs on this computer, not a Linux desktop. Shell and files use your home folder.
      </Trans>
    </div>
  );
}

export function computerPlaceholder(
  state: ComputerStatus["state"] | undefined,
  booting: boolean,
  label: string,
) {
  if (state === "booting" || booting) return t`Booting live desktop…`;
  if (state === "running") return label;
  if (state === "suspended") return t`Computer is asleep. Open it to wake.`;
  if (state === "error") return t`Computer failed to boot`;
  return t`Computer is stopped`;
}

export function computerLabel(mode: ComputerStatus["mode"] | undefined, botName: string) {
  return mode === "dedicated" ? t`${botName}’s computer` : t`Team Computer`;
}

/**
 * Gates computer status, screen URL, and held frame on matching the target bot so
 * bot switches or stale state can never paint another bot's screen or status.
 */
export function resolveOwnedComputerScreen(
  botId: string,
  computer: ComputerStatus | null,
  embeddedScreenUrl: string | null,
  screenBotId?: string | null,
  heldScreen?: { url: string; key: string } | null,
): {
  computer: ComputerStatus | null;
  embeddedScreenUrl: string | null;
  heldScreen: { url: string; key: string } | null;
} {
  const ownedComputer = computer && (!computer.botId || computer.botId === botId) ? computer : null;
  const matchesScreenBot = screenBotId === undefined || screenBotId === botId;
  const active = Boolean(ownedComputer && matchesScreenBot);
  return {
    computer: ownedComputer,
    embeddedScreenUrl: active ? embeddedScreenUrl : null,
    heldScreen: active ? (heldScreen ?? null) : null,
  };
}
