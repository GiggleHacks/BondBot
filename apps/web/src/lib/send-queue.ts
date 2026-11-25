// Local addition: sends live on the device until the server has them.
// Hit send and the message is already in the chat. The upload waits for a
// connection, shows speed, and can be cancelled. A photo picked before a voice
// note rides along with that note.
import { inferAttachmentMimeType, isImageInputConfirmation } from "@rakazo/core";
import { readFileAsBase64 } from "./composer/pending-attachments";
import { prepareImage } from "./composer/prepare-image";
import {
  createSpaceRpc,
  recheckSessionOnUnauthorized,
  selectedSpaceId,
  withSpaceHeaders,
} from "./query/rpc";
import { SpeedTracker, xhrSend } from "./upload-progress";

export type SendTarget = { botId: string } | { groupId: string };

export type QueuedFile = {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  artifactId?: string;
  uploadNonce: string;
};

export type SendItem = {
  clientNonce: string;
  spaceId: string | null;
  target: SendTarget;
  text?: string;
  mentions?: unknown[];
  imageHandling: "confirm" | "file";
  replyToMessageId?: string;
  replyQuote?: string;
  fromPage?: true;
  files: QueuedFile[];
  createdAt: number;
  state: "pending" | "uploading" | "failed" | "confirm";
  error?: string;
  loaded: number;
  total: number;
  fraction: number;
  bps: number;
  attempts?: number;
  retryAt?: number;
};

export type VoiceCompanion = {
  voiceClientId: string;
  index: number;
  name: string;
  mimeType: string;
  blob: Blob;
  artifactId?: string;
  uploadNonce: string;
};

type Snapshot = {
  items: SendItem[];
  companions: VoiceCompanion[];
  previews: Record<string, string[]>;
  voicePreviews: Record<string, string[]>;
  online: boolean;
};

const DB_NAME = "rakazo-send-queue";
const DB_VERSION = 1;
const SENDS = "sends";
const COMPANIONS = "companions";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

type Store = {
  putSend(item: SendItem): Promise<void>;
  listSends(): Promise<SendItem[]>;
  deleteSend(clientNonce: string): Promise<void>;
  putCompanions(rows: VoiceCompanion[]): Promise<void>;
  listCompanions(voiceClientId?: string): Promise<VoiceCompanion[]>;
  deleteCompanions(voiceClientId: string): Promise<void>;
};

function memoryStore(): Store {
  const sends = new Map<string, SendItem>();
  const companions = new Map<string, VoiceCompanion>();
  const key = (row: VoiceCompanion) => `${row.voiceClientId}\u0000${row.index}`;
  return {
    async putSend(item) {
      sends.set(item.clientNonce, item);
    },
    async listSends() {
      return [...sends.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
    async deleteSend(clientNonce) {
      sends.delete(clientNonce);
    },
    async putCompanions(rows) {
      for (const row of rows) companions.set(key(row), row);
    },
    async listCompanions(voiceClientId) {
      return [...companions.values()]
        .filter((row) => !voiceClientId || row.voiceClientId === voiceClientId)
        .sort((a, b) => a.index - b.index);
    },
    async deleteCompanions(voiceClientId) {
      for (const [k, row] of companions) if (row.voiceClientId === voiceClientId) companions.delete(k);
    },
  };
}

function idbStore(): Store {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SENDS)) db.createObjectStore(SENDS, { keyPath: "clientNonce" });
        if (!db.objectStoreNames.contains(COMPANIONS)) {
          db.createObjectStore(COMPANIONS, { keyPath: ["voiceClientId", "index"] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error ?? new Error("Could not open the send queue"));
      };
    });
    return opening;
  };
  async function tx(names: string[], mode: IDBTransactionMode) {
    const db = await open();
    return db.transaction(names, mode);
  }
  return {
    async putSend(item) {
      const t = await tx([SENDS], "readwrite");
      t.objectStore(SENDS).put(item);
      await done(t);
    },
    async listSends() {
      const t = await tx([SENDS], "readonly");
      const rows = (await request(t.objectStore(SENDS).getAll())) as SendItem[];
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
    async deleteSend(clientNonce) {
      const t = await tx([SENDS], "readwrite");
      t.objectStore(SENDS).delete(clientNonce);
      await done(t);
    },
    async putCompanions(rows) {
      if (!rows.length) return;
      const t = await tx([COMPANIONS], "readwrite");
      for (const row of rows) t.objectStore(COMPANIONS).put(row);
      await done(t);
    },
    async listCompanions(voiceClientId) {
      const t = await tx([COMPANIONS], "readonly");
      const rows = (await request(t.objectStore(COMPANIONS).getAll())) as VoiceCompanion[];
      return rows
        .filter((row) => !voiceClientId || row.voiceClientId === voiceClientId)
        .sort((a, b) => a.index - b.index);
    },
    async deleteCompanions(voiceClientId) {
      const rows = await this.listCompanions(voiceClientId);
      if (!rows.length) return;
      const t = await tx([COMPANIONS], "readwrite");
      for (const row of rows) t.objectStore(COMPANIONS).delete([row.voiceClientId, row.index]);
      await done(t);
    },
  };
}

