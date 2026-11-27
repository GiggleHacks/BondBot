import type { Bot } from "@rakazo/contracts";
import { readStoredString, writeStoredString } from "../../../lib/preferences/stored-preference";

export type MultiviewCount = 2 | 3 | 4;
export type MultiviewThreeLayout = "columns" | "featured";

export type MultiviewSpaceConfig = {
  tileBotIds: string[];
  threeLayout: MultiviewThreeLayout;
  /** Per-bot mini-chat height in px; 0 means collapsed. Missing entries use the default height. */
  chatHeights: Record<string, number>;
};

export const MULTIVIEW_MIN_TILES = 2;
export const MULTIVIEW_MAX_TILES = 4;
export const MULTIVIEW_MOBILE_PAGE_SIZE = 2;
export const MULTIVIEW_DEFAULT_CHAT_HEIGHT = 176;
export const MULTIVIEW_MIN_CHAT_HEIGHT = 96;
export const MULTIVIEW_MAX_CHAT_HEIGHT = 360;

export function multiviewStorageKey(spaceId: string): string {
  return `bondbot.multiview:${spaceId}`;
}

export function readMultiviewConfig(spaceId: string): MultiviewSpaceConfig {
  const empty: MultiviewSpaceConfig = {
    tileBotIds: [],
    threeLayout: "columns",
    chatHeights: {},
  };
  const raw = readStoredString(multiviewStorageKey(spaceId));
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    const record = parsed as Record<string, unknown>;
    const tileBotIds = Array.isArray(record.tileBotIds)
      ? record.tileBotIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const threeLayout: MultiviewThreeLayout =
      record.threeLayout === "featured" ? "featured" : "columns";
    const chatHeights: Record<string, number> = {};
    if (record.chatHeights && typeof record.chatHeights === "object") {
      for (const [id, value] of Object.entries(record.chatHeights)) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          chatHeights[id] = value === 0 ? 0 : clampMultiviewChatHeight(value);
        }
      }
    }
    return { tileBotIds, threeLayout, chatHeights };
  } catch {
    return empty;
  }
}

export function writeMultiviewConfig(spaceId: string, config: MultiviewSpaceConfig): void {
  writeStoredString(multiviewStorageKey(spaceId), JSON.stringify(config));
}

export function clampMultiviewChatHeight(height: number): number {
  return Math.min(
    MULTIVIEW_MAX_CHAT_HEIGHT,
    Math.max(MULTIVIEW_MIN_CHAT_HEIGHT, Math.round(height)),
  );
}

/** Rank available bots so dedicated or active computers fill empty Multiview slots first. */
function pickFillOrder(bots: readonly Bot[], activeBotId?: string): Bot[] {
  const active = activeBotId ? bots.find((bot) => bot.id === activeBotId) : undefined;
  const dedicated = bots.filter((bot) => bot.computerMode === "dedicated");
  const rest = bots.filter((bot) => bot.computerMode !== "dedicated");
  const ordered = active ? [active, ...dedicated, ...rest] : [...dedicated, ...rest];
  const seen = new Set<string>();
  return ordered.filter((bot) => {
    if (seen.has(bot.id)) return false;
    seen.add(bot.id);
    return true;
  });
}

/**
 * Resolves the persisted tile list against live Space bots: keeps valid non-archived bots,
 * drops duplicates, and fills up to `targetCount` (at least 2 when enough bots exist).
 */
export function resolveMultiviewTileIds(
  savedIds: readonly string[],
  bots: readonly Bot[],
  activeBotId?: string,
  desiredCount?: number,
): string[] {
  const liveById = new Map(bots.filter((bot) => !bot.archivedAt).map((bot) => [bot.id, bot]));
  const liveBots = [...liveById.values()];
  if (liveBots.length === 0) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    if (seen.has(id) || !liveById.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MULTIVIEW_MAX_TILES) break;
  }

  const minTarget = Math.min(
    liveBots.length,
    Math.max(
      MULTIVIEW_MIN_TILES,
      Math.min(MULTIVIEW_MAX_TILES, desiredCount ?? Math.max(result.length, MULTIVIEW_MIN_TILES)),
    ),
  );

  if (result.length < minTarget) {
    for (const candidate of pickFillOrder(liveBots, activeBotId)) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      result.push(candidate.id);
      if (result.length >= minTarget) break;
    }
  }
  return result;
}

/** Adjusts the tile count between 2, 3, and 4, keeping current bots or auto-filling new slots. */
export function resizeMultiviewTiles(
  currentIds: readonly string[],
  targetCount: MultiviewCount,
  bots: readonly Bot[],
  activeBotId?: string,
): string[] {
  const resolved = resolveMultiviewTileIds(currentIds, bots, activeBotId, targetCount);
  if (resolved.length <= targetCount) return resolved;
  return resolved.slice(0, targetCount);
}

/** Places `nextBotId` into `slotIndex`; if it already occupies another slot, swaps the two. */
export function swapMultiviewTile(
  currentIds: readonly string[],
  slotIndex: number,
  nextBotId: string,
): string[] {
  if (slotIndex < 0 || slotIndex >= currentIds.length) return [...currentIds];
  if (currentIds[slotIndex] === nextBotId) return [...currentIds];
  const next = [...currentIds];
  const existingIndex = next.indexOf(nextBotId);
  if (existingIndex !== -1) {
    next[existingIndex] = next[slotIndex]!;
  }
  next[slotIndex] = nextBotId;
  return next;
}

/** Removes a tile while keeping at least 2 tiles when possible. */
export function removeMultiviewTile(currentIds: readonly string[], botId: string): string[] {
  if (currentIds.length <= MULTIVIEW_MIN_TILES) return [...currentIds];
  return currentIds.filter((id) => id !== botId);
}

/** Mobile shows at most 2 simultaneous screens per page to keep streams and layout clean. */
export function mobileMultiviewPageCount(tileCount: number): number {
  return tileCount > MULTIVIEW_MOBILE_PAGE_SIZE ? 2 : 1;
}

export function visibleMobileTileIds(tileIds: readonly string[], page: number): string[] {
  const safePage = page > 0 && tileIds.length > MULTIVIEW_MOBILE_PAGE_SIZE ? 1 : 0;
  const start = safePage * MULTIVIEW_MOBILE_PAGE_SIZE;
  return tileIds.slice(start, start + MULTIVIEW_MOBILE_PAGE_SIZE);
}
