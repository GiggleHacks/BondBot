import { selectedSpaceId, withSpaceHeaders } from "../rpc";
import { timeoutSignal } from "../timeout-signal";
import { recoverInterruptedNotes, VoiceNoteRecorder, voiceNotesSupported } from "./recorder";
import type { LocalVoiceNote, VoiceNoteStore, VoiceNoteTarget } from "./store";
import { failoverVoiceNoteStore, indexedDbVoiceNoteStore, memoryVoiceNoteStore } from "./store";
import type { VoiceNoteFetch } from "./uploader";
import {
  drainQueue,
  retryDelayMs,
  SLICES_PER_PART,
  uploadFinishedParts,
  VoiceNoteCancelled,
  VoiceNoteRejected,
} from "./uploader";

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
  /** Notes just let go of, still being closed on the device (local addition: they show in the chat at once). */
  finishing: { clientId: string; durationMs: number; target: VoiceNoteTarget }[];
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

/**
 * Every request gives up after a while: a half-open connection must not hold the upload lock
 * (and the draining flag) forever. The timer is left to run out on success, because it also
 * covers reading the response body; aborting a finished request does nothing.
 */
function makeSend(timeoutMs: (path: string) => number): VoiceNoteFetch {
  return async (path, { spaceId, headers, signal, ...init }) => {
    const timeout = timeoutSignal(timeoutMs(path), signal);
    try {
      return await fetch(path, {
        ...init,
        signal: timeout.signal,
        credentials: "include",
        headers: withSpaceHeaders(headers, spaceId),
      });
    } catch (error) {
      timeout.clear();
      if (timeout.signal.aborted && !signal?.aborted) throw new Error("The request timed out.");
      throw error;
    }
  };
}

const REQUEST_TIMEOUT_MS = 60_000;
/** A part is a few hundred kilobytes: allow a slow mobile connection more time. */
const PART_TIMEOUT_MS = 180_000;
const send_ = makeSend((path) =>
  /\/parts\/\d+$/.test(path) ? PART_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
);

/** Uploads while recording give up on a dead connection (an elevator) instead of hanging. */
const LIVE_REQUEST_TIMEOUT_MS = 90_000;
const liveSend = makeSend(() => LIVE_REQUEST_TIMEOUT_MS);

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
    finishing: [],
  };
  private readonly listeners = new Set<() => void>();
  private readonly recorder: VoiceNoteRecorder;
  private draining: Promise<void> | null = null;
  private again = false;
  private started = false;
  private starting: { stop: boolean | null } | null = null;
  private serverReading = false;
  private serverAgain = false;
  private readonly noticeListeners = new Set<(text: string) => void>();

  constructor(private readonly store: VoiceNoteStore) {
    this.recorder = new VoiceNoteRecorder(
      store,
      () => void this.stop(true),
      (note) => this.liveSlice(note),
      {
        // The microphone was taken away or storage failed: keep and send what exists.
        onInterrupted: (message) => {
          this.notify(message);
          void this.stop(true);
        },
        onNotice: (message) => this.notify(message),
      },
    );
  }

  /** Short messages for the person ("could not save the recording"); the composer shows them. */
  subscribeNotice = (listener: (text: string) => void): (() => void) => {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  };

  private notify(text: string) {
    for (const listener of this.noticeListeners) listener(text);
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
      this.liveUpload(true);
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.kick();
      this.serverChanged();
    });
    setInterval(() => {
      // A hidden tab with nothing waiting has nothing to send and nothing to ask the server.
      if (document.visibilityState === "hidden" && this.snapshot.queue.length === 0) return;
      this.kick();
    }, SWEEP_MS);
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
    const recording = this.snapshot.recording;
    const dropFinishing = () =>
      this.set({ finishing: this.snapshot.finishing.filter((note) => note.clientId !== clientId) });
    this.set({
      recording: null,
      finishing:
        send && recording
          ? [
              ...this.snapshot.finishing,
              {
                clientId: recording.clientId,
                durationMs: Math.max(0, Date.now() - recording.startedAt),
                target: recording.target,
              },
            ]
          : this.snapshot.finishing,
    });
    try {
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
      dropFinishing();
      if (send) this.kick(true);
    } catch {
      // Callers fire and forget; a storage failure ends here as a message, not a rejection.
      dropFinishing();
      this.liveParts = 0;
      this.notify("Could not save the recording");
      void this.refresh().catch(() => undefined);
    }
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
  /** Failed live uploads wait (with backoff); a refused one is not tried again for this note. */
  private liveFail = { clientId: null as string | null, failures: 0, retryAt: 0, refused: false };

  /** A slice of the current recording was stored; upload any part it just completed. */
  private liveSlice(note: LocalVoiceNote) {
    if (Math.floor(note.chunkCount / SLICES_PER_PART) > this.liveParts) this.liveUpload();
  }

  /** Uploads the current recording's finished parts. Offline or failing, it simply waits. */
  private liveUpload(now = false) {
    const clientId = this.snapshot.recording?.clientId;
    if (!clientId || typeof navigator === "undefined" || !navigator.onLine) return;
    if (this.liveFail.clientId !== clientId) {
      this.liveFail = { clientId, failures: 0, retryAt: 0, refused: false };
    }
    if (this.liveFail.refused || (!now && Date.now() < this.liveFail.retryAt)) return;
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
          this.liveFail = { clientId, failures: 0, retryAt: 0, refused: false };
        } while (this.liveAgain && this.snapshot.recording?.clientId === clientId);
      } catch (error) {
        // No signal or a server hiccup: the parts stay on the device and go up later, after
        // a wait that grows. A refusal will not change, so the finished note carries everything.
        if (!(error instanceof VoiceNoteCancelled)) {
          const failures = this.liveFail.failures + 1;
          this.liveFail = {
            clientId,
            failures,
            retryAt: Date.now() + retryDelayMs(failures),
            refused: error instanceof VoiceNoteRejected,
          };
        }
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
    // The first IndexedDB failure (blocked, full, broken) moves the notes to memory for good.
    if (typeof indexedDB !== "undefined") return failoverVoiceNoteStore(indexedDbVoiceNoteStore());
  } catch {
    // Private modes can block IndexedDB; notes then live only while the tab is open.
  }
  return memoryVoiceNoteStore();
}

export const voiceNotes = new VoiceNotes(createStore());
export { voiceNotesSupported };