function openStore(): Store {
  try {
    if (typeof indexedDB !== "undefined") return idbStore();
  } catch {
    // Private mode: the queue lives until the tab closes.
  }
  return memoryStore();
}

const previewUrls = new Map<string, string>();

function previewFor(key: string, blob: Blob, mime: string): string | undefined {
  if (!mime.startsWith("image/")) return undefined;
  const existing = previewUrls.get(key);
  if (existing) return existing;
  try {
    const url = URL.createObjectURL(blob);
    previewUrls.set(key, url);
    return url;
  } catch {
    return undefined;
  }
}

function dropPreviews(prefix: string) {
  for (const [key, url] of previewUrls) {
    if (!key.startsWith(prefix)) continue;
    URL.revokeObjectURL(url);
    previewUrls.delete(key);
  }
}

type RpcError = Error & { status?: number; data?: { reason?: unknown } };

function asRpcError(status: number, text: string): RpcError {
  let message = `Upload failed (${status}).`;
  let data: { reason?: unknown } | undefined;
  try {
    const body = JSON.parse(text) as { message?: string; data?: { reason?: unknown } };
    if (body.message) message = body.message;
    data = body.data;
  } catch {
    // The status is enough.
  }
  const error = new Error(message) as RpcError;
  error.status = status;
  error.data = data;
  return error;
}

function retryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const status = (error as { status?: number }).status;
  if (status === undefined) return true;
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

class SendQueue {
  private store = openStore();
  private memory = memoryStore();
  private failedOver = false;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = {
    items: [],
    companions: [],
    previews: {},
    voicePreviews: {},
    online: true,
  };
  private started = false;
  private draining: Promise<void> | null = null;
  private again = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private speeds = new Map<string, SpeedTracker>();
  private aborts = new Map<string, AbortController>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  private async write(run: (store: Store) => Promise<void>) {
    if (!this.failedOver) {
      try {
        await run(this.store);
        return;
      } catch {
        this.failedOver = true;
      }
    }
    await run(this.memory);
  }

  private async readSends(): Promise<SendItem[]> {
    try {
      const primary = await this.store.listSends();
      if (!this.failedOver) return primary;
    } catch {
      this.failedOver = true;
    }
    return this.memory.listSends();
  }

  private async readCompanions(voiceClientId?: string): Promise<VoiceCompanion[]> {
    try {
      const primary = await this.store.listCompanions(voiceClientId);
      if (!this.failedOver) return primary;
    } catch {
      this.failedOver = true;
    }
    return this.memory.listCompanions(voiceClientId);
  }

  private publish(items: SendItem[], companions: VoiceCompanion[]) {
    const previews: Record<string, string[]> = {};
    for (const item of items) {
      const urls = item.files
        .map((file) => previewFor(`send:${item.clientNonce}:${file.id}`, file.blob, file.mimeType))
        .filter((url): url is string => Boolean(url));
      if (urls.length) previews[item.clientNonce] = urls;
    }
    const voicePreviews: Record<string, string[]> = {};
    for (const row of companions) {
      const url = previewFor(`voice:${row.voiceClientId}:${row.index}`, row.blob, row.mimeType);
      if (!url) continue;
      const list = voicePreviews[row.voiceClientId] ?? [];
      list[row.index] = url;
      voicePreviews[row.voiceClientId] = list;
    }
    this.set({
      items,
      companions,
      previews,
      voicePreviews,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    });
  }

