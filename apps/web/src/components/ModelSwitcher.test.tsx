// @vitest-environment jsdom

import type { ConnectedModelChoice } from "@rakazo/core";
import { modelOptionKey } from "@rakazo/core";
import { deferred } from "@rakazo/core/test-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({ botModels: { starred: vi.fn(), setStarred: vi.fn() } }));
vi.mock("../lib/query/rpc", () => ({
  rpc: rpcMock,
  rpcForSpace: () => rpcMock,
  createSpaceRpc: () => rpcMock,
  selectedSpaceId: () => null,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: () => null,
  toast: { error: vi.fn() },
}));

import { QueryUserProvider } from "../lib/query/query";
import { ModelSwitcherView } from "./ModelSwitcher";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const key = (modelId: string) => modelOptionKey("test", modelId);
const choices = ["alpha", "beta", "gamma"].map(
  (modelId) =>
    ({ key: key(modelId), provider: "test", modelId }) as unknown as ConnectedModelChoice,
);
const model = (modelId: string) => ({ provider: "test", modelId });

async function render(starred: string[], mostUsed: string[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onSwitch = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <QueryUserProvider value="user-1">
          <ModelSwitcherView
            bot={{ id: "bot-1", name: "Bot", modelProvider: null, modelId: null }}
            choices={choices}
            mostUsed={mostUsed.map(model)}
            starred={starred.map(model)}
            onSwitch={onSwitch}
          />
        </QueryUserProvider>
      </QueryClientProvider>,
    );
  });
  return {
    onSwitch,
    keys: (list: string) =>
      [...container.querySelectorAll(`[data-testid='${list}'] [data-testid='model-row']`)].map(
        (row) => row.getAttribute("data-key"),
      ),
    stars: () => [...container.querySelectorAll<HTMLButtonElement>("[data-testid='model-star']")],
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("lists a starred model only under Starred, ahead of the most used", async () => {
  const view = await render(["beta", "gone"], ["beta", "gamma"]);
  expect(view.keys("model-starred-list")).toEqual([key("beta")]);
  expect(view.keys("model-top-list")).toEqual([key("gamma")]);
  expect(view.keys("model-all-list")).toEqual([key("alpha")]);
  expect(view.stars().map((star) => star.getAttribute("aria-pressed"))).toEqual([
    "true",
    "false",
    "false",
  ]);
  await view.cleanup();
});

it("stars without switching, and takes a second star while the first is saving", async () => {
  const first = deferred<{ ok: true }>();
  rpcMock.botModels.setStarred.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
  const view = await render([]);
  await act(async () => view.stars()[0]?.click());
  await act(async () => view.stars()[1]?.click());
  expect(rpcMock.botModels.setStarred.mock.calls).toEqual([
    [{ provider: "test", modelId: "alpha", starred: true }],
    [{ provider: "test", modelId: "beta", starred: true }],
  ]);
  expect(view.onSwitch).not.toHaveBeenCalled();
  await act(async () => first.resolve({ ok: true }));
  await view.cleanup();
});
