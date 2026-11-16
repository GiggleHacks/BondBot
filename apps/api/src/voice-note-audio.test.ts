import { describe, expect, it } from "vitest";
import {
  cutPoints,
  LIVE_MARGIN_SECONDS,
  parseDurationSeconds,
  parseSilences,
  planPieces,
} from "./voice-note-audio.js";

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

  it("waits while recording until enough new speech is in", () => {
    expect(planPieces({ from: 0, duration: 100, pauses: [], final: false })).toEqual([]);
  });

  it("transcribes while recording up to a pause short of the newest audio", () => {
    const ends = planPieces({ from: 0, duration: 240, pauses: [50, 180, 215], final: false });
    expect(ends).toEqual([215]);
    expect(ends.every((end) => end <= 240 - LIVE_MARGIN_SECONDS)).toBe(true);
  });

  it("continues from where live transcription stopped", () => {
    expect(planPieces({ from: 180, duration: 260, pauses: [], final: false })).toEqual([]);
    expect(planPieces({ from: 180, duration: 400, pauses: [370], final: false })).toEqual([370]);
  });

  it("finishes a sent note to its very end", () => {
    expect(planPieces({ from: 180, duration: 260.5, pauses: [], final: true })).toEqual([260.5]);
    expect(planPieces({ from: 260.5, duration: 260.6, pauses: [], final: true })).toEqual([]);
  });

  it("splits a long untranscribed tail into pieces at pauses", () => {
    expect(planPieces({ from: 0, duration: 1000, pauses: [290, 590], final: true })).toEqual([
      290, 590, 1000,
    ]);
  });
});