  private async refresh() {
    const items = await this.readSends();
    const merged = items.map((item) => {
      const live = this.snapshot.items.find((row) => row.clientNonce === item.clientNonce);
      if (!live || (live.state !== "uploading" && live.state !== "pending")) return item;
      if (live.loaded === 0 && !live.files.some((file) => file.artifactId)) return item;
      return {
        ...item,
        files: live.files,
        loaded: live.loaded,
        total: live.total || item.total,
        fraction: live.fraction,
        bps: live.bps,
        state: live.state === "uploading" ? live.state : item.state,
      };
    });
    this.publish(merged, await this.readCompanions());
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.set({ online: navigator.onLine });
    window.addEventListener("online", () => {
      this.set({ online: true });
      this.kick();
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    void this.refresh().then(() => this.kick());
  }

  async enqueue(input: Omit<SendItem, "createdAt" | "state" | "loaded" | "total" | "fraction" | "bps">) {
    this.start();
    const item: SendItem = {
      ...input,
      createdAt: Date.now(),
      state: "pending",
      loaded: 0,
      total: input.files.reduce((sum, file) => sum + file.blob.size, 0),
      fraction: 0,
      bps: 0,
    };
    await this.write((store) => store.putSend(item));
    await this.refresh();
    this.kick();
  }

  /** Photos selected before the voice note. Shown at once, uploaded with the note. */
  previewCompanions(
    voiceClientId: string,
    files: { name: string; mimeType: string; file: Blob }[],
  ): Promise<void> {
    const rows: VoiceCompanion[] = files.map((file, index) => ({
      voiceClientId,
      index,
      name: file.name,
      mimeType:
        file.mimeType || inferAttachmentMimeType(file.name, file.mimeType) || "application/octet-stream",
      blob: file.file,
      uploadNonce: `voice-photo:${voiceClientId}:${index}`,
    }));
    const others = this.snapshot.companions.filter((row) => row.voiceClientId !== voiceClientId);
    this.publish(this.snapshot.items, [...others, ...rows]);
    return this.write((store) =>
      store.deleteCompanions(voiceClientId).then(() => store.putCompanions(rows)),
    );
  }

  async clearVoiceCompanions(voiceClientId: string) {
    dropPreviews(`voice:${voiceClientId}:`);
    await this.write((store) => store.deleteCompanions(voiceClientId));
    await this.refresh();
  }

  companionArtifactIds(voiceClientId: string): string[] {
    return this.snapshot.companions
      .filter((row) => row.voiceClientId === voiceClientId && row.artifactId)
      .sort((a, b) => a.index - b.index)
      .map((row) => row.artifactId!);
  }

  abortVoice(voiceClientId: string) {
    this.aborts.get(`voice:${voiceClientId}`)?.abort();
  }

  async uploadVoiceCompanions(
    voiceClientId: string,
    target: SendTarget,
    spaceId: string | null,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<string[]> {
    const rows = (await this.readCompanions(voiceClientId)).sort((a, b) => a.index - b.index);
    if (!rows.length) return [];
    const controller = new AbortController();
    this.aborts.set(`voice:${voiceClientId}`, controller);
    const total = rows.reduce((sum, row) => sum + Math.ceil(row.blob.size * 1.4) + 256, 0);
    let base = 0;
    const ids: string[] = [];
    try {
    for (const row of rows) {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!row.artifactId) {
        const id = await this.uploadFile(
          { ...row, id: String(row.index), blob: row.blob, uploadNonce: row.uploadNonce },
          target,
          spaceId,
          `voice:${voiceClientId}`,
          (loaded, fileTotal) => onProgress(base + loaded, Math.max(total, base + fileTotal)),
        );
        row.artifactId = id;
        await this.write((store) => store.putCompanions([row]));
      }
      ids.push(row.artifactId);
      base += Math.ceil(row.blob.size * 1.4) + 256;
      onProgress(base, total);
    }
    await this.refresh();
    return ids;
    } finally {
      this.aborts.delete(`voice:${voiceClientId}`);
    }
  }

  async cancel(clientNonce: string) {
    this.aborts.get(clientNonce)?.abort();
    this.aborts.delete(clientNonce);
    dropPreviews(`send:${clientNonce}:`);
    this.speeds.delete(clientNonce);
    await this.write((store) => store.deleteSend(clientNonce));
    await this.refresh();
  }

  async retry(clientNonce: string) {
    const item = (await this.readSends()).find((row) => row.clientNonce === clientNonce);
    if (!item) return;
    item.state = "pending";
    item.error = undefined;
    item.retryAt = undefined;
    await this.write((store) => store.putSend(item));
    await this.refresh();
    this.kick();
  }

  async sendAsFile(clientNonce: string) {
    const item = (await this.readSends()).find((row) => row.clientNonce === clientNonce);
    if (!item) return;
    item.imageHandling = "file";
    item.state = "pending";
    item.error = undefined;
    await this.write((store) => store.putSend(item));
    await this.refresh();
    this.kick();
  }

  private kick() {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  private scheduleRetry(items: SendItem[]) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const now = Date.now();
    let earliest = Number.POSITIVE_INFINITY;
    for (const item of items) {
      if (item.state === "pending" && item.retryAt !== undefined) {
        if (item.retryAt < earliest) earliest = item.retryAt;
      }
    }
    if (!Number.isFinite(earliest)) return;
    const delay = Math.max(250, earliest - now);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, delay);
  }

  private async drain() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    for (const listed of await this.readSends()) {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const item = (await this.readSends()).find((row) => row.clientNonce === listed.clientNonce);
      if (!item || item.state === "failed" || item.state === "confirm") continue;
      if (item.retryAt !== undefined && item.retryAt > Date.now()) continue;
      item.state = "uploading";
      item.error = undefined;
      await this.write((store) => store.putSend(item));
      await this.refresh();
      const controller = new AbortController();
      this.aborts.set(item.clientNonce, controller);
      try {
        const artifactIds = await this.uploadAll(item, controller.signal);
        if (controller.signal.aborted) return;
        const spaceRpc = createSpaceRpc(item.spaceId ?? selectedSpaceId());
        await spaceRpc.threads.send({
          ...item.target,
          clientNonce: item.clientNonce,
          imageHandling: item.imageHandling,
          ...(item.text ? { text: item.text } : {}),
          ...(item.mentions?.length ? { mentions: item.mentions } : {}),
          ...(artifactIds.length ? { artifactIds } : {}),
          ...(item.replyToMessageId ? { replyToMessageId: item.replyToMessageId } : {}),
          ...(item.replyQuote ? { replyQuote: item.replyQuote } : {}),
          ...(item.fromPage ? { fromPage: true as const } : {}),
        } as never);
        await this.cancel(item.clientNonce);
      } catch (error) {
        if (controller.signal.aborted || !(await this.readSends()).some((row) => row.clientNonce === item.clientNonce)) {
          continue;
        }
        const status = (error as { status?: number }).status;
        if (status === 401) recheckSessionOnUnauthorized(status);
        if (isImageInputConfirmation(error)) {
          item.state = "confirm";
          item.error = error instanceof Error ? error.message : "This model can't read images";
          item.retryAt = undefined;
        } else if (!retryable(error)) {
          item.state = "failed";
          item.error = error instanceof Error ? error.message : "Could not send";
          item.retryAt = undefined;
        } else {
          const attempts = (item.attempts ?? 0) + 1;
          item.state = "pending";
          item.attempts = attempts;
          item.error = error instanceof Error ? error.message : "Could not send";
          item.retryAt = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
        }
        await this.write((store) => store.putSend(item));
        await this.refresh();
        if (item.state === "pending") break;
      } finally {
        this.aborts.delete(item.clientNonce);
      }
    }
    this.scheduleRetry(await this.readSends());
  }

