// Local addition (David, 2026-11-20): keep a bot's visible reasoning so the chat can show it.
// Only bots listed in /data/reasoning-bots.txt (ids separated by spaces, commas or lines; "*" = all) are captured.
import { readFileSync } from "node:fs";

const FILE = process.env.RAKAZO_REASONING_BOTS_FILE ?? "/data/reasoning-bots.txt";
const MAX_CHARS = 200_000;
const MAX_AGE_MS = 60 * 60 * 1000;

let cache = { at: 0, all: false, ids: new Set<string>() };
function enabled() {
  const now = Date.now();
  if (now - cache.at < 5_000) return cache;
  let all = false;
  let ids = new Set<string>();
  try {
    const parts = readFileSync(FILE, "utf8").split(/[\s,]+/).filter(Boolean);
    all = parts.includes("*");
    ids = new Set(parts);
  } catch {
    // No file means the feature is off.
  }
  cache = { at: now, all, ids };
  return cache;
}

export function reasoningEnabledFor(botId: string | undefined): boolean {
  if (!botId) return false;
  const current = enabled();
  return current.all || current.ids.has(botId);
}

const buffers = new Map<string, { text: string; at: number; sent?: number }>();

function purge(now: number) {
  for (const [key, entry] of buffers) if (now - entry.at > MAX_AGE_MS) buffers.delete(key);
}

/** Hooks for one run's model stream: a new thinking block starts a new paragraph. */
export function reasoningCapture(runId: string) {
  return {
    start: () => {
      const now = Date.now();
      purge(now);
      const entry = buffers.get(runId) ?? { text: "", at: now };
      if (entry.text && !entry.text.endsWith("\n\n")) entry.text += "\n\n";
      entry.at = now;
      buffers.set(runId, entry);
    },
    delta: (text: string) => {
      if (typeof text !== "string" || !text) return;
      const entry = buffers.get(runId) ?? { text: "", at: Date.now() };
      if (entry.text.length < MAX_CHARS) entry.text += text.slice(0, MAX_CHARS - entry.text.length);
      entry.at = Date.now();
      buffers.set(runId, entry);
    },
  };
}

/**
 * The reasoning written since the last call, to stream into the live message. Unless this is the
 * last call it stops at the last space or newline, so a secret is never cut across two chunks.
 */
export function takeReasoningChunk(runId: string, final: boolean): string {
  const entry = buffers.get(runId);
  if (!entry) return "";
  const pending = entry.text.slice(entry.sent ?? 0);
  const cut = final
    ? pending.length
    : Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n")) + 1;
  if (cut <= 0) return "";
  entry.sent = (entry.sent ?? 0) + cut;
  return pending.slice(0, cut);
}

/** Removes any buffered reasoning for a run that ended abnormally before completion. */
export function clearReasoningBuffer(runId: string): void {
  buffers.delete(runId);
}

/** The final blocks plus a leading reasoning block when the turn produced any and the bot is listed. */
export function appendReasoningBlock<T>(
  blocks: T[],
  runId: string,
  botId: string,
  redact: (text: string) => string,
): T[] {
  const entry = buffers.get(runId);
  buffers.delete(runId);
  if (blocks.length === 0 || !reasoningEnabledFor(botId)) return blocks;
  const captured = entry?.text.trim() ?? "";
  // Always strip inline <think>...</think> blocks from text replies (even if streamed reasoning also arrived).
  const inline: string[] = [];
  const shown: T[] = [];
  for (const block of blocks) {
    const candidate = block as unknown as { kind?: string; text?: unknown };
    if (candidate.kind !== "text" || typeof candidate.text !== "string") {
      shown.push(block);
      continue;
    }
    const stripped = candidate.text.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_match, inner: string) => {
      if (inner.trim()) inline.push(inner.trim());
      return "";
    });
    if (stripped === candidate.text) {
      shown.push(block);
    } else {
      const cleaned = stripped.trim();
      if (cleaned) shown.push({ ...candidate, text: cleaned } as unknown as T);
    }
  }
  const combined = [captured, ...inline].filter(Boolean).join("\n\n");
  if (!combined) return blocks;
  // The reasoning comes first, as it streamed live above the reply.
  return [{ kind: "reasoning", reasoning: redact(combined) } as unknown as T, ...shown];
}
