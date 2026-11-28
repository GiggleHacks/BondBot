import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { Bot, ComputerStatus } from "@rakazo/contracts";
import { computerPreviewPlaceholder } from "@rakazo/i18n/computer-preview";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { HardDrive, Maximize2, X } from "lucide-react";
import type { ReactNode } from "react";
import { ComputersUnavailableHint } from "../../../components/computers/ComputersUnavailableHint";
import { runsOnUserMachine } from "../../../lib/computers/computer-sandbox";
import { screenFrames, screenIframeSandbox } from "../../../lib/computers/computer-screen";
import { DesktopKindEmptyState, resolveOwnedComputerScreen } from "./computer-view";

type ComputerPanelProps = {
  bot: Bot;
  computer: ComputerStatus | null;
  computerOpen: boolean;
  embeddedScreenUrl: string | null;
  /** Bot that owns `embeddedScreenUrl`; mismatches stay hidden across bot switches. */
  screenBotId?: string | null;
  /** Changes to load the screen again in a new frame. */
  screenFrameKey?: string;
  heldScreen?: { url: string; key: string } | null;
  screenFrameRef: (frame: HTMLIFrameElement | null) => void;
  computerScreenError: ReactNode;
  computerBooting: ReactNode;
  booting: boolean;
  showingRecoveryHint: boolean;
  showComputerRecoveryHint: boolean;
  sandboxProvider?: string | null;
  onRecovered: (sandboxProvider: string) => void;
  onRecoveryDismissed: () => void;
  onOpenComputerSettings?: () => void;
  /** Starts an asleep computer where it is. */
  onWake: () => void;
  /** Opens the full window. */
  onOpen: () => void;
  cleaningUpDisk?: boolean;
  onCleanUpDisk?: () => void;
  onDismissDiskWarning?: () => void;
};

export function ComputerPanel({
  cleaningUpDisk,
  onCleanUpDisk,
  onDismissDiskWarning,
  ...props
}: ComputerPanelProps) {
  const owned = resolveOwnedComputerScreen(
    props.bot.id,
    props.computer,
    props.embeddedScreenUrl,
    props.screenBotId,
    props.heldScreen,
  );
  const percent = owned.computer?.diskFullPercent;
  const warn = percent !== undefined && onCleanUpDisk && onDismissDiskWarning;
  // The preview keeps its place either way, so the warning never remounts the live screen.
  return (
    <>
      <ComputerPreview
        {...props}
        computer={owned.computer}
        embeddedScreenUrl={owned.embeddedScreenUrl}
        heldScreen={owned.heldScreen}
      />
      {warn && (
        <div
          data-testid="computer-disk-warning"
          className="mt-2 flex items-center gap-2 rounded-[14px] border border-warning/40 py-1.5 ps-3 pe-1.5 text-body"
        >
          <HardDrive aria-hidden size={15} strokeWidth={1.9} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <Trans>Computer is {percent}% full</Trans>
          </span>
          <Button variant="secondary" size="sm" disabled={cleaningUpDisk} onClick={onCleanUpDisk}>
            <Trans>Clean up</Trans>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Dismiss`}
            onClick={onDismissDiskWarning}
          >
            <X size={15} aria-hidden />
          </Button>
        </div>
      )}
    </>
  );
}

function ComputerPreview({
  bot,
  computer,
  computerOpen,
  embeddedScreenUrl,
  screenFrameKey,
  heldScreen,
  screenFrameRef,
  computerScreenError,
  computerBooting,
  booting,
  showingRecoveryHint,
  showComputerRecoveryHint,
  sandboxProvider,
  onRecovered,
  onRecoveryDismissed,
  onOpenComputerSettings,
  onWake,
  onOpen,
}: Omit<ComputerPanelProps, "cleaningUpDisk" | "onCleanUpDisk" | "onDismissDiskWarning">) {
  // A clickable preview invites a boot that costs money, so an idle computer only wakes from its button.
  const idle =
    !computerOpen &&
    !booting &&
    !computerBooting &&
    !computerScreenError &&
    !showComputerRecoveryHint &&
    !runsOnUserMachine(computer) &&
    (!computer || computer.state === "stopped" || computer.state === "suspended");
  if (idle) {
    return (
      <div
        data-testid="computer-preview"
        data-state="idle"
        className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-xl bg-muted/50 px-6"
      >
        <span aria-hidden className="relative">
          <BotAvatar
            avatarSet={bot.avatarSet}
            color={bot.color}
            identity={bot.id}
            size={44}
            className="opacity-50 grayscale"
          />
          <span className="absolute -end-3 -top-2 text-caption font-medium leading-none text-muted-foreground/70">
            z<sup>z</sup>
          </span>
        </span>
        <span className="text-body text-muted-foreground">
          <Trans>Asleep</Trans>
        </span>
        <Button variant="secondary" size="sm" data-testid="computer-preview-wake" onClick={onWake}>
          <Trans>Wake</Trans>
        </Button>
      </div>
    );
  }
  const canOpen = !computerScreenError && !showingRecoveryHint;
  return (
    <div>
      <div
        data-testid="computer-preview"
        data-state={
          computer?.state === "running" && !runsOnUserMachine(computer) ? "running" : undefined
        }
        className={`relative rounded-xl bg-muted/50 ${
          showingRecoveryHint ? "" : "aspect-[16/10] overflow-hidden"
        }`}
      >
        {computerOpen ? (
          <div className="grid h-full place-items-center text-body text-muted-foreground/80">
            <Trans>Open in full window</Trans>
          </div>
        ) : runsOnUserMachine(computer) ? (
          <DesktopKindEmptyState className="grid h-full place-items-center px-6 text-center text-body text-muted-foreground/80" />
        ) : computer?.state === "running" && embeddedScreenUrl && !computerScreenError ? (
          screenFrames(screenFrameKey, embeddedScreenUrl, heldScreen).map((frame) => (
            <iframe
              key={frame.key}
              title={frame.held ? undefined : t`Bot screen preview`}
              aria-hidden={frame.held || undefined}
              tabIndex={-1}
              ref={frame.held ? undefined : screenFrameRef}
              src={frame.url}
              sandbox={screenIframeSandbox(frame.url)}
              className={`h-full w-full border-0 bg-black${frame.held ? " absolute inset-0" : ""}`}
              allow="clipboard-read; clipboard-write"
              style={{ pointerEvents: "none" }}
            />
          ))
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-body text-muted-foreground/80">
            {computerScreenError ??
              (showComputerRecoveryHint ? (
                <ComputersUnavailableHint
                  sandboxProvider={sandboxProvider}
                  onRecovered={onRecovered}
                  onRecoveryDismissed={onRecoveryDismissed}
                  onOpenComputerSettings={onOpenComputerSettings}
                />
              ) : (
                (computerBooting ?? computerPreviewPlaceholder(computer?.state, booting))
              ))}
          </div>
        )}
        {canOpen ? (
          <Button
            variant="floating"
            size="icon-sm"
            data-testid="computer-preview-open"
            className="absolute end-2 top-2"
            aria-label="Full screen"
            title="Full screen"
            onClick={onOpen}
          >
            <Maximize2 strokeWidth={1.9} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
