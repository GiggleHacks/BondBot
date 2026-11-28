import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BondbotUpdateJob } from "@rakazo/contracts";
import type { ComposeTarget } from "@rakazo/core";
import {
  BONDBOT_GIT_URL,
  BONDBOT_GITHUB_BRANCH,
  composeUpArgv,
  parseBondbotVersionFile,
  RECREATED_SERVICES,
} from "@rakazo/core";
import type { Logger } from "@rakazo/logging";
import { bestEffort } from "@rakazo/logging";
import type { Hono } from "hono";
import type { StepProgress } from "./bondbot-progress.js";
import { buildProgressReader, gitProgressReader } from "./bondbot-progress.js";
import type { UpdaterCommandRunner } from "./index.js";
import type { UpdaterConfig } from "./updater-logic.js";
import { readEnvAssignment, readTagState } from "./updater-logic.js";

const SOURCE_DIR_NAME = ".bondbot-source";
/** How long the last successful update took, to estimate the next one. */
const LAST_RUN_FILE = ".bondbot-update-last.json";
const CLONE_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 1_800_000;
const MIGRATE_TIMEOUT_MS = 300_000;
const RECREATE_TIMEOUT_MS = 900_000;

export function initialBondbotJob(): BondbotUpdateJob {
  return {
    jobId: null,
    running: false,
    phase: "idle",
    progress: 0,
    message: "Ready",
    targetUiVersion: null,
    targetApiVersion: null,
    targetCommit: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    restartRequired: false,
    logTail: null,
  };
}

export function appServicesToRecreate(configuredServices: readonly string[]): string[] {
  const services = new Set<string>(RECREATED_SERVICES);
  for (const name of configuredServices) {
    if (name !== "updater" && name !== "computer" && name !== "migrate") {
      services.add(name);
    }
  }
  return [...services];
}

