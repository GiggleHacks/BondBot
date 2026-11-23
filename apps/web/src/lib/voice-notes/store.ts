/**
 * Voice notes live on the device until the server has them: the recording is written
 * here a few seconds at a time, so a closed tab, a crash or a lost connection never
 * loses more than the last slice, and the queue survives reloads while offline.
 */

export type VoiceNoteState = "recording" | "pending" | "uploading" | "sent" | "failed";

/** Where the finished note is delivered: the chat the composer was showing. */
export type VoiceNoteTarget = { botId: string } | { groupId: string };

export type LocalVoiceNote = {
  clientId: string;
  spaceId: string | null;
  target: VoiceNoteTarget;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  bytes: number;
  chunkCount: number;
  state: VoiceNoteState;
  /** Upload parts the server has confirmed, so a resumed upload skips them. */
  uploadedParts?: number;
  error?: string;
  /** Failed uploads wait this long before the next try. */
  retryAt?: number;
  attempts?: number;
};

export type VoiceNoteChunk = { clientId: string; index: number; blob: Blob };

export interface VoiceNoteStore {
  putNote(note: LocalVoiceNote): Promise<void>;
  getNote(clientId: string): Promise<LocalVoiceNote | undefined>;
  listNotes(): Promise<LocalVoiceNote[]>;
  deleteNote(clientId: string): Promise<void>;
  putChunk(chunk: VoiceNoteChunk): Promise<void>;
  /** Chunks in recording order. */
  listChunks(clientId: string): Promise<VoiceNoteChunk[]>;
}

const DB_NAME = "rakazo-voice-notes";
const DB_VERSION = 1;
const NOTES = "notes";
const CHUNKS = "chunks";

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

let opening: Promise<IDBDatabase> | null = null;

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES))
        db.createObjectStore(NOTES, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: ["clientId", "index"] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading must not be blocked by this one.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error("Could not open voice note storage"));
    };
  });
  return opening;
}

function chunkRange(clientId: string): IDBKeyRange {
  return IDBKeyRange.bound([clientId, 0], [clientId, Number.MAX_SAFE_INTEGER]);
}

export function indexedDbVoiceNoteStore(factory: IDBFactory = indexedDB): VoiceNoteStore {
  async function tx(stores: string[], mode: IDBTransactionMode) {
    const db = await openDb(factory);
    return db.transaction(stores, mode);
  }
  return {
    async putNote(note) {
      const t = await tx([NOTES], "readwrite");
      t.objectStore(NOTES).put(note);
      await done(t);
    },
    async getNote(clientId) {
      const t = await tx([NOTES], "readonly");
      return (await request(t.objectStore(NOTES).get(clientId))) as LocalVoiceNote | undefined;
    },
    async listNotes() {
      const t = await tx([NOTES], "readonly");
      const notes = (await request(t.objectStore(NOTES).getAll())) as LocalVoiceNote[];
      return notes.sort((a, b) => a.startedAt - b.startedAt);
    },
    async deleteNote(clientId) {
      const t = await tx([NOTES, CHUNKS], "readwrite");
      t.objectStore(NOTES).delete(clientId);
      t.objectStore(CHUNKS).delete(chunkRange(clientId));
      await done(t);
    },
    async putChunk(chunk) {
      const t = await tx([CHUNKS], "readwrite");
      t.objectStore(CHUNKS).put(chunk);
      await done(t);
    },
    async listChunks(clientId) {
      const t = await tx([CHUNKS], "readonly");
      const chunks = (await request(
        t.objectStore(CHUNKS).getAll(chunkRange(clientId)),
      )) as VoiceNoteChunk[];
      return chunks.sort((a, b) => a.index - b.index);
    },
  };
}

/** For tests and for browsers without IndexedDB (the note then lives only while the tab does). */
export function memoryVoiceNoteStore(): VoiceNoteStore {
  const notes = new Map<string, LocalVoiceNote>();
  const chunks = new Map<string, VoiceNoteChunk>();
  const key = (clientId: string, index: number) => `${clientId}\u0000${index}`;
  return {
    async putNote(note) {
      notes.set(note.clientId, { ...note });
    },
    async getNote(clientId) {
      const note = notes.get(clientId);
      return note ? { ...note } : undefined;
    },
    async listNotes() {
      return [...notes.values()].map((n) => ({ ...n })).sort((a, b) => a.startedAt - b.startedAt);
    },
    async deleteNote(clientId) {
      notes.delete(clientId);
      for (const [k, c] of chunks) if (c.clientId === clientId) chunks.delete(k);
    },
    async putChunk(chunk) {
      chunks.set(key(chunk.clientId, chunk.index), chunk);
    },
    async listChunks(clientId) {
      return [...chunks.values()]
        .filter((c) => c.clientId === clientId)
        .sort((a, b) => a.index - b.index);
    },
  };
}

/**
 * Wraps a store that can fail (IndexedDB blocked, full or broken): the first failure moves
 * writes to memory for the rest of the page's life, so recording still works, and reads look
 * in both places so nothing already saved is lost from view.
 */
export function failoverVoiceNoteStore(
  primary: VoiceNoteStore,
  fallback: VoiceNoteStore = memoryVoiceNoteStore(),
): VoiceNoteStore {
  let failed = false;
  const write = async <T>(run: (store: VoiceNoteStore) => Promise<T>): Promise<T> => {
    if (!failed) {
      try {
        return await run(primary);
      } catch {
        failed = true;
      }
    }
    return run(fallback);
  };
  const read = async <T>(run: (store: VoiceNoteStore) => Promise<T>): Promise<T | undefined> => {
    try {
      return await run(primary);
    } catch {
      failed = true;
      return undefined;
    }
  };
  return {
    putNote: (note) => write((store) => store.putNote(note)),
    putChunk: (chunk) => write((store) => store.putChunk(chunk)),
    async getNote(clientId) {
      return (await fallback.getNote(clientId)) ?? (await read((store) => store.getNote(clientId)));
    },
    async listNotes() {
      const merged = new Map<string, LocalVoiceNote>();
      for (const note of (await read((store) => store.listNotes())) ?? []) {
        merged.set(note.clientId, note);
      }
      // What lives in memory is newer than whatever IndexedDB still holds for the same note.
      for (const note of await fallback.listNotes()) merged.set(note.clientId, note);
      return [...merged.values()].sort((a, b) => a.startedAt - b.startedAt);
    },
    async deleteNote(clientId) {
      await fallback.deleteNote(clientId);
      await read((store) => store.deleteNote(clientId));
    },
    async listChunks(clientId) {
      const merged = new Map<number, VoiceNoteChunk>();
      for (const chunk of (await read((store) => store.listChunks(clientId))) ?? []) {
        merged.set(chunk.index, chunk);
      }
      for (const chunk of await fallback.listChunks(clientId)) merged.set(chunk.index, chunk);
      return [...merged.values()].sort((a, b) => a.index - b.index);
    },
  };
}
