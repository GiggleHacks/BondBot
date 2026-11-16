import { describe, expect, it } from "vitest";
import type { LocalVoiceNote } from "./store";
import { memoryVoiceNoteStore } from "./store";
import type { VoiceNoteFetch } from "./uploader";
import {
  drainQueue,
  partCount,
  retryDelayMs,
  SLICES_PER_PART,
  uploadFinishedParts,
} from "./uploader";

function note(overrides: Partial<LocalVoiceNote> = {}): LocalVoiceNote {
  return {
    clientId: "n1",
    spaceId: "s1",
    target: { botId: "b1" },
    mimeType: "audio/webm",
    startedAt: 1_000,
    durationMs: 60_000,
    bytes: 0,
    chunkCount: 0,
    state: "pending",
    ...overrides,
  };
}

async function seed(chunks: number, overrides: Partial<LocalVoiceNote> = {}) {
  const store = memoryVoiceNoteStore();
  await store.putNote(note({ chunkCount: chunks, bytes: chunks, ...overrides }));
  for (let index = 0; index < chunks; index += 1) {
    await store.putChunk({ clientId: "n1", index, blob: new Blob([String(index % 10)]) });
  }
  return store;
}

type Call = { path: string; method: string; body?: BodyInit | null };

function fakeServer(options: { received?: number[]; failPart?: number; status?: number } = {}) {
  const calls: Call[] = [];
  const send: VoiceNoteFetch = async (path, init) => {
    calls.push({ path, method: String(init.method), body: init.body });
    if (options.failPart !== undefined && path.endsWith(`/parts/${options.failPart}`)) {
      return new Response(JSON.stringify({ error: "boom" }), { status: options.status ?? 503 });
    }
    if (init.method === "PUT" && !path.includes("/parts/")) {
      return Response.json({ received: options.received ?? [] });
    }
    return new Response(null, { status: 204 });
  };
  return { calls, send };
}

describe("voice note uploads", () => {
  it("splits slices into parts", () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(SLICES_PER_PART)).toBe(1);
    expect(partCount(SLICES_PER_PART + 1)).toBe(2);
  });

  it("uploads every part, completes, then deletes the device copy", async () => {
    const store = await seed(SLICES_PER_PART * 2 + 3);
    const server = fakeServer();
    const result = await drainQueue(store, server.send);
    expect(result.sent).toEqual(["n1"]);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /api/voice-notes/n1",
      "PUT /api/voice-notes/n1/parts/0",
      "PUT /api/voice-notes/n1/parts/1",
      "PUT /api/voice-notes/n1/parts/2",
      "POST /api/voice-notes/n1/complete",
    ]);
    const last = server.calls[3]?.body as Blob;
    expect(await last.text()).toBe("890");
    expect(await store.listNotes()).toEqual([]);
    expect(await store.listChunks("n1")).toEqual([]);
  });

  it("skips parts the server already has", async () => {
    const store = await seed(SLICES_PER_PART * 3);
    const server = fakeServer({ received: [0, 2] });
    await drainQueue(store, server.send);
    const parts = server.calls.filter((c) => c.path.includes("/parts/")).map((c) => c.path);
    expect(parts).toEqual(["/api/voice-notes/n1/parts/1"]);
  });

  it("keeps the note and backs off when the network or server fails", async () => {
    const store = await seed(5);
    const server = fakeServer({ failPart: 0 });
    const result = await drainQueue(store, server.send, { now: () => 10_000 });
    expect(result.failed).toEqual(["n1"]);
    const kept = await store.getNote("n1");
    expect(kept?.state).toBe("pending");
    expect(kept?.retryAt).toBe(10_000 + retryDelayMs(1));
    expect(await store.listChunks("n1")).toHaveLength(5);
    // Not due yet: nothing is sent.
    const again = fakeServer();
    await drainQueue(store, again.send, { now: () => 10_001 });
    expect(again.calls).toEqual([]);
    await drainQueue(store, again.send, { now: () => 10_000 + retryDelayMs(1) });
    expect(await store.listNotes()).toEqual([]);
  });

  it("marks a refused note failed without retrying it", async () => {
    const store = await seed(2);
    const server = fakeServer({ failPart: 0, status: 404 });
    await drainQueue(store, server.send);
    const kept = await store.getNote("n1");
    expect(kept?.state).toBe("failed");
    expect(kept?.error).toBe("boom");
    const again = fakeServer();
    await drainQueue(store, again.send, { now: () => Number.MAX_SAFE_INTEGER });
    expect(again.calls).toEqual([]);
  });

  it("leaves notes still recording alone", async () => {
    const store = await seed(2, { state: "recording" });
    const server = fakeServer();
    await drainQueue(store, server.send);
    expect(server.calls).toEqual([]);
  });

  it("uploads only full parts while recording, and leaves the note recording", async () => {
    const store = await seed(SLICES_PER_PART * 2 + 5, { state: "recording" });
    const server = fakeServer();
    const sent = await uploadFinishedParts(store, (await store.getNote("n1"))!, server.send);
    expect(sent).toBe(2);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /api/voice-notes/n1",
      "PUT /api/voice-notes/n1/parts/0",
      "PUT /api/voice-notes/n1/parts/1",
    ]);
    expect(JSON.parse(String(server.calls[0]?.body)).parts).toBe(2);
    expect((await store.getNote("n1"))?.state).toBe("recording");
  });

  it("keeps everything on the device when the connection drops mid-recording", async () => {
    const store = await seed(SLICES_PER_PART * 2, { state: "recording" });
    const dead: VoiceNoteFetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(
      uploadFinishedParts(store, (await store.getNote("n1"))!, dead),
    ).rejects.toThrow();
    expect(await store.listChunks("n1")).toHaveLength(SLICES_PER_PART * 2);
    expect((await store.getNote("n1"))?.state).toBe("recording");
  });

  it("sends only what the server lacks once the finished note is queued", async () => {
    const store = await seed(SLICES_PER_PART * 2 + 3);
    // Part 0 went up while recording; part 1 was lost in an elevator.
    const server = fakeServer({ received: [0] });
    await drainQueue(store, server.send);
    const parts = server.calls.filter((c) => c.path.includes("/parts/")).map((c) => c.path);
    expect(parts).toEqual(["/api/voice-notes/n1/parts/1", "/api/voice-notes/n1/parts/2"]);
    expect(await store.listNotes()).toEqual([]);
  });
});
