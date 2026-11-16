import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactStore,
  JobPublisher,
  SandboxProvider,
  SecretStore,
} from "@rakazo/adapter-kit";
import {
  createVoiceProvider,
  OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
  serializeOpenAiCompatibleVoiceSecret,
} from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  LeaseHeldError,
  LeaseLostError,
  readJsonColumn,
  runAsSystem,
  runAsTenant,
  withLease,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { Context, Hono } from "hono";
import * as z from "zod";
import { storeOwnedArtifact } from "./artifacts.js";
import { readBoundedBody, readBoundedBytes } from "./http-body.js";
import type { ThreadTarget } from "./thread-target.js";
import { resolveThreadTarget, sendThreadMessage } from "./thread-target.js";
import { loadVoiceCredential, voiceContext, voiceProviderFor } from "./voice.js";
import {
  cutPiece,
  decodeForSpeech,
  pausesAfter,
  planPieces,
  toPlayableAudio,
} from "./voice-note-audio.js";

/** An hour, plus slack for the recorder's last slice. */
export const MAX_NOTE_MS = 61 * 60_000;
export const MAX_NOTE_BYTES = 200 * 1024 * 1024;
export const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 2_000;
const MAX_DECLARE_BYTES = 16 * 1024;
const LEASE_TTL_MS = 2 * 60_000;
/** Notes left mid-way by a restart are picked up again after this long without progress. */
const STALE_MS = 3 * 60_000;
const SWEEP_MS = 60_000;
/** An upload untouched this long (a phone that never came back online) is dropped. */
const ABANDONED_MS = 7 * 24 * 60 * 60_000;
/** A provider that keeps failing stops the note here; the person can retry it. */
const MAX_TRIES = 4;
const MAX_TRANSCRIPT_CHARS = 90_000;

export type VoiceNoteStatus =
  | "uploading"
  | "queued"
  | "transcribing"
  | "sending"
  | "done"
  | "failed";

export interface VoiceNoteDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  artifacts: ArtifactStore;
  events: ThreadEvents;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  env: {
    dataDir: string;
    mcpAllowPrivateEndpoint?: boolean;
    maxAttachmentsPerMessage?: number;
    /**
     * A speech server the deployment runs for everyone (`VOICE_NOTES_STT_URL`, OpenAI-compatible):
     * tried after the member's own connections, so voice notes work before anyone connects one.
     */
    sttFallback?: { baseUrl: string; model: string };
  };
}

const DeclareInput = z.object({
  target: z.union([
    z.object({ botId: z.string().min(1) }),
    z.object({ groupId: z.string().min(1) }),
  ]),
  mimeType: z
    .string()
    .regex(/^audio\/[\w.+-]+$/)
    .max(100),
  durationMs: z.number().int().min(0).max(MAX_NOTE_MS),
  bytes: z.number().int().min(1).max(MAX_NOTE_BYTES),
  parts: z.number().int().min(1).max(MAX_PARTS),
  recordedAt: z.string().datetime({ offset: true }).optional(),
});

const SegmentTexts = z.array(z.string());
const CLIENT_ID = /^[\w-]{8,100}$/;

function noteDir(deps: VoiceNoteDeps, id: string) {
  return path.join(deps.env.dataDir, "voice-notes", id);
}

function targetOf(row: { botId: string | null; groupId: string | null }) {
  return row.groupId ? { groupId: row.groupId } : { botId: row.botId ?? "" };
}

