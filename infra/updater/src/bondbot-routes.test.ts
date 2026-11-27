import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BondbotUpdateJob } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdaterApp } from "./index.js";
import { resolveUpdaterConfig } from "./updater-logic.js";

describe("updater BondBot routes", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function makeDeployDir() {
    const dir = mkdtempSync(path.join(tmpdir(), "bondbot-updater-test-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, ".env"), "RAKAZO_IMAGE=rakazo-voice\nRAKAZO_IMAGE_TAG=local\n");
    mkdirSync(path.join(dir, ".bondbot-source/.git"), { recursive: true });
    mkdirSync(path.join(dir, ".bondbot-source/apps/web/src/lib"), { recursive: true });
    mkdirSync(path.join(dir, ".bondbot-source/packages/contracts/src"), { recursive: true });
    writeFileSync(
      path.join(dir, ".bondbot-source/apps/web/src/lib/bondbot-version.ts"),
      'export const BONDBOT_VERSION = "0.4.0";\n',
    );
    writeFileSync(
      path.join(dir, ".bondbot-source/packages/contracts/src/bondbot-version.ts"),
      'export const BONDBOT_API_VERSION = "1.9.0";\n',
    );
    return dir;
  }

  it("clones/fetches, builds, migrates, and recreates non-updater services", async () => {
    const deployDir = makeDeployDir();
    const token = "secret-updater-token-00000000000000";
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "git" && args[0] === "rev-parse") {
        return { ok: true, exitCode: 0, stdout: "abcdef1234\n", output: "" };
      }
      return { ok: true, exitCode: 0, stdout: "", output: "done" };
    });

    const config = resolveUpdaterConfig({
      RAKAZO_DEPLOY_DIR: deployDir,
      RAKAZO_UPDATER_TOKEN: token,
      RAKAZO_UPDATE_SERVICES: "supervisor,computer",
    });
    const app = createUpdaterApp(config, { run });

    const startRes = await app.request("/bondbot/apply", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expectedVersion: "0.4.0" }),
    });
    expect(startRes.status).toBe(202);

    await vi.waitFor(async () => {
      const statusRes = await app.request("/bondbot/status", {
        headers: { authorization: `Bearer ${token}` },
      });
      const job = (await statusRes.json()) as BondbotUpdateJob;
      expect(job.running).toBe(false);
      expect(job.phase).toBe("succeeded");
      expect(job.progress).toBe(100);
      expect(job.targetUiVersion).toBe("0.4.0");
      expect(job.targetApiVersion).toBe("1.9.0");
      expect(job.targetCommit).toBe("abcdef1234");
    });

    const buildCall = calls.find((c) => c.command === "docker" && c.args[0] === "build");
    expect(buildCall?.args).toContain("rakazo-voice:local");
    expect(buildCall?.args).toContain("GIT_SHA=abcdef1234-v040");

    const upCall = calls.find((c) => c.command === "docker" && c.args.includes("up"));
    expect(upCall?.args).toContain("api");
    expect(upCall?.args).toContain("worker");
    expect(upCall?.args).toContain("web");
    expect(upCall?.args).toContain("supervisor");
    expect(upCall?.args).not.toContain("computer");
    expect(upCall?.args).not.toContain("updater");
  });
});
