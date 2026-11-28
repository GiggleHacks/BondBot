import type { BondbotUpdateJob } from "@rakazo/contracts";

export type UpdateStepState = "done" | "active" | "pending" | "failed";

const STEPS = [
  { label: "Download from GitHub", phases: ["checking", "downloading"] },
  { label: "Build BondBot", phases: ["building"] },
  { label: "Update the database", phases: ["migrating"] },
  { label: "Restart BondBot", phases: ["restarting", "reconnecting"] },
];

/** A failed job no longer names its step, so how far it got does. */
function failedStep(progress: number): number {
  if (progress < 20) return 0;
  if (progress < 90) return 1;
  return progress < 94 ? 2 : 3;
}

/** The update as a checklist: what is finished, what is running and what is still to come. */
export function updateSteps(job: BondbotUpdateJob): { label: string; state: UpdateStepState }[] {
  const failed = job.phase === "failed";
  const current =
    job.phase === "succeeded"
      ? STEPS.length
      : failed
        ? failedStep(job.progress)
        : Math.max(
            0,
            STEPS.findIndex((step) => step.phases.includes(job.phase)),
          );
  return STEPS.map((step, index) => ({
    label: step.label,
    state: index < current ? "done" : index > current ? "pending" : failed ? "failed" : "active",
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

/** "12.5 MB downloaded at 4.0 MB/s", as far as the running command reports it. */
export function transferText(job: BondbotUpdateJob): string | null {
  const { downloadedBytes, bytesPerSecond } = job;
  const speed = bytesPerSecond === undefined ? null : `${formatBytes(bytesPerSecond)}/s`;
  if (downloadedBytes === undefined) return speed;
  const size = `${formatBytes(downloadedBytes)} downloaded`;
  return speed ? `${size} at ${speed}` : size;
}

/** Seconds without output after which the app says so, so a long step is not read as a hang. */
const QUIET_AFTER_MS = 15_000;

export function quietText(job: BondbotUpdateJob, now: number): string | null {
  if (!job.running || !job.lastOutputAt) return null;
  const quiet = now - Date.parse(job.lastOutputAt);
  return quiet < QUIET_AFTER_MS
    ? null
    : `No new output for ${Math.round(quiet / 1000)}s. Still running.`;
}

export function etaText(job: BondbotUpdateJob): string {
  const { etaSeconds } = job;
  if (etaSeconds === undefined) return "Updates usually take 5 to 10 minutes";
  if (etaSeconds < 90) return "About a minute left";
  return `About ${Math.round(etaSeconds / 60)} minutes left`;
}

/** What the person may do now, said outright so nobody has to guess. */
export function reassuranceText(job: BondbotUpdateJob): string {
  return job.phase === "restarting" || job.phase === "reconnecting"
    ? "BondBot is restarting. This page reloads by itself when it is back."
    : "Safe to refresh or close this page. The update runs on the server.";
}
