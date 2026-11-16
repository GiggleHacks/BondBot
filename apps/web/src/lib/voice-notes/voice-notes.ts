import { selectedSpaceId, withSpaceHeaders } from "../rpc";
import { recoverInterruptedNotes, VoiceNoteRecorder, voiceNotesSupported } from "./recorder";
import type { LocalVoiceNote, VoiceNoteStore, VoiceNoteTarget } from "./store";
import { indexedDbVoiceNoteStore, memoryVoiceNoteStore } from "./store";
import type { VoiceNoteFetch } from "./uploader";
import { drainQueue, SLICES_PER_PART, uploadFinishedParts } from "./uploader";

/** Queued notes are tried again this often while the app is open, on top of `online`. */
const SWEEP_MS = 30_000;

export type VoiceNotesSnapshot = {
  recording: { clientId: string; startedAt: number; target: VoiceNoteTarget } | null;
  /** Notes on this device that the server does not have yet. */
  queue: LocalVoiceNote[];
  progress: Record<string, number>;
  online: boolean;
  /** Notes the server has and is still working on (or that failed there). */
  server: ServerVoiceNote[];
};

export type ServerVoiceNote = {
  clientId: string;
  status: "queued" | "transcribing" | "sending" | "failed";
  target: VoiceNoteTarget;
  durationMs: number;
  segmentsDone: number;
  segmentsTotal: number;
  error: string | null;
};

const send_: VoiceNoteFetch = (path, { spaceId, headers, ...init }) =>
  fetch(path, { ...init, credentials: "include", headers: withSpaceHeaders(headers, spaceId) });

/** Uploads while recording give up on a dead connection (an elevator) instead of hanging. */
const LIVE_REQUEST_TIMEOUT_MS = 90_000;
const liveSend: VoiceNoteFetch = (path, init) =>
  send_(path, { ...init, signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS) });

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The device side of voice notes: record to storage, keep a queue, and upload it whenever
 * the connection allows. One instance per page; tabs share the queue through IndexedDB and
 * take turns uploading through a Web Lock.
 */
export class VoiceNotes {
  private snapshot: VoiceNotesSnapshot = {
    recording: null,
    queue: [],
    progress: {},
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    server: [],
  };
  private readonly listeners = new Set<() => void>();
  private readonly recorder: VoiceNoteRecorder;
  private draining: Promise<void> | null = null;
  private again = false;
  private started = false;
  private starting: { stop: boolean | null } | null = null;
  private serverReading = false;
  private serverAgain = false;

  constructor(private readonly store: VoiceNoteStore) {
    this.recorder = new VoiceNoteRecorder(
      store,
      () => void this.stop(true),
      (note) => this.liveSlice(note),
    );
  }

