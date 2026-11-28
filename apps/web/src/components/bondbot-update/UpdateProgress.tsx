import { useNow } from "@rakazo/chat-ui/hooks";
import type { BondbotUpdateJob } from "@rakazo/contracts";
import { cn } from "@rakazo/ui-web";
import { Check, ChevronRight, CircleDashed, X } from "lucide-react";
import { LoadingState } from "../ai/primitives";
import type { UpdateStepState } from "./update-steps";
import { etaText, quietText, reassuranceText, transferText, updateSteps } from "./update-steps";
import "./update-progress.css";

function StepIcon({ state }: { state: UpdateStepState }) {
  if (state === "done") {
    return (
      <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-muted-foreground text-background">
        <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        aria-hidden="true"
        className="size-3.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground motion-safe:animate-spin"
      />
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-destructive text-background">
        <X className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
      </span>
    );
  }
  return <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** The running update as a checklist, with a moving bar and the live activity under it. */
export function UpdateProgress({ job }: { job: BondbotUpdateJob }) {
  const now = useNow(job.running || job.phase === "reconnecting" ? 1000 : null);
  const steps = updateSteps(job);
  const active = steps.find((step) => step.state === "active");
  const percent = Math.min(100, Math.max(0, job.progress));
  const transfer = transferText(job);
  const quiet = quietText(job, now);
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="bondbot-update-progress">
      <ol className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <li key={step.label} data-state={step.state} className="flex min-w-0 flex-col gap-1.5">
            <span
              className={cn(
                "flex items-center gap-2 text-body-sm",
                step.state === "active"
                  ? "font-medium text-foreground"
                  : step.state === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              <StepIcon state={step.state} />
              <span className="truncate">{step.label}</span>
            </span>
            {step.state === "active" ? (
              <div className="flex min-w-0 flex-col gap-1 ps-5.5">
                <div className="flex items-center gap-2">
                  <div
                    role="progressbar"
                    aria-label="BondBot update progress"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    data-running="true"
                    className="bb-update-bar flex-1 text-foreground"
                  >
                    <div className="bb-update-fill" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="text-label font-medium text-foreground tabular-nums">
                    {percent}%
                  </span>
                </div>
                {step.state === "active" ? (
                  <span className="text-label text-muted-foreground">{etaText(job)}</span>
                ) : null}
                {transfer ? (
                  <span
                    data-testid="bondbot-update-speed"
                    className="text-label text-foreground tabular-nums"
                  >
                    {transfer}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {active ? (
        <details className="group/activity min-w-0">
          <summary className="flex cursor-pointer list-none items-center gap-1 select-none">
            <span className="min-w-0 overflow-hidden whitespace-nowrap">
              <LoadingState
                label={job.phase === "reconnecting" ? "Reconnecting" : "Updating"}
                startedAt={startedAt}
              />
            </span>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/activity:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <p className="mt-1.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">
            {job.detail ?? job.message}
          </p>
        </details>
      ) : null}
      {quiet ? <p className="text-label text-muted-foreground">{quiet}</p> : null}
      {active ? (
        <p className="text-label text-muted-foreground" data-testid="bondbot-update-reassurance">
          {reassuranceText(job)}
        </p>
      ) : null}
      {job.phase === "succeeded" ? (
        <p className="text-body-sm text-foreground">{job.message} Reloading.</p>
      ) : null}
      {job.error ? <p className="text-label break-words text-destructive">{job.error}</p> : null}
      {job.logTail && job.phase === "failed" ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium select-none">Build output</summary>
          <pre className="mt-1.5 max-h-28 overflow-auto rounded bg-background/80 p-2 font-mono text-[10px] whitespace-pre-wrap">
            {job.logTail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
