import type { Bot } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  mobileMultiviewPageCount,
  readMultiviewConfig,
  removeMultiviewTile,
  resizedChatHeight,
  resizeMultiviewTiles,
  resolveMultiviewTileIds,
  swapMultiviewTile,
  visibleMobileTileIds,
  wheelPixels,
} from "./multiview-state";

function makeBot(id: string, overrides: Partial<Bot> = {}): Bot {
  return {
    id,
    spaceId: "space-1",
    name: id,
    color: "blue",
    computerMode: "shared",
    archivedAt: null,
    ...overrides,
  } as Bot;
}

describe("multiview-state", () => {
  const bots = [
    makeBot("b1", { computerMode: "team" }),
    makeBot("b2", { computerMode: "dedicated" }),
    makeBot("b3", { computerMode: "dedicated" }),
    makeBot("b4", { computerMode: "team" }),
    makeBot("archived", { archivedAt: "2026-11-20T00:00:00Z" }),
  ];

  it("auto-fills at least two live bots, preferring active and dedicated bots", () => {
    expect(resolveMultiviewTileIds([], bots, "b1")).toEqual(["b1", "b2"]);
  });

  it("drops archived or missing bots and refills", () => {
    expect(resolveMultiviewTileIds(["missing", "archived", "b3"], bots, "b1")).toEqual([
      "b3",
      "b1",
    ]);
  });

  it("grows and shrinks between 2, 3, and 4 tiles cleanly", () => {
    const four = resizeMultiviewTiles(["b1", "b2"], 4, bots);
    expect(four).toEqual(["b1", "b2", "b3", "b4"]);
    expect(resizeMultiviewTiles(four, 3, bots)).toEqual(["b1", "b2", "b3"]);
    expect(resizeMultiviewTiles(four, 2, bots)).toEqual(["b1", "b2"]);
  });

  it("swaps slots when picking a bot already shown in another tile", () => {
    expect(swapMultiviewTile(["b1", "b2", "b3"], 0, "b3")).toEqual(["b3", "b2", "b1"]);
    expect(swapMultiviewTile(["b1", "b2", "b3"], 1, "b4")).toEqual(["b1", "b4", "b3"]);
  });

  it("never shrinks below two tiles on remove", () => {
    expect(removeMultiviewTile(["b1", "b2", "b3"], "b2")).toEqual(["b1", "b3"]);
    expect(removeMultiviewTile(["b1", "b2"], "b1")).toEqual(["b1", "b2"]);
  });

  it("caps mobile pages at two screens per page", () => {
    expect(mobileMultiviewPageCount(2)).toBe(1);
    expect(mobileMultiviewPageCount(3)).toBe(2);
    expect(mobileMultiviewPageCount(4)).toBe(2);
    expect(visibleMobileTileIds(["b1", "b2", "b3", "b4"], 0)).toEqual(["b1", "b2"]);
    expect(visibleMobileTileIds(["b1", "b2", "b3", "b4"], 1)).toEqual(["b3", "b4"]);
    expect(visibleMobileTileIds(["b1", "b2"], 1)).toEqual(["b1", "b2"]);
  });

  it.each([
    [200, 100, 300],
    [200, -500, 96],
    [0, 120, 120],
    [0, -120, 0],
  ])("resizes a %ipx chat by %i to %ipx", (height, delta, expected) => {
    expect(resizedChatHeight(height, delta)).toBe(expected);
  });

  it("reads a wheel step given in lines as pixels", () => {
    expect(wheelPixels({ deltaY: -3, deltaMode: 1 })).toBe(-48);
  });

  it("keeps large screens for a layout saved before there was a choice", () => {
    const store = new Map([["bondbot.multiview:s1", JSON.stringify({ tileBotIds: ["b1"] })]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null });
    expect(readMultiviewConfig("s1").layout).toBe("screens");
    store.set("bondbot.multiview:s1", JSON.stringify({ layout: "chats" }));
    expect(readMultiviewConfig("s1").layout).toBe("chats");
    vi.unstubAllGlobals();
  });

  it("remembers the text-only view and which screens were closed", () => {
    const saved = JSON.stringify({ layout: "text", closedScreens: ["b1", 7] });
    vi.stubGlobal("localStorage", { getItem: () => saved });
    expect(readMultiviewConfig("s1")).toMatchObject({ layout: "text", closedScreens: ["b1"] });
    vi.unstubAllGlobals();
  });
});
