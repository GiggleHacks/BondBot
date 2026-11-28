// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MultiviewMiniChat } from "./MultiviewMiniChat";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));
vi.mock("../chat/transcript", () => ({ Transcript: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(fill: boolean) {
  const onResizeChat = vi.fn();
  const props = {
    bot: { id: "b1", name: "Ada" } as Bot,
    view: { activeSnapshot: null },
    running: false,
    chatHeight: 200,
    drawerRef: { current: null },
    onResizeChat,
    fill,
  } as unknown as ComponentProps<typeof MultiviewMiniChat>;
  await act(async () => root.render(<MultiviewMiniChat {...props} />));
  return onResizeChat;
}

it("grows the chat when the divider is scrolled up or arrowed up", async () => {
  const onResizeChat = await render(false);
  const divider = container.querySelector('[role="separator"]')!;
  await act(async () => {
    divider.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  expect(onResizeChat.mock.calls).toEqual([[100], [24]]);
});

it("has no divider when the chat fills its column", async () => {
  await render(true);
  expect(container.querySelector('[role="separator"]')).toBeNull();
  expect(container.querySelector("textarea")).not.toBeNull();
});
