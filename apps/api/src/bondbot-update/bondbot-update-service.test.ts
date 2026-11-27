import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Actor } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import {
  applyBondbotUpdate,
  getBondbotUpdateAvailability,
  getBondbotUpdateProgress,
  resetBondbotUpdateStateForTests,
} from "./bondbot-update-service.js";

describe("bondbot-update-service", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    resetBondbotUpdateStateForTests();
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function makeRepoCheckout() {
    const dir = mkdtempSync(path.join(tmpdir(), "bondbot-src-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    mkdirSync(path.join(dir, "apps/web/src/lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "apps/web/src/lib/bondbot-version.ts"),
      'export const BONDBOT_VERSION = "0.3.0";\n',
    );
    return dir;
  }

  function makeDeps(overrides: Partial<RouterDeps["env"]> = {}, role = "owner"): RouterDeps {
    return {
      env: {
        adminEmails: [],
        gitSha: "1111111",
        ...overrides,
      },
      prisma: {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        spaceMember: { findFirst: vi.fn().mockResolvedValue({ role }) },
        member: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as RouterDeps;
  }

  const actor: Actor = {
    userId: "user-1",
    spaceId: "space-1",
    email: "owner@example.com",
    isDeploymentOwner: false,
  };

  it("detects newer GitHub versions for space owners and caches checks", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("apps/web/src/lib/bondbot-version.ts")) {
        return new Response('export const BONDBOT_VERSION = "99.0.0";\n', { status: 200 });
      }
      if (target.includes("packages/contracts/src/bondbot-version.ts")) {
        return new Response('export const BONDBOT_API_VERSION = "99.0.0";\n', { status: 200 });
      }
      if (target.includes("CHANGELOG-BONDBOT.md")) {
        return new Response("## [99.0.0] - 2026-11-27\n- Test note\n", { status: 200 });
      }
      return new Response(JSON.stringify({ sha: "deadbeef123456" }), { status: 200 });
    });

    const deps = makeDeps({
      bondbotUpdaterUrl: "http://updater:7092",
      bondbotUpdaterToken: "secret-token",
    });

    const first = await getBondbotUpdateAvailability(
      deps,
      actor,
      { uiVersion: "0.3.0" },
      { fetch: fetchMock as typeof fetch },
    );
    expect(first.canManage).toBe(true);
    expect(first.mode).toBe("sidecar");
    expect(first.canApply).toBe(true);
    expect(first.updateAvailable).toBe(true);
    expect(first.latestUiVersion).toBe("99.0.0");
    expect(first.changelogSummary).toBe("- Test note");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Second call uses cache unless force: true.
    await getBondbotUpdateAvailability(
      deps,
      actor,
      { uiVersion: "0.3.0" },
      { fetch: fetchMock as typeof fetch },
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("hides update availability from non-admin members unless enabled by env", async () => {
    const fetchMock = vi.fn();
    const restrictedDeps = makeDeps({}, "member");
    const hidden = await getBondbotUpdateAvailability(
      restrictedDeps,
      actor,
      { uiVersion: "0.3.0" },
      { fetch: fetchMock as typeof fetch },
    );
    expect(hidden.canManage).toBe(false);
    expect(hidden.updateAvailable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const openDeps = makeDeps({ bondbotAnyMemberUpdate: true }, "member");
    fetchMock.mockResolvedValue(
      new Response('export const BONDBOT_VERSION = "0.3.0";', { status: 200 }),
    );
    const visible = await getBondbotUpdateAvailability(
      openDeps,
      actor,
      { uiVersion: "0.3.0" },
      { fetch: fetchMock as typeof fetch },
    );
    expect(visible.canManage).toBe(true);
  });

  it("runs source checkout updates cleanly when no updater sidecar is configured", async () => {
    const repoDir = makeRepoCheckout();
    const deps = makeDeps({}, "owner");
    const run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "status") {
        return { ok: true, stdout: "", output: "" };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { ok: true, stdout: "fedcba9876\n", output: "" };
      }
      return { ok: true, stdout: "ok", output: "ok" };
    });

    const job = await applyBondbotUpdate(
      deps,
      actor,
      { expectedVersion: "0.4.0" },
      { run, startDir: repoDir },
    );
    expect(job.running).toBe(true);

    await vi.waitFor(async () => {
      const progress = await getBondbotUpdateProgress(deps, actor, { startDir: repoDir });
      expect(progress.running).toBe(false);
      expect(progress.phase).toBe("succeeded");
      expect(progress.progress).toBe(100);
      expect(progress.restartRequired).toBe(true);
    });
  });
});