export function mountBondbotRoutes(
  app: Hono,
  deps: {
    config: UpdaterConfig;
    run: UpdaterCommandRunner;
    composeTarget: ComposeTarget;
    readEnvFile: () => Promise<string>;
    isUpdateLocked: () => boolean;
    withRunLock: <T>(work: () => Promise<T>) => Promise<T>;
    logger?: Logger;
  },
) {
  let job: BondbotUpdateJob = initialBondbotJob();
  let lastDurationSeconds: number | null = null;
  const lastRunPath = path.join(deps.config.deployDir, LAST_RUN_FILE);

  async function readLastDuration(): Promise<number | null> {
    const text = await readOptionalText(lastRunPath);
    const seconds = Number(/"durationSeconds":\s*(\d+)/.exec(text ?? "")?.[1]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function withEta(current: BondbotUpdateJob): BondbotUpdateJob {
    if (!current.running || !current.startedAt || !lastDurationSeconds) return current;
    const left = lastDurationSeconds - (Date.now() - Date.parse(current.startedAt)) / 1000;
    // Past the last run's length there is nothing honest to say.
    return left > 0 ? { ...current, etaSeconds: Math.round(left) } : current;
  }

  /** Places a command's own progress inside its share of the whole update. */
  function liveProgress(from: number, to: number) {
    return ({ fraction, detail, downloadedBytes, bytesPerSecond }: StepProgress) => {
      job = {
        ...job,
        progress: Math.max(job.progress, Math.round(from + (to - from) * fraction)),
        detail: detail?.slice(0, 300) ?? null,
        downloadedBytes,
        bytesPerSecond,
        lastOutputAt: new Date().toISOString(),
      };
    };
  }

  app.get("/bondbot/status", (c) => c.json(withEta(job)));

  app.post("/bondbot/apply", async (c) => {
    if (job.running) return c.json(job, 202);
    if (deps.isUpdateLocked()) {
      return c.json({ error: "Another update is already in progress." }, 409);
    }

    let expectedVersion: string | null = null;
    try {
      const body = (await c.req.json()) as { expectedVersion?: string } | null;
      if (typeof body?.expectedVersion === "string" && body.expectedVersion.trim()) {
        expectedVersion = body.expectedVersion.trim();
      }
    } catch {
      // Optional JSON body.
    }

    job = {
      jobId: randomUUID(),
      running: true,
      phase: "checking",
      progress: 8,
      message: "Preparing update workspace...",
      targetUiVersion: expectedVersion,
      targetApiVersion: null,
      targetCommit: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      restartRequired: false,
      logTail: null,
    };

    lastDurationSeconds = await readLastDuration();
    void runBondbotApply();
    return c.json(withEta(job), 202);
  });

  async function runBondbotApply() {
    try {
      await deps.withRunLock(async () => {
        const sourceDir = path.join(deps.config.deployDir, SOURCE_DIR_NAME);
        await syncSourceCheckout(sourceDir);

        const [shortSha, targetVersions] = await Promise.all([
          readHeadSha(sourceDir),
          readCheckoutVersions(sourceDir),
        ]);
        const targetUiVersion = targetVersions.uiVersion ?? job.targetUiVersion;
        const targetApiVersion = targetVersions.apiVersion;
        job = {
          ...job,
          targetCommit: shortSha,
          targetUiVersion,
          targetApiVersion,
        };

        const envText = await deps.readEnvFile();
        const tagState = readTagState(envText);
        const imageRepo = readEnvAssignment(envText, "RAKAZO_IMAGE") ?? deps.config.image;
        const imageRef = `${imageRepo}:${tagState.currentTag}`;
        const backupRef = `${imageRepo}:pre-bondbot-update`;

        job = {
          ...job,
          phase: "building",
          progress: 20,
          detail: null,
          downloadedBytes: undefined,
          bytesPerSecond: undefined,
          message: targetUiVersion
            ? `Building BondBot v${targetUiVersion}...`
            : "Building BondBot image...",
        };

        // Preserve the running image tag for manual rollback if build succeeds and something breaks later.
        await bestEffort(
          "tag previous BondBot image",
          deps.run("docker", ["tag", imageRef, backupRef], {
            cwd: deps.config.deployDir,
            timeoutMs: 30_000,
          }),
        );

        const versionSuffix = targetUiVersion
          ? `-v${targetUiVersion.replace(/[^0-9A-Za-z]/g, "")}`
          : "";
        const gitShaArg = `${shortSha ?? "unknown"}${versionSuffix}`;
        const buildResult = await deps.run(
          "docker",
          [
            "build",
            "--progress=plain",
            "-f",
            "infra/compose/Dockerfile",
            "--build-arg",
            `GIT_SHA=${gitShaArg}`,
            "-t",
            imageRef,
            ".",
          ],
          {
            cwd: sourceDir,
            timeoutMs: BUILD_TIMEOUT_MS,
            onOutput: buildProgressReader(liveProgress(20, 88)),
          },
        );
        if (!buildResult.ok) {
          throw new UpdateFailure("Docker build failed.", buildResult.output);
        }

        job = {
          ...job,
          phase: "migrating",
          progress: 90,
          detail: null,
          bytesPerSecond: undefined,
          message: "Running database migrations...",
        };

        const composeEnv = { COMPOSE_PROJECT_NAME: deps.config.projectName };
        const migrateArgs = [
          "compose",
          "--project-directory",
          deps.config.deployDir,
          "-p",
          deps.config.projectName,
          "--env-file",
          deps.config.envFile,
          ...deps.composeTarget.composeFiles.flatMap((file) => ["--file", file]),
          "run",
          "--rm",
          "--no-deps",
          "migrate",
        ];
        const migrateResult = await deps.run("docker", migrateArgs, {
          cwd: deps.config.deployDir,
          timeoutMs: MIGRATE_TIMEOUT_MS,
          env: composeEnv,
        });
        if (!migrateResult.ok) {
          throw new UpdateFailure("Database migration failed.", migrateResult.output);
        }

        job = {
          ...job,
          phase: "restarting",
          progress: 94,
          message: "Restarting BondBot services...",
        };

        const upInvocation = composeUpArgv(
          {
            ...deps.composeTarget,
            services: appServicesToRecreate(deps.config.updateServices),
          },
          { build: false },
        );
        const upArgs = [
          upInvocation.args[0]!,
          "--project-directory",
          deps.config.deployDir,
          ...upInvocation.args.slice(1),
        ];
        const upResult = await deps.run(upInvocation.command, upArgs, {
          cwd: deps.config.deployDir,
          timeoutMs: RECREATE_TIMEOUT_MS,
          env: composeEnv,
        });
        if (!upResult.ok) {
          throw new UpdateFailure("Service recreate failed.", upResult.output);
        }

        job = {
          ...job,
          running: false,
          phase: "succeeded",
          progress: 100,
          message: targetUiVersion ? `Updated to BondBot v${targetUiVersion}.` : "Update complete.",
          finishedAt: new Date().toISOString(),
          logTail: upResult.output || null,
        };
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - Date.parse(job.startedAt!)) / 1000),
        );
        await bestEffort(
          "remember how long the BondBot update took",
          writeFile(lastRunPath, JSON.stringify({ durationSeconds })),
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const logTail = error instanceof UpdateFailure ? error.logTail : null;
      deps.logger?.error("bondbot self-update failed", { error: message });
      job = {
        ...job,
        running: false,
        phase: "failed",
        message: "Update failed.",
        error: message,
        logTail,
        finishedAt: new Date().toISOString(),
      };
    }
  }

  async function syncSourceCheckout(sourceDir: string) {
    job = {
      ...job,
      phase: "downloading",
      progress: 5,
      message: "Downloading latest BondBot code from GitHub...",
    };
    const onOutput = gitProgressReader(liveProgress(5, 20));

    const hasRepo = await pathExists(path.join(sourceDir, ".git"));
    if (!hasRepo) {
      await mkdir(sourceDir, { recursive: true });
      const clone = await deps.run(
        "git",
        [
          "clone",
          "--progress",
          "--branch",
          BONDBOT_GITHUB_BRANCH,
          "--single-branch",
          BONDBOT_GIT_URL,
          sourceDir,
        ],
        { cwd: deps.config.deployDir, timeoutMs: CLONE_TIMEOUT_MS, onOutput },
      );
      if (!clone.ok) {
        throw new UpdateFailure("Could not clone BondBot from GitHub.", clone.output);
      }
      return;
    }

    const fetch = await deps.run(
      "git",
      ["fetch", "--progress", BONDBOT_GIT_URL, BONDBOT_GITHUB_BRANCH],
      { cwd: sourceDir, timeoutMs: CLONE_TIMEOUT_MS, onOutput },
    );
    if (!fetch.ok) {
      throw new UpdateFailure("Could not fetch latest changes from GitHub.", fetch.output);
    }

    const reset = await deps.run("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd: sourceDir,
      timeoutMs: 60_000,
    });
    if (!reset.ok) {
      throw new UpdateFailure("Could not update local build checkout.", reset.output);
    }
  }

  async function readHeadSha(sourceDir: string): Promise<string | null> {
    const rev = await deps.run("git", ["rev-parse", "--short=10", "HEAD"], {
      cwd: sourceDir,
      timeoutMs: 10_000,
    });
    return rev.ok ? rev.stdout.trim() || null : null;
  }

  async function readCheckoutVersions(sourceDir: string): Promise<{
    uiVersion: string | null;
    apiVersion: string | null;
  }> {
    const [webSrc, apiSrc] = await Promise.all([
      readOptionalText(path.join(sourceDir, "apps/web/src/lib/bondbot-version.ts")),
      readOptionalText(path.join(sourceDir, "packages/contracts/src/bondbot-version.ts")),
    ]);
    return {
      uiVersion: webSrc ? parseBondbotVersionFile(webSrc) : null,
      apiVersion: apiSrc ? parseBondbotVersionFile(apiSrc) : null,
    };
  }
}

class UpdateFailure extends Error {
  readonly logTail: string | null;
  constructor(message: string, output: string) {
    super(message);
    this.name = "UpdateFailure";
    const trimmed = output.trim();
    this.logTail = trimmed.length > 3500 ? trimmed.slice(-3500) : trimmed || null;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}
