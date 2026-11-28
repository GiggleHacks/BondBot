// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BondBotMark } from "./BondBotMark";
import type { BondbotUpdateContextValue } from "./bondbot-update/BondbotUpdateProvider";
import { BondbotUpdateContext } from "./bondbot-update/BondbotUpdateProvider";

const baseAvailability = {
  canManage: true,
  mode: "sidecar" as const,
  canApply: true,
  currentUiVersion: "0.3.0",
  currentApiVersion: "1.8.0",
  currentCommit: "1111111",
  latestUiVersion: "0.4.0",
  latestApiVersion: "1.9.0",
  latestCommit: "2222222",
  updateAvailable: true,
  changelogSummary: "- Added one-click BondBot updater",
  repoUrl: "https://github.com/GiggleHacks/BondBot",
  branch: "main",
  checkedAt: "2026-11-27T00:00:00.000Z",
  checkError: null,
  manualCommands: [],
};

describe("BondBotMark update indicator", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function renderMark(value: BondbotUpdateContextValue | null, mini = false) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <BondbotUpdateContext.Provider value={value}>
          <BondBotMark mini={mini} />
        </BondbotUpdateContext.Provider>,
      );
    });
    return () => act(() => root.unmount());
  }

  it("opens the update popover with the running steps", async () => {
    const startUpdate = vi.fn();
    const skipCurrentUpdate = vi.fn();
    const cleanup = renderMark({
      availability: baseAvailability,
      job: {
        jobId: "job-1",
        running: true,
        phase: "building",
        progress: 42,
        message: "Building BondBot v0.4.0...",
        targetUiVersion: "0.4.0",
        targetApiVersion: "1.9.0",
        targetCommit: "2222222",
        startedAt: "2026-11-27T00:00:00.000Z",
        finishedAt: null,
        error: null,
        restartRequired: false,
        logTail: null,
      },
      showUpdate: true,
      canOpenPopover: true,
      isUpdating: true,
      reconnecting: false,
      reloading: false,
      applyPending: false,
      applyError: null,
      checking: false,
      skippedVersion: null,
      checkNow: vi.fn(),
      startUpdate,
      skipCurrentUpdate,
      reloadApp: vi.fn(),
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="bondbot-mark-trigger"]',
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.click();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="bondbot-update-popover"]')).toBeTruthy();
    });
    await vi.waitFor(() => expect(document.querySelector('[role="progressbar"]')).toBeTruthy());
    const bar = document.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
    const states = [...document.querySelectorAll("li")].map((step) => step.dataset.state);
    expect(states).toEqual(["done", "active", "pending", "pending"]);
    expect(document.body.textContent).toContain("Safe to refresh or close this page.");
    cleanup();
  });

  it("hides the trigger when no update context or non-admin user", () => {
    const cleanup = renderMark(null);
    expect(document.querySelector('[data-testid="bondbot-mark-trigger"]')).toBeNull();
    cleanup();
  });
});
