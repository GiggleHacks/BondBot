import type { Bot } from "@rakazo/contracts";
import type { useSpaceRoster } from "../sidebar/use-space-roster";
import type { useShellSettings } from "../use-shell-settings";
import { ComputerPanel } from "./computer-panel";
import type { useComputerControls } from "./use-computer-controls";

type Roster = ReturnType<typeof useSpaceRoster>;

/** The side panel's computer screen for the open bot. */
export function ShellComputerPanel({
  active,
  computerControls,
  screenBotId,
  shownAbove,
  bootstrapMe,
  setBootstrapMe,
  openSettings,
}: {
  active: Bot;
  computerControls: ReturnType<typeof useComputerControls>;
  screenBotId: string | null;
  shownAbove: boolean;
  bootstrapMe: Roster["bootstrapMe"];
  setBootstrapMe: Roster["setBootstrapMe"];
  openSettings: ReturnType<typeof useShellSettings>["openSettings"];
}) {
  return (
    <ComputerPanel
      {...computerControls.panelProps(active)}
      screenBotId={screenBotId}
      shownAbove={shownAbove}
      sandboxProvider={bootstrapMe?.sandboxProvider}
      onRecovered={(sandboxProvider) => {
        setBootstrapMe((prev) => (prev ? { ...prev, sandboxProvider } : prev));
        computerControls.holdComputerRecovery();
      }}
      onOpenComputerSettings={
        bootstrapMe?.computerSettingsEnabled === true ? () => openSettings("computer") : undefined
      }
    />
  );
}
