import { selectedSpaceId, withSpaceHeaders } from "../query/rpc";
import { sendQueue } from "../send-queue";
import { SpeedTracker, xhrSend } from "../upload-progress";
import { timeoutSignal } from "../timeout-signal";
import { recoverInterruptedNotes, VoiceNoteRecorder, voiceNotesSupported } from "./recorder";
import type { LocalVoiceNote, VoiceNoteStore, VoiceNoteTarget } from "./store";
import { failoverVoiceNoteStore, indexedDbVoiceNoteStore, memoryVoiceNoteStore } from "./store";
import type { VoiceNoteFetch } from "./uploader";
import { drainQueue, VoiceNoteRejected } from "./uploader";

/** Queued notes are tried again this often while the app is open, on top of `online`. */
const SWEEP_MS = 30_000;

export type VoiceNotesSnapshot = {
  recording: { clientId: string; startedAt: number; target: VoiceNoteTarget } | null;
  /** Notes on this device that the server does not have yet. */
  queue: LocalVoiceNote[];
  progress: Record<string, number>;
  /** Byte progress for the bar and speed under a note that is still going out. */
  meters: Record<string, { fraction: number; loaded: number; total: number; bps: number }>;
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
    meters: {},
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    server: [],
    finishing: [],
  };
  private readonly listeners = new Set<() => void>();
  private readonly recorder: VoiceNoteRecorder;
  private draining: Promise<void> | null = null;
  private again = false;
  private started = false;
  private starting: { clientId: string; stop: boolean | null } | null = null;
  private stagedWrite: Promise<void> = Promise.resolve();
  private readonly speeds = new Map<string, SpeedTracker>();
  private readonly uploadAborts = new Map<string, AbortController>();
  private readonly uploadProgress = new Map<
    string,
    { compLoaded: number; compTotal: number; audioLoaded: number; audioTotal: number }
  >();
  private serverReading = false;
  private serverAgain = false;
  private readonly noticeListeners = new Set<(text: string) => void>();

  constructor(private readonly store: VoiceNoteStore) {
    this.recorder = new VoiceNoteRecorder(
      store,
      () => void this.stop(true),
      undefined,
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
      // Recording stays on the device. Coming back online only drains what was already sent.
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.kick();
      this.serverChanged();
    });
    setInterval(() => {
      // Nothing waiting locally: no need to poll IndexedDB or /api/voice-notes on a timer.
      if (this.snapshot.queue.length === 0) return;
      this.kick();
    }, SWEEP_MS);
    void recoverInterruptedNotes(this.store, null)
      .then(() => this.refresh())
      .then(() => {
        if (this.snapshot.queue.length > 0) this.kick();
        this.serverChanged();
      });
  }

  private recordingClientId(): string | null {
    return this.snapshot.recording?.clientId ?? this.starting?.clientId ?? null;
  }

  /** Starting: the microphone prompt may still be open. */
  get busy(): boolean {
    return this.starting !== null;
  }

  async record(input: { spaceId: string | null; target: VoiceNoteTarget }) {
    if (this.recorder.active || this.starting) return;
    const clientId = newClientId();
    this.starting = { clientId, stop: null };
    const starting = this.starting;
    try {
      const note = await this.recorder.start({ clientId, ...input });
      this.set({ recording: { clientId, startedAt: note.startedAt, target: note.target } });
    } catch (error) {
      await sendQueue.clearVoiceCompanions(clientId).catch(() => undefined);
      throw error;
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
      await this.stagedWrite;
      this.stagedWrite = Promise.resolve();
      if (!send && clientId) {
        await sendQueue.clearVoiceCompanions(clientId);
      }
      await this.refresh();
      dropFinishing();
      if (send) this.kick(true);
    } catch {
      // Callers fire and forget; a storage failure ends here as a message, not a rejection.
      dropFinishing();
      this.notify("Could not save the recording");
      void this.refresh().catch(() => undefined);
    }
  }

  /** Photos the person picked before tapping send on this recording. */
  stageCompanions(files: { name: string; mimeType: string; file: Blob }[]) {
    const clientId = this.recordingClientId();
    if (!clientId) return;
    this.stagedWrite = sendQueue.previewCompanions(clientId, files);
  }

  private noteMeter(clientId: string, loaded: number, total: number) {
    const tracker = this.speeds.get(clientId) ?? new SpeedTracker();
    this.speeds.set(clientId, tracker);
    const meter = tracker.sample(loaded, total);
    this.set({ meters: { ...this.snapshot.meters, [clientId]: meter } });
  }

  private clearNoteTracking(clientId: string) {
    this.uploadAborts.delete(clientId);
    this.uploadProgress.delete(clientId);
    this.speeds.delete(clientId);
    if (clientId in this.snapshot.meters || clientId in this.snapshot.progress) {
      const meters = { ...this.snapshot.meters };
      const progress = { ...this.snapshot.progress };
      delete meters[clientId];
      delete progress[clientId];
      this.set({ meters, progress });
    }
  }

  async discard(clientId: string) {
    this.uploadAborts.get(clientId)?.abort();
    sendQueue.abortVoice(clientId);
    await this.store.deleteNote(clientId);
    await sendQueue.clearVoiceCompanions(clientId);
    this.clearNoteTracking(clientId);
    await this.refresh();
  }

  async retry(clientId: string) {
    const note = await this.store.getNote(clientId);
    if (!note || note.state === "recording") return;
    await this.store.putNote({ ...note, state: "pending", retryAt: undefined, error: undefined });
    await this.refresh();
    this.kick(true);
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
        let sentAny = false;
        await this.withLock(async () => {
          const send: VoiceNoteFetch = async (path, init) => {
            const match = path.match(/\/api\/voice-notes\/([^/]+)\/parts\//);
            if (!(init.body instanceof Blob) || !match?.[1]) return send_(path, init);
            const clientId = decodeURIComponent(match[1]);
            const track = this.uploadProgress.get(clientId);
            const audioBase = track?.audioLoaded ?? 0;
            const partSize = init.body.size;
            return xhrSend({
              url: path,
              method: init.method ?? "PUT",
              headers: withSpaceHeaders(init.headers, init.spaceId),
              body: init.body,
              signal: init.signal ?? undefined,
              onProgress: (loaded, total) => {
                const current = this.uploadProgress.get(clientId);
                if (!current) return;
                const combinedTotal = Math.max(
                  current.compTotal + current.audioTotal,
                  current.compTotal + audioBase + total,
                );
                this.noteMeter(clientId, current.compLoaded + audioBase + loaded, combinedTotal || 1);
              },
            }).then((res) => {
              const current = this.uploadProgress.get(clientId);
              if (current && res.ok) {
                current.audioLoaded = Math.min(current.audioTotal, audioBase + partSize);
              }
              return res;
            });
          };
          const drained = await drainQueue(this.store, send, {
            onChange: () => void this.refresh(),
            signalFor: (clientId) => {
              const controller = new AbortController();
              this.uploadAborts.set(clientId, controller);
              return controller.signal;
            },
            beforeUpload: async (note) => {
              this.uploadProgress.set(note.clientId, {
                compLoaded: 0,
                compTotal: 0,
                audioLoaded: 0,
                audioTotal: note.bytes,
              });
              try {
                await sendQueue.uploadVoiceCompanions(
                  note.clientId,
                  note.target,
                  note.spaceId,
                  (loaded, total) => {
                    const current = this.uploadProgress.get(note.clientId);
                    if (!current) return;
                    current.compLoaded = loaded;
                    current.compTotal = total;
                    this.noteMeter(note.clientId, loaded, total + current.audioTotal || 1);
                  },
                );
              } catch (error) {
                const status = (error as { status?: number }).status;
                if (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 408 && status !== 429) {
                  throw new VoiceNoteRejected(error instanceof Error ? error.message : "Could not upload attached files.");
                }
                throw error;
              }
            },
            onProgress: (clientId, fraction) => {
              const current = this.uploadProgress.get(clientId);
              if (current) {
                current.audioLoaded = fraction * current.audioTotal;
                const total = current.compTotal + current.audioTotal;
                this.noteMeter(clientId, current.compLoaded + current.audioLoaded, total || 1);
              }
              this.set({ progress: { ...this.snapshot.progress, [clientId]: fraction } });
            },
            completeBody: async (note) => {
              const ids = sendQueue.companionArtifactIds(note.clientId);
              return ids.length ? JSON.stringify({ companionArtifactIds: ids }) : undefined;
            },
            onDone: (clientId) => {
              this.uploadAborts.delete(clientId);
              this.uploadProgress.delete(clientId);
            },
          });
          sentAny = drained.sent.length > 0;
          for (const clientId of drained.sent) {
            await sendQueue.clearVoiceCompanions(clientId);
            this.clearNoteTracking(clientId);
          }
        });
        await this.refresh();
        if (sentAny) this.serverChanged();
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
