import type { ChatAlert, ProductEvent } from "@rakazo/contracts";
import { messageUnreadFor, showsAsLiveStep } from "@rakazo/core";

export type ChatSoundCue = "sent" | "working" | "attention" | "error";

export type ChatSound = { cue: ChatSoundCue } | { streamed: number };

type SoundEvent = Pick<ProductEvent, "type" | "payload" | "createdAt">;

/** Events replayed after a reconnect already happened; they make no sound. */
const STALE_MS = 30_000;

function streamedChars(payload: Record<string, unknown>): number {
  const reasoning = typeof payload.reasoning === "string" ? payload.reasoning.length : 0;
  const delta = typeof payload.delta === "string" ? payload.delta.length : 0;
  if (reasoning + delta > 0) return reasoning + delta;
  // A whole step line replaced at once still moves the text a little.
  return typeof payload.text === "string" && payload.text.trim() ? 1 : 0;
}

/** The sound an open chat's live event makes, if any. Replies finishing stay silent. */
export function chatSoundFor(
  event: SoundEvent,
  meId: string | undefined,
  now = Date.now(),
): ChatSound | null {
  if (now - Date.parse(event.createdAt) > STALE_MS) return null;
  const payload = event.payload;
  switch (event.type) {
    case "thread.message.created":
      return payload.role === "user" &&
        payload.callId === undefined &&
        !messageUnreadFor(payload, meId)
        ? { cue: "sent" }
        : null;
    case "thread.progress": {
      const chars = streamedChars(payload);
      return chars > 0 ? { streamed: chars } : null;
    }
    case "agent.tool.called":
      return showsAsLiveStep(payload.name) ? { cue: "working" } : null;
    case "run.waiting_input":
    case "computer.takeover.requested":
      return { cue: "attention" };
    case "run.failed":
      return { cue: "error" };
    default:
      return null;
  }
}

export function chatSoundForAlert(kind: ChatAlert["kind"]): ChatSoundCue | null {
  if (kind === "help" || kind === "takeover") return "attention";
  if (kind === "failure") return "error";
  return null;
}
