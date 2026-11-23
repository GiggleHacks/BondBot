// Local addition (David, 2026-11-21): a note in the chat where a bot's model was switched.
import { appendEventInTransaction, createThreadMessageInTransaction } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { RouterDeps } from "./router.js";

type ExistingBot = {
  id: string;
  modelProvider: string | null;
  modelId: string | null;
  thread: { id: string } | null;
};

/**
 * After a saved switch to a different model, adds a textless system note to the bot's chat, so the
 * model never reads it and the chat shows where the model changed. Best effort: a failure here must
 * never undo or hide the switch itself.
 */
export async function recordModelSwitch(
  deps: Pick<RouterDeps, "prisma" | "events">,
  spaceId: string,
  existing: ExistingBot,
  input: { modelProvider?: string | null; modelId?: string | null },
): Promise<void> {
  try {
    const provider = input.modelProvider ?? null;
    const modelId = input.modelId ?? null;
    if (!provider || !modelId || !existing.thread) return;
    if (existing.modelProvider === provider && existing.modelId === modelId) return;
    const threadId = existing.thread.id;
    const blocks = [
      {
        kind: "model_switch" as const,
        provider,
        modelId,
        previousProvider: existing.modelProvider,
        previousModelId: existing.modelId,
      },
    ];
    const { seq } = await deps.prisma.$transaction(async (tx) => {
      const message = await createThreadMessageInTransaction(tx, {
        threadId,
        role: "system",
        blocks,
        botId: existing.id,
        clientNonce: `model-switch:${existing.id}:${Date.now()}`,
        markUnread: false,
      });
      const event = await appendEventInTransaction(tx, {
        spaceId,
        threadId,
        botId: existing.id,
        type: "thread.message.created",
        payload: { messageId: message.id, role: "system", blocks },
      });
      return { seq: event.seq };
    });
    deps.events.notify(threadId, seq);
  } catch (error) {
    getLogger().warn("bot.model_switch_note_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
