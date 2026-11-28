// @vitest-environment jsdom
import type { BondbotUpdateJob } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BondbotUpdateProvider, useBondbotUpdate } from "./BondbotUpdateProvider";

const progress = vi.hoisted(() => vi.fn());
vi.mock("../../lib/query/query", () => ({
  useQueryUserId: () => "user-1",
  useSave: () => ({ run: vi.fn(), reset: vi.fn(), pending: false, error: null }),
  useSpaceQueries: () => ({
    bondbotUpdate: {
      status: {
        queryKey: () => ["status"],
        queryOptions: () => ({
          queryKey: ["status"],
          queryFn: async () => ({ canManage: true, canApply: true, updateAvailable: true }),
        }),
      },
      progress: { queryOptions: () => ({ queryKey: ["progress"], queryFn: progress }) },
    },
  }),
}));

const job = (patch: Partial<BondbotUpdateJob>) =>
  ({ running: true, phase: "restarting", progress: 94, ...patch }) as BondbotUpdateJob;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps asking while the server restarts, then reloads once the update has finished", async () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  progress
    .mockResolvedValueOnce(job({}))
    .mockRejectedValueOnce(new Error("restarting"))
    .mockResolvedValue(job({ running: false, phase: "succeeded", progress: 100 }));
  let phase: string | undefined;
  function Probe() {
    phase = useBondbotUpdate()?.job?.phase;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <BondbotUpdateProvider>
          <Probe />
        </BondbotUpdateProvider>
      </QueryClientProvider>,
    ),
  );
  // A page loaded mid-update picks the running job up.
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(phase).toBe("restarting");
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(phase).toBe("reconnecting");
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(reload).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