  private async uploadAll(item: SendItem, signal: AbortSignal): Promise<string[]> {
    const ids: string[] = [];
    let base = 0;
    const estimate = item.files.reduce((sum, file) => sum + Math.ceil(file.blob.size * 1.4) + 256, 0);
    for (const file of item.files) {
      if (!file.artifactId) {
        file.artifactId = await this.uploadFile(file, item.target, item.spaceId, item.clientNonce, (loaded, total) => {
          this.sample(item, base + loaded, Math.max(estimate, base + total));
        }, signal);
        await this.write((store) => store.putSend(item));
      }
      ids.push(file.artifactId);
      base += Math.ceil(file.blob.size * 1.4) + 256;
      this.sample(item, base, Math.max(estimate, base));
    }
    return ids;
  }

  private sample(item: SendItem, loaded: number, total: number) {
    const tracker = this.speeds.get(item.clientNonce) ?? new SpeedTracker();
    this.speeds.set(item.clientNonce, tracker);
    const meter = tracker.sample(loaded, total);
    item.loaded = meter.loaded;
    item.total = meter.total;
    item.fraction = meter.fraction;
    item.bps = meter.bps;
    this.publish(this.snapshot.items.map((row) => (row.clientNonce === item.clientNonce ? item : row)), this.snapshot.companions);
  }

  private async uploadFile(
    file: QueuedFile,
    target: SendTarget,
    spaceId: string | null,
    abortKey: string,
    onProgress: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const prepared = await prepareImage(new File([file.blob], file.name, { type: file.mimeType }));
    const mimeType = inferAttachmentMimeType(prepared.name, prepared.type) || file.mimeType;
    const contentBase64 = await readFileAsBase64(prepared);
    const body = JSON.stringify({
      ...target,
      name: file.name,
      mimeType,
      contentBase64,
      clientNonce: file.uploadNonce,
    });
    const headers = withSpaceHeaders({ "content-type": "application/json" }, spaceId ?? selectedSpaceId());
    const controller = new AbortController();
    const parent = this.aborts.get(abortKey);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    parent?.signal.addEventListener("abort", onAbort);
    try {
      const res = await xhrSend({
        url: "/rpc/artifacts/create",
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        onProgress,
      });
      if (!res.ok) throw asRpcError(res.status, await res.text());
      const artifact = (await res.json()) as { id?: string };
      if (!artifact.id) throw new Error("Upload failed.");
      return artifact.id;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      parent?.signal.removeEventListener("abort", onAbort);
    }
  }
}

export const sendQueue = new SendQueue();
