import { Button, useCopyText } from "@rakazo/ui-web";
import { ArrowDownToLine, Check, Copy, RefreshCw, RotateCw } from "lucide-react";
import type { BondbotUpdateContextValue } from "./BondbotUpdateProvider";
import { UpdateProgress } from "./UpdateProgress";

export function BondBotUpdatePopover({
  update,
  onClose,
}: {
  update: BondbotUpdateContextValue;
  onClose: () => void;
}) {
  const { availability, job, checking, applyPending, applyError, reloading } = update;
  const [copied, copy] = useCopyText();

  if (!availability) return null;

  const currentLabel = `v${availability.currentUiVersion}`;
  const targetVersion =
    job?.targetUiVersion ?? availability.latestUiVersion ?? availability.latestApiVersion;
  const targetLabel = targetVersion ? `v${targetVersion}` : null;

  const activeProgress = job && (job.running || job.phase !== "idle" || reloading);
  const showApplyButton =
    availability.updateAvailable &&
    availability.canApply &&
    (!job || job.phase === "idle" || job.phase === "failed");

  function handleCopyCommands() {
    if (!availability || availability.manualCommands.length === 0) return;
    void copy(availability.manualCommands.join("\n"));
  }

  return (
    <div
      className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3"
      data-testid="bondbot-update-popover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-body-sm font-semibold text-foreground">BondBot update</span>
            {/* off-scale: version badge. */}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {targetLabel && availability.updateAvailable
                ? `${currentLabel} -> ${targetLabel}`
                : currentLabel}
            </span>
          </div>
          {!activeProgress ? (
            <p className="text-caption text-muted-foreground">
              {availability.updateAvailable && targetLabel
                ? `Version ${targetLabel} is ready on GitHub.`
                : availability.checkError
                  ? availability.checkError
                  : "You are on the latest BondBot build."}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Check for BondBot updates"
          disabled={checking || update.isUpdating}
          onClick={() => void update.checkNow()}
        >
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      {activeProgress && job ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/40 p-2.5">
          <UpdateProgress job={job} />
          {job.phase === "succeeded" && job.restartRequired ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={update.reloadApp}
              className="mt-1 self-start"
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              Reload app
            </Button>
          ) : null}
        </div>
      ) : null}

      {applyError ? <p className="text-caption text-destructive">{applyError}</p> : null}

      {!activeProgress && availability.updateAvailable && availability.changelogSummary ? (
        // off-scale: release notes in a compact popover.
        <div className="max-h-32 overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {availability.changelogSummary}
        </div>
      ) : null}

      {availability.updateAvailable &&
      !availability.canApply &&
      availability.manualCommands.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-2.5">
          <div className="flex items-center justify-between gap-2">
            {/* off-scale: caption in a compact popover. */}
            <span className="text-[11px] font-medium text-muted-foreground">
              Run on host to update
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void handleCopyCommands()}
            >
              {copied ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <Copy className="size-3" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {/* off-scale: shell commands that must fit the popover. */}
          <pre className="overflow-x-auto font-mono text-[11px] leading-snug text-foreground">
            {availability.manualCommands.join("\n")}
          </pre>
        </div>
      ) : null}

      {showApplyButton || (availability.updateAvailable && !update.isUpdating) ? (
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {showApplyButton ? (
            <Button
              type="button"
              size="sm"
              disabled={applyPending || update.isUpdating}
              onClick={update.startUpdate}
              data-testid="bondbot-apply-update"
            >
              <ArrowDownToLine className="size-3.5" aria-hidden="true" />
              {targetLabel ? `Update to ${targetLabel}` : "Update now"}
            </Button>
          ) : (
            <span />
          )}

          {availability.updateAvailable && !update.isUpdating ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                update.skipCurrentUpdate();
                onClose();
              }}
              data-testid="bondbot-skip-update"
            >
              Skip
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
