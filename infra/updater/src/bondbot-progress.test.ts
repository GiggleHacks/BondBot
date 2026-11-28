import { describe, expect, it, vi } from "vitest";
import type { StepProgress } from "./bondbot-progress.js";
import { buildProgressReader, gitProgressReader } from "./bondbot-progress.js";

describe("update progress", () => {
  it("reads percent, size and speed from git's redrawn meter", () => {
    const report = vi.fn<(progress: StepProgress) => void>();
    const read = gitProgressReader(report);
    // A chunk can end mid-line.
    read("Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10), 12.50 MiB | 4.00 Mi");
    read("B/s\r");
    expect(report).toHaveBeenLastCalledWith({
      fraction: 0.45,
      detail: "Receiving files",
      downloadedBytes: 13_107_200,
      bytesPerSecond: 4_194_304,
    });
  });

  it("counts finished build steps and times layer downloads", () => {
    const report = vi.fn<(progress: StepProgress) => void>();
    let clock = 0;
    const read = buildProgressReader(report, () => clock);
    read("#5 [deps 1/2] FROM node\n#5 sha256:ab 1MB / 9MB 0.1s\n");
    clock = 1000;
    read("#5 sha256:ab 4MB / 9MB 1.1s\n");
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ bytesPerSecond: 3_000_000, downloadedBytes: 4_000_000 }),
    );
    read("#5 DONE 2.0s\n#6 [deps 2/2] RUN pnpm install\n#6 3.1 Progress: downloaded 12\n");
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ fraction: 0.5, detail: "Progress: downloaded 12" }),
    );
  });
});
