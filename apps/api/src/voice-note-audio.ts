import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

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

/** 16 kHz mono 16-bit PCM: what speech models want, and its length is exact from its size. */
const SPEECH_BYTES_PER_SECOND = 32_000;
const WAV_HEADER_BYTES = 44;
/** While recording, the newest audio waits this long so a cut never splits a word in progress. */
export const LIVE_MARGIN_SECONDS = 20;
/** While recording, a piece is transcribed once at least this much new audio is ready. */
export const LIVE_MIN_SECONDS = 90;

/** Decodes any recording (or a prefix of one still being uploaded) to speech WAV; returns seconds. */
export async function decodeForSpeech(source: string, wav: string): Promise<number> {
  await ffmpeg([
    "-i",
    source,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    wav,
  ]);
  const { size } = await stat(wav);
  return Math.max(0, (size - WAV_HEADER_BYTES) / SPEECH_BYTES_PER_SECOND);
}

/** Pauses in the speech WAV after `from` seconds, as absolute times. */
export async function pausesAfter(wav: string, from: number): Promise<number[]> {
  const log = await ffmpeg([
    "-ss",
    String(from),
    "-i",
    wav,
    "-af",
    "silencedetect=noise=-35dB:d=0.4",
    "-f",
    "null",
    "-",
  ]);
  return parseSilences(log).map((pause) => pause + from);
}

/** Cuts [from, to) out of the speech WAV as a small Opus file for a transcription request. */
export async function cutPiece(wav: string, from: number, to: number, target: string) {
  await ffmpeg([
    "-ss",
    String(from),
    "-t",
    String(Math.max(0.1, to - from)),
    "-i",
    wav,
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    target,
  ]);
}

/**
 * Where the next pieces end, starting at `from` (what is already transcribed). A finished
 * note is planned to its end; a note still recording stops short of its newest audio and
 * waits until enough new speech has arrived to be worth a request.
 */
export function planPieces(input: {
  from: number;
  duration: number;
  pauses: readonly number[];
  final: boolean;
  target?: number;
  search?: number;
}): number[] {
  const { from, duration, pauses, final } = input;
  const target = input.target ?? SEGMENT_TARGET_SECONDS;
  const search = input.search ?? SEGMENT_SEARCH_SECONDS;
  if (final) {
    if (duration - from < 0.5) return [];
    const relative = pauses.filter((p) => p > from).map((p) => p - from);
    const cuts = cutPoints(duration - from, relative, target, search).map((c) =>
      Number((c + from).toFixed(2)),
    );
    return [...cuts, Number(duration.toFixed(2))];
  }
  const frontier = duration - LIVE_MARGIN_SECONDS;
  const ends: number[] = [];
  let last = from;
  while (frontier - last >= LIVE_MIN_SECONDS) {
    const mark = Math.min(last + target, frontier);
    const pause = pauses.filter((p) => p > mark - search && p <= mark && p > last + 10).at(-1);
    const cut = Number((pause ?? mark).toFixed(2));
    ends.push(cut);
    last = cut;
  }
  return ends;
}
