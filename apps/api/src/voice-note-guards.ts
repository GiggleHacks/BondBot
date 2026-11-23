/** Open (still uploading) voice notes one member may have at once. */
export const MAX_OPEN_NOTES = 20;
/** ffmpeg and transcription jobs that run at the same time in one process. */
export const MAX_CONCURRENT_JOBS = 2;

/** A declared size no honest upload has: under a byte a part, or more than the parts can hold. */
export function declareProblem(input: {
  bytes: number;
  parts: number;
  maxPartBytes: number;
}): string | null {
  if (input.bytes < input.parts || input.bytes > input.parts * input.maxPartBytes) {
    return "That voice note is not valid.";
  }
  return null;
}

/** A part that would carry the note past the size it was declared with. */
export function partProblem(input: {
  declaredBytes: number;
  storedBytes: number;
  incomingBytes: number;
}): string | null {
  if (input.storedBytes + input.incomingBytes > input.declaredBytes) {
    return "That part is larger than the voice note was declared to be.";
  }
  return null;
}

/** Whether decoded audio runs well past the length the device said it recorded. */
export function exceedsDeclaredDuration(decodedSeconds: number, declaredMs: number): boolean {
  return decodedSeconds > (declaredMs / 1000) * 1.1 + 2;
}

/**
 * Runs tasks with at most `max` at a time; the rest wait their turn in order. A slot is
 * always given back, whether the task succeeds or fails, and a waiter whose signal aborts
 * leaves the queue.
 */
export function createSemaphore(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    // The slot passes straight to the next waiter, so `active` stays as it is.
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async function limited<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (active < max) {
      active += 1;
    } else {
      await new Promise<void>((resolve, reject) => {
        const turn = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const at = waiting.indexOf(turn);
          if (at >= 0) waiting.splice(at, 1);
          reject(signal?.reason ?? new Error("Aborted"));
        };
        waiting.push(turn);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Directories under the voice-notes folder to delete: ones no note row owns, and ones a
 * finished note left behind. A directory touched within `graceMs` is never selected, so an
 * upload in flight is not pulled from under it. Names that are not ids are left alone.
 */
export function selectOrphanDirs(
  dirs: ReadonlyArray<{ name: string; mtimeMs: number }>,
  rows: ReadonlyArray<{ id: string; status: string }>,
  now: number,
  graceMs: number,
): string[] {
  const status = new Map(rows.map((row) => [row.id, row.status]));
  return dirs
    .filter((dir) => /^[\w-]{1,64}$/.test(dir.name) && now - dir.mtimeMs >= graceMs)
    .filter((dir) => !status.has(dir.name) || status.get(dir.name) === "done")
    .map((dir) => dir.name);
}