  get state(): VoiceNotesSnapshot {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceNotesSnapshot => this.snapshot;

  private set(next: Partial<VoiceNotesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  private async refresh() {
    const queue = (await this.store.listNotes()).filter((n) => n.state !== "recording");
    this.set({ queue });
  }

  /** Recovers interrupted recordings and starts sending; safe to call more than once. */
  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    window.addEventListener("online", () => {
      this.set({ online: true });
      this.kick(true);
      // Back from an elevator mid-recording: catch up on the parts that waited.
      this.liveUpload();
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.kick();
      this.serverChanged();
    });
    setInterval(() => this.kick(), SWEEP_MS);
    void recoverInterruptedNotes(this.store, null)
      .then(() => this.refresh())
      .then(() => {
        this.kick();
        this.serverChanged();
      });
  }

  private recordingClientId(): string | null {
    return this.snapshot.recording?.clientId ?? null;
  }

  /** Starting: the microphone prompt may still be open. */
  get busy(): boolean {
    return this.starting !== null;
  }

  async record(input: { spaceId: string | null; target: VoiceNoteTarget }) {
    if (this.recorder.active || this.starting) return;
    const clientId = newClientId();
    this.starting = { stop: null };
    const starting = this.starting;
    try {
      const note = await this.recorder.start({ clientId, ...input });
      this.set({ recording: { clientId, startedAt: note.startedAt, target: note.target } });
    } finally {
      this.starting = null;
    }
    // Released (or discarded) before the microphone opened.
    if (starting.stop !== null) await this.stop(starting.stop);
  }

  /** `send` queues the note (and uploads it when online); otherwise it is discarded. */
  async stop(send: boolean) {
    if (this.starting) {
      this.starting.stop = send;
      return;
    }
    if (!this.recorder.active) return;
    const clientId = this.snapshot.recording?.clientId ?? null;
    this.set({ recording: null });
    await this.recorder.finish(send);
    // The queue takes over from here; let a part already on its way land first.
    await this.live;
    this.liveParts = 0;
    if (!send && clientId && this.liveDeclared.has(clientId)) {
      // Parts went up while recording; the server drops its copy too.
      this.liveDeclared.delete(clientId);
      await send_(`/api/voice-notes/${encodeURIComponent(clientId)}`, {
        method: "DELETE",
        spaceId: selectedSpaceId(),
      }).catch(() => undefined);
    }
    await this.refresh();
    if (send) this.kick(true);
  }

  async discard(clientId: string) {
    await this.store.deleteNote(clientId);
    await this.refresh();
  }

  async retry(clientId: string) {
    const note = await this.store.getNote(clientId);
    if (!note || note.state === "recording") return;
    await this.store.putNote({ ...note, state: "pending", retryAt: undefined, error: undefined });
    await this.refresh();
    this.kick(true);
  }

  private live: Promise<void> = Promise.resolve();
  private liveParts = 0;
  private liveBusy = false;
  private liveAgain = false;
  private readonly liveDeclared = new Set<string>();

  /** A slice of the current recording was stored; upload any part it just completed. */
  private liveSlice(note: LocalVoiceNote) {
    if (Math.floor(note.chunkCount / SLICES_PER_PART) > this.liveParts) this.liveUpload();
  }

  /** Uploads the current recording's finished parts. Offline or failing, it simply waits. */
  private liveUpload() {
    const clientId = this.snapshot.recording?.clientId;
    if (!clientId || typeof navigator === "undefined" || !navigator.onLine) return;
    if (this.liveBusy) {
      this.liveAgain = true;
      return;
    }
    this.liveBusy = true;
    this.live = (async () => {
      try {
        do {
          this.liveAgain = false;
          const note = await this.store.getNote(clientId);
          if (!note || note.state !== "recording") break;
          this.liveParts = await uploadFinishedParts(this.store, note, liveSend);
          if (this.liveParts > 0) this.liveDeclared.add(clientId);
        } while (this.liveAgain && this.snapshot.recording?.clientId === clientId);
      } catch {
        // No signal or a server hiccup: the parts stay on the device and go up later.
      } finally {
        this.liveBusy = false;
      }
    })();
  }

  /** Re-reads the server's notes; called when the live stream says they changed. */
  serverChanged() {
    if (typeof window === "undefined" || this.serverReading) {
      this.serverAgain = true;
      return;
    }
    this.serverReading = true;
    void (async () => {
      try {
        do {
          this.serverAgain = false;
          const res = await send_("/api/voice-notes", { method: "GET", spaceId: selectedSpaceId() });
          if (!res.ok) break;
          const body = (await res.json()) as { notes?: ServerVoiceNote[] };
          this.set({ server: Array.isArray(body.notes) ? body.notes : [] });
        } while (this.serverAgain);
      } catch {
        // Offline; the stream signals again when it reconnects.
      } finally {
        this.serverReading = false;
      }
    })();
  }

  async retryOnServer(clientId: string) {
    await send_(`/api/voice-notes/${encodeURIComponent(clientId)}/retry`, {
      method: "POST",
      spaceId: selectedSpaceId(),
    });
    this.serverChanged();
  }

  async deleteOnServer(clientId: string) {
    await send_(`/api/voice-notes/${encodeURIComponent(clientId)}`, {
      method: "DELETE",
      spaceId: selectedSpaceId(),
    });
    this.serverChanged();
  }

  /** Starts an upload pass; `now` ignores backoff (the connection just came back). */
  kick(now = false) {
    if (now) void this.clearBackoff().then(() => this.drain());
    else void this.drain();
  }

  private async clearBackoff() {
    for (const note of await this.store.listNotes()) {
      if (note.state === "pending" && note.retryAt !== undefined) {
        await this.store.putNote({ ...note, retryAt: undefined });
      }
    }
  }

  private drain(): Promise<void> {
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = (async () => {
      do {
        this.again = false;
        // Picks up a note another tab was recording when it closed.
        await recoverInterruptedNotes(this.store, this.recordingClientId());
        await this.withLock(() =>
          drainQueue(this.store, send_, {
            onChange: () => void this.refresh(),
            onProgress: (clientId, fraction) =>
              this.set({ progress: { ...this.snapshot.progress, [clientId]: fraction } }),
          }),
        );
        await this.refresh();
        this.serverChanged();
      } while (this.again);
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async withLock(work: () => Promise<unknown>) {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) {
      await work();
      return;
    }
    // Another tab already uploading means this pass has nothing to add.
    await locks.request("rakazo-voice-notes-upload", { ifAvailable: true }, async (lock) => {
      if (lock) await work();
    });
  }
}

function createStore(): VoiceNoteStore {
  try {
    if (typeof indexedDB !== "undefined") return indexedDbVoiceNoteStore();
  } catch {
    // Private modes can block IndexedDB; notes then live only while the tab is open.
  }
  return memoryVoiceNoteStore();
}

export const voiceNotes = new VoiceNotes(createStore());
export { voiceNotesSupported };
