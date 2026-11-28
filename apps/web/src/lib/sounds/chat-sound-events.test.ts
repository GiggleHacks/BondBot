import { describe, expect, it } from "vitest";
import { chatSoundFor } from "./chat-sound-events";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");
const at = (ms: number) => new Date(NOW - ms).toISOString();

function event(type: string, payload: Record<string, unknown>, age = 0) {
  return { type, payload, createdAt: at(age) } as Parameters<typeof chatSoundFor>[0];
}

describe("chatSoundFor", () => {
  it("ticks with the reasoning and reply text that streams in", () => {
    expect(chatSoundFor(event("thread.progress", { reasoning: "Let me see" }), "me", NOW)).toEqual({
      streamed: 10,
    });
    expect(chatSoundFor(event("thread.progress", { delta: "Hello" }), "me", NOW)).toEqual({
      streamed: 5,
    });
  });

  it("stays silent for a progress event that moves no text", () => {
    expect(chatSoundFor(event("thread.progress", { reset: true }), "me", NOW)).toBeNull();
  });

  it("chirps for my own typed message, not a bot's or a call turn", () => {
    const mine = { role: "user" };
    expect(chatSoundFor(event("thread.message.created", mine), "me", NOW)).toEqual({ cue: "sent" });
    expect(
      chatSoundFor(event("thread.message.created", { ...mine, callId: "call-1" }), "me", NOW),
    ).toBeNull();
    expect(chatSoundFor(event("thread.message.created", { role: "bot" }), "me", NOW)).toBeNull();
  });

  it("stays silent when a run completes", () => {
    expect(chatSoundFor(event("run.completed", {}), "me", NOW)).toBeNull();
  });

  it("makes no sound for events replayed after a reconnect", () => {
    expect(chatSoundFor(event("run.failed", {}, 60_000), "me", NOW)).toBeNull();
    expect(chatSoundFor(event("run.failed", {}), "me", NOW)).toEqual({ cue: "error" });
  });
});
