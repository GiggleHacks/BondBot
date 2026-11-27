// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SpaceQueries } from "../../../lib/query/query";
import type { createSpaceRpc } from "../../../lib/query/rpc";
import type { ComputerVpnController } from "../use-computer-vpn";
import { MultiviewWorkspace } from "./MultiviewWorkspace";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

vi.mock("../../../components/ConnectionBars", () => ({
  ConnectionBars: () => <div data-testid="conn-bars" />,
}));

vi.mock("./MultiviewTile", () => ({
  MultiviewTile: ({ bot, onSwapBot }: { bot: Bot; onSwapBot: (next: string) => void }) => (
    <div data-testid={`tile-${bot.id}`}>
      <span>{bot.name}</span>
      <button type="button" onClick={() => onSwapBot("b4")}>
        swap-{bot.id}
      </button>
    </div>
  ),
}));

function makeBot(id: string, name: string): Bot {
  return {
    id,
    spaceId: "space-1",
    name,
    color: "blue",
    computerMode: "dedicated",
    archivedAt: null,
  } as Bot;
}

const bots = [
  makeBot("b1", "Alpha"),
  makeBot("b2", "Beta"),
  makeBot("b3", "Gamma"),
  makeBot("b4", "Delta"),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderWorkspace(isMobile: boolean, onExit = vi.fn()) {
  act(() =>
    root.render(
      <MultiviewWorkspace
        spaceId="space-1"
        isMobile={isMobile}
        drawerOpen={false}
        covered={false}
        bots={bots}
        botsRef={{ current: bots }}
        archivedBots={[]}
        activeBotId="b1"
        rpc={{} as ReturnType<typeof createSpaceRpc>}
        queries={{} as SpaceQueries}
        meId="user-1"
        streamReplies
        showToolActivity={false}
        sandboxProvider="docker"
        vpn={{ overview: null } as unknown as ComputerVpnController}
        maximizedBotId={null}
        onOpenNavigation={vi.fn()}
        onMaximize={vi.fn()}
        onOpenFullChat={vi.fn()}
        onOpenBot={vi.fn()}
        onCreateBot={vi.fn()}
        onExit={onExit}
        refreshBots={vi.fn(async () => {})}
        onBotUpdated={vi.fn()}
        onUpgrade={vi.fn()}
        onSendError={vi.fn()}
      />,
    ),
  );
  return { onExit };
}

it("switches between 2, 3, and 4 tiles on desktop and exits cleanly", () => {
  const { onExit } = renderWorkspace(false);
  expect(container.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(2);

  const btn4 = [...container.querySelectorAll("button")].find((b) => b.textContent === "4")!;
  act(() => btn4.click());
  expect(container.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(4);

  const btn3 = [...container.querySelectorAll("button")].find((b) => b.textContent === "3")!;
  act(() => btn3.click());
  expect(container.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(3);

  const exit = container.querySelector<HTMLButtonElement>('[data-testid="exit-multiview"]')!;
  act(() => exit.click());
  expect(onExit).toHaveBeenCalledTimes(1);
});

it("caps mobile at 2 simultaneous screens and pages to screens 3 and 4", () => {
  localStorage.setItem(
    "bondbot.multiview:space-1",
    JSON.stringify({
      tileBotIds: ["b1", "b2", "b3", "b4"],
      threeLayout: "columns",
      chatHeights: {},
    }),
  );
  renderWorkspace(true);
  expect(container.querySelector('[data-testid="tile-b1"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="tile-b2"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="tile-b3"]')).toBeNull();

  const page2 = [...container.querySelectorAll("button")].find((b) => b.textContent === "3, 4")!;
  act(() => page2.click());
  expect(container.querySelector('[data-testid="tile-b1"]')).toBeNull();
  expect(container.querySelector('[data-testid="tile-b3"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="tile-b4"]')).not.toBeNull();
});