function publicNote(row: {
  id: string;
  clientId: string;
  status: string;
  botId: string | null;
  groupId: string | null;
  durationMs: number;
  segmentsDone: number;
  segmentsTotal: number;
  error: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status,
    target: targetOf(row),
    durationMs: row.durationMs,
    segmentsDone: row.segmentsDone,
    segmentsTotal: row.segmentsTotal,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Voice notes: the device uploads a finished recording in parts (each idempotent, so an
 * interrupted upload resumes), then the server converts it, transcribes it in pieces with
 * the member's voice connections, and sends the audio plus its transcript as their message.
 */
export function createVoiceNotes(deps: VoiceNoteDeps) {
  const log = getLogger();
  const tries = new Map<string, number>();
  const running = new Set<string>();

  const changed = (spaceId: string) => deps.events.publishSpaceChange?.(spaceId, "voiceNotes");

  async function actorFor(row: { userId: string; spaceId: string }): Promise<Actor> {
    const user = await runAsSystem("voice note: the member who recorded it", () =>
      deps.prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } }),
    );
    if (!user) throw new Error("The member who recorded this note is gone.");
    return {
      userId: row.userId,
      spaceId: row.spaceId,
      email: user.email,
      isDeploymentOwner: false,
    };
  }

  /** Every connection that can transcribe, the member's default first. */
  async function transcribers(actor: Actor) {
    const rows = await deps.prisma.userVoiceCredential.findMany({
      where: { userId: actor.userId },
      select: { provider: true },
    });
    const preferred = await loadVoiceCredential(deps, actor);
    const providers = [
      ...(preferred ? [preferred.cred.provider] : []),
      ...rows.map((r) => r.provider).filter((p) => p !== preferred?.cred.provider),
    ];
    const ready = [];
    for (const provider of new Set(providers)) {
      const loaded = await loadVoiceCredential(deps, actor, provider);
      if (!loaded) continue;
      const adapter = await voiceProviderFor(deps, provider);
      if (adapter.transcribe) ready.push({ provider, apiKey: loaded.apiKey, adapter });
    }
    const fallback = deps.env.sttFallback;
    if (fallback) {
      ready.push({
        provider: OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
        apiKey: serializeOpenAiCompatibleVoiceSecret(
          { baseUrl: fallback.baseUrl, sttModel: fallback.model },
          undefined,
          { allowPrivate: true },
        ),
        adapter: createVoiceProvider(OPENAI_COMPATIBLE_VOICE_PROVIDER_ID, {
          allowPrivateEndpoint: true,
        }),
      });
    }
    return ready;
  }

  async function transcribePiece(
    actor: Actor,
    engines: Awaited<ReturnType<typeof transcribers>>,
    file: string,
    signal: AbortSignal,
  ): Promise<string> {
    const audio = new Uint8Array(await readFile(file));
    // A slow self-hosted server is still progressing; allow several times real time.
    const seconds = Math.max(30, audio.byteLength / 3_000);
    let lastError: unknown = new Error(
      "No voice connection can transcribe. Connect one in Voice settings.",
    );
    for (const engine of engines) {
      try {
        const { text } = await engine.adapter.transcribe!(
          {
            audio,
            mimeType: "audio/ogg",
            apiKey: engine.apiKey,
            signal,
            timeoutMs: seconds * 4_000 + 60_000,
          },
          voiceContext(actor, signal),
        );
        return text.trim();
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
        log.warn("voice note piece failed on one connection", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw lastError;
  }

  async function assemble(id: string, parts: number, name = "source"): Promise<string> {
    const dir = noteDir(deps, id);
    const source = path.join(dir, name);
    const chunks: Buffer[] = [];
    for (let part = 0; part < parts; part += 1) {
      chunks.push(await readFile(path.join(dir, `${part}.part`)));
    }
    await writeFile(source, Buffer.concat(chunks));
    return source;
  }

  type Update = (data: Parameters<PrismaClient["voiceNote"]["update"]>[0]["data"]) => Promise<void>;

  /**
   * Transcribes what is not transcribed yet. `final` runs to the end of the finished note; a
   * note still recording (or uploading) goes only as far as its parts arrived in order, and
   * stops short of the newest audio. Returns every piece's text so far.
   */
  async function transcribeRange(
    actor: Actor,
    id: string,
    options: { final: boolean; signal: AbortSignal; update: Update },
  ): Promise<string[]> {
    const row = await deps.prisma.voiceNote.findUniqueOrThrow({ where: { id } });
    const texts = readJsonColumn(
      SegmentTexts,
      row.segmentTexts ?? [],
      { table: "voice_notes", column: "segmentTexts", id },
      { fallback: [] },
    );
    let from = texts.length === 0 ? 0 : row.transcribedUntil;
    const have = new Set(row.receivedParts);
    let parts = 0;
    while (have.has(parts) && (options.final ? parts < row.parts : true)) parts += 1;
    if (options.final && parts < row.parts) throw new Error("Parts are missing from this note.");
    if (parts === 0) return texts;
    const dir = noteDir(deps, id);
    const source = await assemble(id, parts, "speech-source");
    const wav = path.join(dir, "speech.wav");
    const duration = await decodeForSpeech(source, wav);
    const ends = planPieces({
      from,
      duration,
      pauses: await pausesAfter(wav, from),
      final: options.final,
    });
    if (ends.length === 0) return texts;
    const engines = await transcribers(actor);
    if (engines.length === 0) {
      if (options.final) throw new NoTranscriberError();
      return texts;
    }
    if (options.final) await options.update({ segmentsTotal: texts.length + ends.length });
    const piece = path.join(dir, "piece.ogg");
    for (const end of ends) {
      options.signal.throwIfAborted();
      await cutPiece(wav, from, end, piece);
      texts.push(await transcribePiece(actor, engines, piece, options.signal));
      from = end;
      await options.update({
        transcribedUntil: from,
        segmentTexts: texts,
        segmentsDone: texts.length,
        ...(options.final ? {} : { segmentsTotal: texts.length }),
      });
    }
    return texts;
  }

  const advancing = new Set<string>();
  const advanceAgain = new Set<string>();

  /**
   * Transcribes a note while it is still being recorded, piece by piece as its parts arrive,
   * so little is left to do once it is sent. Best effort: anything missed here is done by the
   * final pass.
   */
  async function advance(id: string): Promise<void> {
    if (advancing.has(id)) {
      advanceAgain.add(id);
      return;
    }
    advancing.add(id);
    try {
      do {
        advanceAgain.delete(id);
        const row = await runAsSystem("voice note: transcribe while recording", () =>
          deps.prisma.voiceNote.findUnique({ where: { id } }),
        );
        if (!row || row.status !== "uploading") break;
        const actor = await actorFor(row);
        await withLease(deps.prisma, `voice-note:${id}`, { ttlMs: LEASE_TTL_MS }, (lease) =>
          runAsTenant(actor, () =>
            transcribeRange(actor, id, {
              final: false,
              signal: lease.signal,
              update: async (data) => {
                await deps.prisma.voiceNote.update({ where: { id }, data });
              },
            }),
          ),
        );
      } while (advanceAgain.has(id));
    } catch (error) {
      if (!(error instanceof LeaseHeldError || error instanceof LeaseLostError)) {
        log.warn("voice note live transcription paused", {
          voiceNoteId: id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      advancing.delete(id);
      advanceAgain.delete(id);
    }
    // Sent while this pass held the note: finish it now rather than at the next sweep.
    const after = await runAsSystem("voice note: check after live transcription", () =>
      deps.prisma.voiceNote.findUnique({ where: { id }, select: { status: true } }),
    ).catch(() => null);
    if (after?.status === "queued") void processNote(id);
  }

  async function work(id: string, signal: AbortSignal) {
    const row = await runAsSystem("voice note: process an uploaded note", () =>
      deps.prisma.voiceNote.findUnique({ where: { id } }),
    );
    if (!row || !["queued", "transcribing", "sending"].includes(row.status)) return;
    const actor = await actorFor(row);
    await runAsTenant(actor, async () => {
      const update = async (data: Parameters<PrismaClient["voiceNote"]["update"]>[0]["data"]) => {
        await deps.prisma.voiceNote.update({ where: { id }, data });
        await changed(actor.spaceId);
      };
      const target: ThreadTarget = await resolveThreadTarget(deps.prisma, actor, targetOf(row));
      const dir = noteDir(deps, id);
      const playable = path.join(dir, "note.m4a");
      let artifactId = row.artifactId;
      if (!artifactId) {
        await update({ status: "transcribing", error: null });
        const source = await assemble(id, row.parts);
        await toPlayableAudio(source, playable);
        const bytes = new Uint8Array(await readFile(playable));
        const when = row.recordedAt ?? row.createdAt;
        const artifact = await storeOwnedArtifact(deps, actor, {
          botId: target.kind === "bot" ? target.botId : target.memberBotIds[0]!,
          ...(target.kind === "group" ? { groupId: target.groupId } : {}),
          name: `Voice note ${when.toISOString().slice(0, 16).replace("T", " ")}.m4a`,
          mimeType: "audio/mp4",
          bytes,
          clientNonce: `voice-note:${id}`,
          standalone: true,
        });
        artifactId = artifact.id;
        await update({ artifactId });
      }
      signal.throwIfAborted();
      let transcript = row.transcript;
      if (row.status !== "sending" || transcript === null) {
        await update({ status: "transcribing" });
        // Pieces already transcribed while the note was still recording are kept.
        const texts = await transcribeRange(actor, id, { final: true, signal, update });
        transcript = texts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (transcript.length > MAX_TRANSCRIPT_CHARS) {
          transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}…`;
        }
        await update({ status: "sending", transcript });
      }
      // The nonce makes a repeated send (after a crash) return the first one.
      await sendThreadMessage(
        { ...deps, maxAttachmentsPerMessage: deps.env.maxAttachmentsPerMessage },
        actor,
        target,
        {
          text: transcript || undefined,
          artifactIds: [artifactId],
          imageHandling: "file",
          clientNonce: `voice-note:${id}`,
        },
      );
      await update({ status: "done", error: null, segmentTexts: [] });
      tries.delete(id);
      await rm(dir, { recursive: true, force: true });
    });
  }

  /** Runs one note to the end, unless another process already holds it. */
  async function processNote(id: string): Promise<void> {
    if (running.has(id)) return;
    running.add(id);
    try {
      await withLease(deps.prisma, `voice-note:${id}`, { ttlMs: LEASE_TTL_MS }, (lease) =>
        work(id, lease.signal),
      );
    } catch (error) {
      if (error instanceof LeaseHeldError || error instanceof LeaseLostError) return;
      const attempt = (tries.get(id) ?? 0) + 1;
      tries.set(id, attempt);
      const message = error instanceof Error ? error.message : String(error);
      log.warn("voice note failed", { voiceNoteId: id, attempt, reason: message });
      const giveUp = attempt >= MAX_TRIES || error instanceof NoTranscriberError;
      const row = await runAsSystem("voice note: record a failure", () =>
        deps.prisma.voiceNote.update({
          where: { id },
          // Not given up: the sweep tries again once it is stale.
          data: giveUp
            ? { status: "failed", error: message.slice(0, 500) }
            : { error: message.slice(0, 500) },
          select: { spaceId: true },
        }),
      ).catch(() => null);
      if (row) await changed(row.spaceId);
      if (giveUp) tries.delete(id);
    } finally {
      running.delete(id);
    }
  }

  /** The safety net: notes a restart left behind, and ones that failed for a passing reason. */
  async function sweep() {
    const stale = new Date(Date.now() - STALE_MS);
    const rows = await runAsSystem("voice note: resume notes left mid-way", () =>
      deps.prisma.voiceNote.findMany({
        where: {
          OR: [
            { status: "queued", updatedAt: { lt: new Date(Date.now() - 5_000) } },
            { status: { in: ["transcribing", "sending"] }, updatedAt: { lt: stale } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 20,
      }),
    );
    for (const row of rows) void processNote(row.id);
    // Recordings discarded while offline, or never finished, leave an upload behind.
    const abandoned = await runAsSystem("voice note: drop abandoned uploads", () =>
      deps.prisma.voiceNote.findMany({
        where: { status: "uploading", updatedAt: { lt: new Date(Date.now() - ABANDONED_MS) } },
        select: { id: true },
        take: 20,
      }),
    );
    for (const row of abandoned) {
      await runAsSystem("voice note: drop an abandoned upload", () =>
        deps.prisma.voiceNote.delete({ where: { id: row.id } }),
      );
      await rm(noteDir(deps, row.id), { recursive: true, force: true });
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    process: processNote,
    advance,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        sweep().catch((error: unknown) => log.warn("voice note sweep failed", { error }));
      }, SWEEP_MS);
      timer.unref?.();
      sweep().catch((error: unknown) => log.warn("voice note sweep failed", { error }));
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Nothing can transcribe: retrying will not help until a connection is added. */
class NoTranscriberError extends Error {
  constructor() {
    super("No voice connection can transcribe. Connect one in Voice settings, then retry.");
  }
}

class VoiceNoteRequestError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413,
    message: string,
  ) {
    super(message);
  }
}

export function mountVoiceNoteRoutes(
  app: Hono,
  deps: VoiceNoteDeps,
  notes: ReturnType<typeof createVoiceNotes>,
  authenticate: (c: Context) => Promise<Actor | null>,
) {
  const changed = (spaceId: string) => deps.events.publishSpaceChange?.(spaceId, "voiceNotes");
  const handle = (fn: (c: Context, actor: Actor) => Promise<Response>) => async (c: Context) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    try {
      return await runAsTenant(actor, () => fn(c, actor));
    } catch (error) {
      if (error instanceof VoiceNoteRequestError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  };

  const clientIdOf = (c: Context) => {
    const clientId = c.req.param("clientId") ?? "";
    if (!CLIENT_ID.test(clientId)) throw new VoiceNoteRequestError(400, "Unknown voice note.");
    return clientId;
  };

  const find = async (actor: Actor, clientId: string) => {
    const row = await deps.prisma.voiceNote.findUnique({
      where: { userId_clientId: { userId: actor.userId, clientId } },
    });
    if (!row || row.spaceId !== actor.spaceId) {
      throw new VoiceNoteRequestError(404, "Unknown voice note.");
    }
    return row;
  };

  // Declare (or resume) a note. Answers which parts the server already has.
  app.put(
    "/api/voice-notes/:clientId",
    handle(async (c, actor) => {
      const clientId = clientIdOf(c);
      const raw = await readBoundedBody(c.req.raw, MAX_DECLARE_BYTES);
      if (raw === null) throw new VoiceNoteRequestError(413, "Request body is too large.");
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        throw new VoiceNoteRequestError(400, "That voice note is not valid.");
      }
      const parsed = DeclareInput.safeParse(parsedJson);
      if (!parsed.success) throw new VoiceNoteRequestError(400, "That voice note is not valid.");
      const input = parsed.data;
      const existing = await deps.prisma.voiceNote.findUnique({
        where: { userId_clientId: { userId: actor.userId, clientId } },
      });
      if (existing) {
        if (existing.spaceId !== actor.spaceId) {
          throw new VoiceNoteRequestError(409, "That voice note belongs to another Space.");
        }
        // A note declared while still recording grows: the final declare names every part.
        if (existing.status === "uploading" && input.parts >= existing.parts) {
          await deps.prisma.voiceNote.update({
            where: { id: existing.id },
            data: { parts: input.parts, durationMs: input.durationMs, bytes: input.bytes },
          });
        }
        const received =
          existing.status === "uploading"
            ? [...new Set(existing.receivedParts)]
            : Array.from({ length: existing.parts }, (_, i) => i);
        return c.json({ id: existing.id, status: existing.status, received });
      }
      // The chat must exist and be the member's to post in.
      try {
        await resolveThreadTarget(deps.prisma, actor, input.target);
      } catch {
        throw new VoiceNoteRequestError(404, "That chat is no longer available.");
      }
      const created = await deps.prisma.voiceNote.create({
        data: {
          clientId,
          userId: actor.userId,
          spaceId: actor.spaceId,
          botId: "botId" in input.target ? input.target.botId : null,
          groupId: "groupId" in input.target ? input.target.groupId : null,
          mimeType: input.mimeType,
          durationMs: input.durationMs,
          bytes: input.bytes,
          parts: input.parts,
          recordedAt: input.recordedAt ? new Date(input.recordedAt) : null,
        },
      });
      await changed(actor.spaceId);
      return c.json({ id: created.id, status: created.status, received: [] });
    }),
  );

  app.put(
    "/api/voice-notes/:clientId/parts/:part",
    handle(async (c, actor) => {
      const row = await find(actor, clientIdOf(c));
      const part = Number(c.req.param("part"));
      if (!Number.isInteger(part) || part < 0 || part >= row.parts) {
        throw new VoiceNoteRequestError(400, "That part is not in this voice note.");
      }
      if (row.status !== "uploading" || row.receivedParts.includes(part)) {
        return c.body(null, 204);
      }
      const bytes = await readBoundedBytes(c.req.raw, MAX_PART_BYTES);
      if (bytes === null) throw new VoiceNoteRequestError(413, "That part is too large.");
      if (bytes.byteLength === 0) throw new VoiceNoteRequestError(400, "That part is empty.");
      const dir = noteDir(deps, row.id);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${part}.part`);
      await writeFile(`${file}.tmp`, bytes);
      await rename(`${file}.tmp`, file);
      await deps.prisma.voiceNote.update({
        where: { id: row.id },
        data: { receivedParts: { push: part } },
      });
      void notes.advance(row.id);
      return c.body(null, 204);
    }),
  );

  app.post(
    "/api/voice-notes/:clientId/complete",
    handle(async (c, actor) => {
      const row = await find(actor, clientIdOf(c));
      if (row.status === "uploading") {
        const have = new Set(row.receivedParts);
        const missing = Array.from({ length: row.parts }, (_, i) => i).filter((i) => !have.has(i));
        if (missing.length) {
          throw new VoiceNoteRequestError(
            409,
            `Parts still missing: ${missing.slice(0, 10).join(", ")}`,
          );
        }
        await deps.prisma.voiceNote.update({
          where: { id: row.id },
          data: { status: "queued", error: null },
        });
        await changed(actor.spaceId);
      }
      void notes.process(row.id);
      return c.json(
        { id: row.id, status: row.status === "uploading" ? "queued" : row.status },
        202,
      );
    }),
  );

  // Notes the member still waits on: transcribing, or failed and waiting for a retry.
  app.get(
    "/api/voice-notes",
    handle(async (c, actor) => {
      const rows = await deps.prisma.voiceNote.findMany({
        where: {
          userId: actor.userId,
          spaceId: actor.spaceId,
          status: { in: ["queued", "transcribing", "sending", "failed"] },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return c.json({ notes: rows.map(publicNote) });
    }),
  );

  app.post(
    "/api/voice-notes/:clientId/retry",
    handle(async (c, actor) => {
      const row = await find(actor, clientIdOf(c));
      if (row.status === "failed") {
        await deps.prisma.voiceNote.update({
          where: { id: row.id },
          data: { status: row.transcript !== null ? "sending" : "queued", error: null },
        });
        await changed(actor.spaceId);
        void notes.process(row.id);
      }
      return c.body(null, 204);
    }),
  );

  app.delete(
    "/api/voice-notes/:clientId",
    handle(async (c, actor) => {
      const row = await find(actor, clientIdOf(c));
      if (row.status === "done" || row.status === "sending") {
        throw new VoiceNoteRequestError(409, "This voice note is already being sent.");
      }
      await deps.prisma.voiceNote.delete({ where: { id: row.id } });
      await rm(noteDir(deps, row.id), { recursive: true, force: true });
      await changed(actor.spaceId);
      return c.body(null, 204);
    }),
  );
}
