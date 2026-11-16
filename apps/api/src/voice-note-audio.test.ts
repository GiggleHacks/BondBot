import { describe, expect, it } from "vitest";
import { cutPoints, parseDurationSeconds, parseSilences } from "./voice-note-audio.js";

describe("voice note pieces", () => {
  it("reads pauses and duration from ffmpeg's log", () => {
    const log = [
      "  Duration: 00:12:30.50, start: 0.000000, bitrate: 48 kb/s",
      "[silencedetect @ 0x1] silence_start: 10",
      "[silencedetect @ 0x1] silence_end: 11 | silence_duration: 1",
      "[silencedetect @ 0x1] silence_end: 290.4 | silence_duration: 0.8",
    ].join("\n");
    expect(parseDurationSeconds(log)).toBe(750.5);
    expect(parseSilences(log)).toEqual([10.5, 290]);
  });

  it("keeps a short note whole", () => {
    expect(cutPoints(400, [])).toEqual([]);
  });

  it("cuts at the last pause before each mark", () => {
    expect(cutPoints(1000, [100, 250, 290, 310, 560, 590])).toEqual([290, 590]);
  });

  it("cuts at the mark when no pause is near it", () => {
    expect(cutPoints(1000, [50])).toEqual([300, 600]);
  });

  it("splits an hour into about twelve pieces", () => {
    expect(cutPoints(3600, []).length).toBe(11);
  });
});
