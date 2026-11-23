import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

/** Transcription pieces aim for this length, cut at the nearest pause before it. */
export const SEGMENT_TARGET_SECONDS = 300;
/** How far back from the target a pause may be to cut there instead. */
const SEGMENT_SEARCH_SECONDS = 90;
const FFMPEG_TIMEOUT_MS = 15 * 60_000;
/** The longest a note decodes to: MAX_NOTE_MS (61 minutes) plus a few seconds of slack. */
export const DECODE_LIMIT_SECONDS = 61 * 60 + 5;
/**
 * Placed before `-i` on anything a member uploaded: stop reading after the limit, and let
 * the input name no protocol but a local file or a pipe (no network, no playlist fetches).
 */
const UNTRUSTED_INPUT = [
  "-t",
  String(DECODE_LIMIT_SECONDS),
  "-protocol_whitelist",
  "file,pipe",
];

/** ffmpeg could not convert the recording; the detail is for the server log, not the member. */
export class AudioConversionError extends Error {}

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

async function ffmpeg(
  args: string[],
  { timeoutMs = FFMPEG_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Audio conversion was cancelled."));
      return;
    }
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
    // A lost lease or a shutdown must not leave ffmpeg running.
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      done();
      reject(error);
    });
    child.on("close", (code) => {
      done();
      if (code === 0) resolve(stderr);
      else if (signal?.aborted) {
        reject(signal.reason ?? new Error("Audio conversion was cancelled."));
      } else {
        const detail = stderr.slice(-300).trim();
        reject(new AudioConversionError(`Audio conversion failed (${code}): ${detail}`));
      }
    });
  });
}

/** Re-encodes any browser recording into AAC in MP4, which every browser and phone plays. */
export async function toPlayableAudio(
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const log = await ffmpeg(
    [
      ...UNTRUSTED_INPUT,
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
    ],
    { signal },
  );
  return parseDecodedSeconds(log);
}

/** Seconds of audio ffmpeg wrote, from the last progress line of its log; null when none. */
export function parseDecodedSeconds(log: string): number | null {
  const matches = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
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
export async function decodeForSpeech(
  source: string,
  wav: string,
  signal?: AbortSignal,
): Promise<number> {
  await ffmpeg(
    [
      ...UNTRUSTED_INPUT,
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
    ],
    { signal },
  );
  const { size } = await stat(wav);
  return Math.max(0, (size - WAV_HEADER_BYTES) / SPEECH_BYTES_PER_SECOND);
}

/** Pauses in the speech WAV after `from` seconds, as absolute times. */
export async function pausesAfter(
  wav: string,
  from: number,
  signal?: AbortSignal,
): Promise<number[]> {
  const log = await ffmpeg(
    [
      "-ss",
      String(from),
      "-i",
      wav,
      "-af",
      "silencedetect=noise=-35dB:d=0.4",
      "-f",
      "null",
      "-",
    ],
    { signal },
  );
  return parseSilences(log).map((pause) => pause + from);
}

/** Cuts [from, to) out of the speech WAV as a small Opus file for a transcription request. */
export async function cutPiece(
  wav: string,
  from: number,
  to: number,
  target: string,
  signal?: AbortSignal,
) {
  await ffmpeg(
    [
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
    ],
    { signal },
  );
}

/**
 * True when the audio received so far clearly cannot hold a new piece yet, so the live pass
 * can skip decoding it. The length is estimated from the share of the declared bytes that
 * arrived, with a margin so an uneven bitrate never skips a piece that could have gone out.
 * Unknown sizes never skip. The final pass does not ask.
 */
export function liveHasNoPieceYet(input: {
  from: number;
  receivedBytes: number;
  declaredBytes: number;
  declaredSeconds: number;
}): boolean {
  const { from, receivedBytes, declaredBytes, declaredSeconds } = input;
  if (!(declaredBytes > 0) || !(declaredSeconds > 0) || !(receivedBytes > 0)) return false;
  const estimate = declaredSeconds * Math.min(1, receivedBytes / declaredBytes) * 1.25;
  // A piece needs LIVE_MIN_SECONDS of new audio short of the newest LIVE_MARGIN_SECONDS.
  return estimate < from + LIVE_MIN_SECONDS + LIVE_MARGIN_SECONDS;
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
