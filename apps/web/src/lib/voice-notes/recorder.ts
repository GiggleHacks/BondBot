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

/** How long finishing waits for the browser's own `stop` event before carrying on without it. */
const STOP_WAIT_MS = 3_000;
const INTERRUPTED = "Recording interrupted. What was recorded is being sent.";

export type RecorderEvents = {
  /**
   * The recording ended by itself (microphone taken away, recorder error, storage full):
   * the owner should finish it, keeping what was saved, and tell the person why.
   */
  onInterrupted?: (message: string) => void;
  /** Worth telling the person, but the recording carries on or is already ending. */
  onNotice?: (message: string) => void;
};

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
  private stored = 0;
  private storedBytes = 0;
  private writeFailed = false;
  private stopping = false;
  private finishing: Promise<LocalVoiceNote | null> | null = null;
  private interrupted = false;
  private stopped: Promise<void> | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: VoiceNoteStore,
    private readonly onLimit: () => void,
    /** Each slice once it is stored: lets finished parts upload while still recording. */
    private readonly onSlice?: (note: LocalVoiceNote) => void,
    private readonly events: RecorderEvents = {},
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
    try {
      return await this.begin(stream, input);
    } catch (error) {
      // The microphone is open but nothing can record or store: do not leave it running.
      this.release(stream);
      await this.store.deleteNote(input.clientId).catch(() => undefined);
      throw error;
    }
  }

  private async begin(
    stream: MediaStream,
    input: { clientId: string; spaceId: string | null; target: VoiceNoteTarget },
  ): Promise<LocalVoiceNote> {
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
    this.stored = 0;
    this.storedBytes = 0;
    this.writeFailed = false;
    this.stopping = false;
    this.interrupted = false;
    this.writes = Promise.resolve();
    this.stopped = new Promise<void>((resolve) => {
      media.onstop = () => {
        resolve();
        // Nobody asked it to stop: a phone call, Siri or the system took the microphone.
        if (!this.stopping) this.interrupt(INTERRUPTED);
      };
    });
    media.onerror = () => this.interrupt(INTERRUPTED);
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", this.onTrackEnded);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    media.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const index = this.nextIndex++;
      const blob = event.data;
      note.bytes += blob.size;
      note.chunkCount = this.nextIndex;
      note.durationMs = Date.now() - note.startedAt;
      // Serialized, so the note row never claims a slice that is not stored yet. A failed
      // write must not wedge the chain: it ends the recording and keeps what was saved.
      this.writes = this.writes
        .then(async () => {
          if (this.writeFailed) return;
          await this.store.putChunk({ clientId: note.clientId, index, blob });
          this.stored = index + 1;
          this.storedBytes += blob.size;
          const saved = { ...note, chunkCount: this.stored, bytes: this.storedBytes };
          await this.store.putNote(saved);
          this.onSlice?.(saved);
        })
        .catch(() => {
          this.writeFailed = true;
          const message = "Could not save the recording. What was saved is being sent.";
          if (this.stopping) this.events.onNotice?.(message);
          else this.interrupt(message);
        });
    };
    media.start(SLICE_MS);
    this.limitTimer = setTimeout(() => this.onLimit(), MAX_NOTE_MS);
    await this.holdScreen();
    return note;
  }

  private readonly onTrackEnded = () =>
    this.interrupt(INTERRUPTED);

  /** Hidden pages (a call, the screen locking) may never fire the next slice: store it now. */
  private readonly onVisibility = () => {
    const media = this.media;
    if (document.visibilityState !== "hidden" || !media || media.state !== "recording") return;
    try {
      media.requestData();
    } catch {
      // The recorder is already ending.
    }
  };

  private interrupt(message: string) {
    if (!this.note || this.stopping || this.interrupted) return;
    this.interrupted = true;
    this.events.onInterrupted?.(message);
  }

  /** Always stops the microphone and forgets the recording, whatever state it was in. */
  private release(stream: MediaStream | null = this.stream) {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener("ended", this.onTrackEnded);
      try {
        track.stop();
      } catch {
        // Already gone.
      }
    }
    this.media = null;
    this.stream = null;
    this.note = null;
    this.stopped = null;
  }

  /** Ends the recording. `send` queues it for upload; otherwise it is deleted. */
  finish(send: boolean): Promise<LocalVoiceNote | null> {
    // An interruption and the person's own tap can both end it: the first one does the work.
    this.finishing ??= this.endRecording(send).finally(() => {
      this.finishing = null;
    });
    return this.finishing;
  }

  private async endRecording(send: boolean): Promise<LocalVoiceNote | null> {
    const note = this.note;
    const media = this.media;
    if (!note || !media) return null;
    this.stopping = true;
    try {
      if (media.state !== "inactive") media.stop();
      let wait: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.stopped,
        new Promise<void>((resolve) => {
          wait = setTimeout(resolve, STOP_WAIT_MS);
        }),
      ]);
      clearTimeout(wait);
      await this.writes;
    } finally {
      // Whatever went wrong above, the microphone and the screen lock must be let go.
      this.release();
      await this.releaseScreen();
    }
    if (!send || this.stored === 0) {
      await this.store.deleteNote(note.clientId);
      return null;
    }
    const queued: LocalVoiceNote = {
      ...note,
      chunkCount: this.stored,
      bytes: this.storedBytes,
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
