import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

/** Transcription pieces aim for this length, cut at the nearest pause before it. */
export const SEGMENT_TARGET_SECONDS = 300;
/** How far back from the target a pause may be to cut there instead. */
const SEGMENT_SEARCH_SECONDS = 90;
const FFMPEG_TIMEOUT_MS = 15 * 60_000;

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

async function ffmpeg(args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // silencedetect reports on stderr; keep enough of a long run to read every pause.
      stderr = (stderr + chunk).slice(-4_000_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`Audio conversion failed (${code}): ${stderr.slice(-300).trim()}`));
    });
  });
}

/** Re-encodes any browser recording into AAC in MP4, which every browser and phone plays. */
export async function toPlayableAudio(source: string, target: string): Promise<void> {
  await ffmpeg([
    "-i",
    source,
    "-vn",
    "-ac",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-movflags",
    "+faststart",
    target,
  ]);
}

/** Midpoints of the pauses ffmpeg's silencedetect reported, in seconds. */
export function parseSilences(log: string): number[] {
  const points: number[] = [];
  const pattern = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g;
  for (const match of log.matchAll(pattern)) {
    const end = Number(match[1]);
    const length = Number(match[2]);
    if (Number.isFinite(end) && Number.isFinite(length)) points.push(end - length / 2);
  }
  return points;
}

export function parseDurationSeconds(log: string): number | null {
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Where to cut a recording: about every `target` seconds, at the last pause before each
 * mark when one is close enough, so a word is not split between two pieces.
 */
export function cutPoints(
  durationSeconds: number,
  silences: readonly number[],
  target = SEGMENT_TARGET_SECONDS,
  search = SEGMENT_SEARCH_SECONDS,
): number[] {
  const cuts: number[] = [];
  let last = 0;
  // The final piece may run up to half a target over rather than leave a sliver.
  while (durationSeconds - last > target * 1.5) {
    const mark = last + target;
    const pause = silences.filter((s) => s > mark - search && s <= mark).at(-1);
    const cut = pause ?? mark;
    cuts.push(Number(cut.toFixed(2)));
    last = cut;
  }
  return cuts;
}

/**
 * Splits the recording into speech-ready pieces (16 kHz mono Opus, about 3 KB a second),
 * cut at pauses. Returns the piece files in order.
 */
export async function splitForTranscription(source: string, dir: string): Promise<string[]> {
  const log = await ffmpeg([
    "-i",
    source,
    "-af",
    "silencedetect=noise=-35dB:d=0.4",
    "-f",
    "null",
    "-",
  ]);
  const duration = parseDurationSeconds(log) ?? 0;
  const cuts = cutPoints(duration, parseSilences(log));
  await ffmpeg([
    "-i",
    source,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    "-f",
    "segment",
    ...(cuts.length ? ["-segment_times", cuts.join(",")] : ["-segment_time", "100000"]),
    "-reset_timestamps",
    "1",
    path.join(dir, "seg-%03d.ogg"),
  ]);
  const files = (await readdir(dir)).filter((name) => /^seg-\d{3}\.ogg$/.test(name)).sort();
  return files.map((name) => path.join(dir, name));
}
