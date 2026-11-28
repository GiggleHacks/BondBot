import type { Hono } from "hono";
import type { AppEnv } from "../env.js";
import type { VoiceNoteDeps } from "../voice-notes.js";
import { createVoiceNotes, mountVoiceNoteRoutes } from "../voice-notes.js";

/** Wires voice notes up with the deployment's speech server, when it runs one, and starts them. */
export function mountVoiceNotes(
  app: Hono,
  deps: Omit<VoiceNoteDeps, "env">,
  { dataDir, mcpAllowPrivateEndpoint, maxAttachmentsPerMessage }: AppEnv,
  authenticate: Parameters<typeof mountVoiceNoteRoutes>[3],
) {
  const sttUrl = process.env.VOICE_NOTES_STT_URL?.trim();
  const voiceNoteDeps: VoiceNoteDeps = {
    ...deps,
    env: {
      dataDir,
      mcpAllowPrivateEndpoint,
      maxAttachmentsPerMessage,
      sttFallback: sttUrl
        ? { baseUrl: sttUrl, model: process.env.VOICE_NOTES_STT_MODEL?.trim() || "whisper-1" }
        : undefined,
    },
  };
  const voiceNotes = createVoiceNotes(voiceNoteDeps);
  mountVoiceNoteRoutes(app, voiceNoteDeps, voiceNotes, authenticate);
  voiceNotes.start();
  return voiceNotes;
}
