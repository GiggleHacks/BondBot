import { Button, buttonVariants } from "@rakazo/ui-web";
import { ArrowDownToLine, RotateCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { useBondbotUpdate } from "./BondbotUpdateProvider";

const UpdateProgress = lazy(() =>
  import("./UpdateProgress").then((mod) => ({ default: mod.UpdateProgress })),
);

/** The sidebar's offer of a newer BondBot, and its progress once started. */
export function UpdateCard({ mini = false }: { mini?: boolean }) {
  const update = useBondbotUpdate();
  if (!update?.showUpdate || !update.availability) return null;
  const { availability, job, isUpdating, applyPending, applyError } = update;
  const version =
    job?.targetUiVersion ?? availability.latestUiVersion ?? availability.latestApiVersion;
  const name = version ? `v${version}` : "the new version";
  const started = Boolean(job && job.phase !== "idle");
  const failed = job?.phase === "failed";

  if (mini) {
    return (
      <div className="flex shrink-0 justify-center pb-1">
        <Button
          size="icon-lg"
          className="rounded-full text-label tabular-nums"
          aria-label={isUpdating ? `Updating to ${name}` : `Update to ${name}`}
          title={isUpdating ? `Updating to ${name}` : `Update to ${name}`}
          disabled={isUpdating || applyPending || !availability.canApply}
          onClick={update.startUpdate}
        >
          {isUpdating ? `${job?.progress ?? 0}%` : <ArrowDownToLine aria-hidden="true" />}
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="bondbot-update-card"
      className={`mx-2.5 mb-1.5 flex shrink-0 flex-col gap-2 ${
        started ? "rounded-2xl border border-border bg-card p-3" : ""
      }`}
    >
      {started && job ? (
        <>
          <span className="text-label font-medium text-muted-foreground">Updating to {name}</span>
          <Suspense fallback={null}>
            <UpdateProgress job={job} />
          </Suspense>
          {job.phase === "succeeded" && job.restartRequired ? (
            <Button size="sm" variant="secondary" onClick={update.reloadApp}>
              <RotateCw aria-hidden="true" />
              Reload app
            </Button>
          ) : null}
        </>
      ) : null}
      {!started || failed ? (
        <div className="flex items-center gap-1.5">
          {availability.canApply ? (
            <Button
              size="sm"
              className="min-w-0 flex-1"
              data-testid="bondbot-card-update"
              disabled={applyPending}
              onClick={update.startUpdate}
            >
              <ArrowDownToLine aria-hidden="true" />
              <span className="truncate">{failed ? "Try again" : `Update to ${name}`}</span>
            </Button>
          ) : (
            <a
              className={`${buttonVariants({ size: "sm" })} min-w-0 flex-1`}
              href={availability.repoUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className="truncate">Get {name}</span>
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={update.skipCurrentUpdate}>
            Skip
          </Button>
        </div>
      ) : null}
      {applyError ? <p className="text-label text-destructive">{applyError}</p> : null}
    </div>
  );
}
