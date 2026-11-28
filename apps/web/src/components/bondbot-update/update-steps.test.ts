import type { BondbotUpdateJob } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { etaText, quietText, transferText, updateSteps } from "./update-steps";

const job = {
  running: true,
  phase: "downloading",
  progress: 12,
} as BondbotUpdateJob;

describe("update steps", () => {
  it.each([
    ["checking", 8, ["active", "pending", "pending", "pending"]],
    ["reconnecting", 94, ["done", "done", "done", "active"]],
    ["failed", 40, ["done", "failed", "pending", "pending"]],
    ["succeeded", 100, ["done", "done", "done", "done"]],
  ] as const)("shows a %s job's steps", (phase, progress, states) => {
    expect(updateSteps({ ...job, phase, progress }).map((step) => step.state)).toEqual(states);
  });

  it("gives size and speed while downloading", () => {
    expect(transferText({ ...job, downloadedBytes: 12_500_000, bytesPerSecond: 4_000_000 })).toBe(
      "12.5 MB downloaded at 4.0 MB/s",
    );
  });

  it("estimates the time left only from a previous run", () => {
    expect(etaText({ ...job, etaSeconds: 250 })).toBe("About 4 minutes left");
    expect(etaText(job)).toBe("Updates usually take 5 to 10 minutes");
  });

  it("says a quiet step is still running", () => {
    const lastOutputAt = new Date(0).toISOString();
    expect(quietText({ ...job, lastOutputAt }, 20_000)).toBe(
      "No new output for 20s. Still running.",
    );
    expect(quietText({ ...job, lastOutputAt }, 5_000)).toBeNull();
  });
});
