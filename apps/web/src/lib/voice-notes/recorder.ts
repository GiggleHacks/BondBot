import type { LocalVoiceNote, VoiceNoteStore, VoiceNoteTarget } from "./store";

/** A slice of audio reaches storage this often, so a crash loses at most this much. */
export const SLICE_MS = 5_000;
/** Notes stop on their own after an hour. */
export const MAX_NOTE_MS = 60 * 60 * 1000;
/** Speech-quality Opus: an hour is about 15 MB. */
const AUDIO_BITS_PER_SECOND = 32_000;

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

export function recordingMimeType(
  supported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | undefined {
  return PREFERRED_TYPES.find((type) => supported(type));
}

export function voiceNotesSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

type WakeLockSentinelLike = { release(): Promise<void> };

/**
 * One recording at a time. Audio goes straight to the store in slices; nothing is
 * transcribed or sent while recording, so pauses never end the note.
 */
export class VoiceNoteRecorder {
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private note: LocalVoiceNote | null = null;
  private nextIndex = 0;
  private writes: Promise<void> = Promise.resolve();
  private stopped: Promise<void> | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: VoiceNoteStore,
    private readonly onLimit: () => void,
  ) {}

  get active(): boolean {
    return this.note !== null;
  }

  get startedAt(): number | null {
    return this.note?.startedAt ?? null;
  }

  /** Asks for the microphone and starts writing slices. Throws when the microphone is refused. */
  async start(input: { clientId: string; spaceId: string | null; target: VoiceNoteTarget }) {
    if (this.note) throw new Error("Already recording.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = recordingMimeType();
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      media = new MediaRecorder(stream);
    }
    const note: LocalVoiceNote = {
      clientId: input.clientId,
      spaceId: input.spaceId,
      target: input.target,
      mimeType: (media.mimeType || mimeType || "audio/webm").split(";")[0] ?? "audio/webm",
      startedAt: Date.now(),
      durationMs: 0,
      bytes: 0,
      chunkCount: 0,
      state: "recording",
    };
    await this.store.putNote(note);
    this.stream = stream;
    this.media = media;
    this.note = note;
    this.nextIndex = 0;
    this.stopped = new Promise<void>((resolve) => {
      media.onstop = () => resolve();
    });
    media.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const index = this.nextIndex++;
      const blob = event.data;
      note.bytes += blob.size;
      note.chunkCount = this.nextIndex;
      note.durationMs = Date.now() - note.startedAt;
      // Serialized, so the note row never claims a slice that is not stored yet.
      this.writes = this.writes
        .then(() => this.store.putChunk({ clientId: note.clientId, index, blob }))
        .then(() => this.store.putNote({ ...note }));
    };
    media.start(SLICE_MS);
    this.limitTimer = setTimeout(() => this.onLimit(), MAX_NOTE_MS);
    await this.holdScreen();
    return note;
  }

  /** Ends the recording. `send` queues it for upload; otherwise it is deleted. */
  async finish(send: boolean): Promise<LocalVoiceNote | null> {
    const note = this.note;
    const media = this.media;
    if (!note || !media) return null;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (media.state !== "inactive") media.stop();
    await this.stopped;
    await this.writes;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.media = null;
    this.stream = null;
    this.note = null;
    this.stopped = null;
    await this.releaseScreen();
    if (!send || note.chunkCount === 0) {
      await this.store.deleteNote(note.clientId);
      return null;
    }
    const queued: LocalVoiceNote = {
      ...note,
      durationMs: Date.now() - note.startedAt,
      state: "pending",
    };
    await this.store.putNote(queued);
    return queued;
  }

  private async holdScreen() {
    const lock = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!lock) return;
    try {
      this.wakeLock = await lock.request("screen");
    } catch {
      // Low battery or a hidden page refuses the lock; recording continues without it.
      this.wakeLock = null;
    }
  }

  private async releaseScreen() {
    const lock = this.wakeLock;
    this.wakeLock = null;
    if (lock) await lock.release().catch(() => undefined);
  }
}

/**
 * A note still marked recording when the app starts was cut off by a closed tab or a
 * crash: what reached storage is kept and sent like any other note.
 */
export async function recoverInterruptedNotes(
  store: VoiceNoteStore,
  activeClientId: string | null,
  now: number = Date.now(),
): Promise<void> {
  for (const note of await store.listNotes()) {
    if (note.state !== "recording" || note.clientId === activeClientId) continue;
    // Another tab still recording writes a slice every few seconds; leave its note alone.
    if (now - (note.startedAt + note.durationMs) < SLICE_MS * 6) continue;
    const chunks = await store.listChunks(note.clientId);
    if (chunks.length === 0) {
      await store.deleteNote(note.clientId);
      continue;
    }
    await store.putNote({
      ...note,
      state: "pending",
      chunkCount: chunks.length,
      bytes: chunks.reduce((sum, c) => sum + c.blob.size, 0),
    });
  }
}
