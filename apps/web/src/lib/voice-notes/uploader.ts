import type { LocalVoiceNote, VoiceNoteStore } from "./store";

/** Slices per upload part: two minutes of audio, well under a megabyte of Opus. */
export const SLICES_PER_PART = 24;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export type VoiceNoteFetch = (
  path: string,
  init: RequestInit & { spaceId: string | null },
) => Promise<Response>;

/** A refusal that sending again will not fix (the chat is gone, the note is too long). */
export class VoiceNoteRejected extends Error {}

export function partCount(chunkCount: number): number {
  return Math.ceil(chunkCount / SLICES_PER_PART);
}

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `Upload failed (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
  } catch {
    // Not JSON; the status says enough.
  }
  const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
  throw retryable ? new Error(message) : new VoiceNoteRejected(message);
}

/**
 * Declares the note and uploads the first `parts` parts the server lacks. Every step is
 * idempotent, so an upload cut off anywhere resumes where it stopped.
 */
async function uploadParts(
  store: VoiceNoteStore,
  note: LocalVoiceNote,
  send: VoiceNoteFetch,
  parts: number,
  onSent?: (sent: number) => void | Promise<void>,
): Promise<void> {
  const base = `/api/voice-notes/${encodeURIComponent(note.clientId)}`;
  const declared = await check(
    await send(base, {
      method: "PUT",
      spaceId: note.spaceId,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: note.target,
        mimeType: note.mimeType,
        durationMs: Math.round(note.durationMs),
        bytes: note.bytes,
        parts,
        recordedAt: new Date(note.startedAt).toISOString(),
      }),
    }),
  );
  const { received } = (await declared.json()) as { received?: number[] };
  const have = new Set(Array.isArray(received) ? received : []);
  const chunks = await store.listChunks(note.clientId);
  let sent = [...have].filter((part) => part < parts).length;
  await onSent?.(sent);
  for (let part = 0; part < parts; part += 1) {
    if (have.has(part)) continue;
    const slice = chunks.slice(part * SLICES_PER_PART, (part + 1) * SLICES_PER_PART);
    const body = new Blob(
      slice.map((c) => c.blob),
      { type: note.mimeType },
    );
    await check(
      await send(`${base}/parts/${part}`, {
        method: "PUT",
        spaceId: note.spaceId,
        headers: { "content-type": "application/octet-stream" },
        body,
      }),
    );
    sent += 1;
    await onSent?.(sent);
  }
}

/** Sends a finished note: every remaining part, then asks the server to finish it. */
export async function uploadNote(
  store: VoiceNoteStore,
  note: LocalVoiceNote,
  send: VoiceNoteFetch,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const parts = partCount(note.chunkCount);
  await uploadParts(store, note, send, parts, async (sent) => {
    if (sent > 0) await store.putNote({ ...note, state: "uploading", uploadedParts: sent });
    onProgress?.(sent / parts);
  });
  await check(
    await send(`/api/voice-notes/${encodeURIComponent(note.clientId)}/complete`, {
      method: "POST",
      spaceId: note.spaceId,
    }),
  );
}

/**
 * While recording: uploads every part that is already full, so the server can transcribe
 * as the note grows. Best effort only; the device copy stays the source of truth, and
 * whatever this misses (no signal in an elevator) is sent when the note is finished.
 */
export async function uploadFinishedParts(
  store: VoiceNoteStore,
  note: LocalVoiceNote,
  send: VoiceNoteFetch,
): Promise<number> {
  const parts = Math.floor(note.chunkCount / SLICES_PER_PART);
  if (parts === 0) return 0;
  await uploadParts(store, note, send, parts);
  return parts;
}

export type DrainResult = { sent: string[]; failed: string[] };

/**
 * Uploads every queued note, oldest first. Notes that fail on a network or server error
 * wait with backoff; a refused note stays failed until the person retries or deletes it.
 */
export async function drainQueue(
  store: VoiceNoteStore,
  send: VoiceNoteFetch,
  options: {
    now?: () => number;
    onChange?: () => void;
    onProgress?: (clientId: string, fraction: number) => void;
  } = {},
): Promise<DrainResult> {
  const now = options.now ?? Date.now;
  const result: DrainResult = { sent: [], failed: [] };
  for (const note of await store.listNotes()) {
    const waiting = note.state === "pending" || note.state === "uploading";
    if (!waiting || (note.retryAt !== undefined && note.retryAt > now())) continue;
    await store.putNote({ ...note, state: "uploading", error: undefined });
    options.onChange?.();
    try {
      await uploadNote(store, note, send, (f) => options.onProgress?.(note.clientId, f));
      // The server has the audio now; the device copy is no longer needed.
      await store.deleteNote(note.clientId);
      result.sent.push(note.clientId);
    } catch (error) {
      const attempts = (note.attempts ?? 0) + 1;
      const rejected = error instanceof VoiceNoteRejected;
      await store.putNote({
        ...note,
        state: rejected ? "failed" : "pending",
        error: error instanceof Error ? error.message : String(error),
        attempts,
        retryAt: rejected ? undefined : now() + retryDelayMs(attempts),
      });
      result.failed.push(note.clientId);
      // Offline: the rest would fail the same way.
      if (!rejected) {
        options.onChange?.();
        break;
      }
    }
    options.onChange?.();
  }
  return result;
}
