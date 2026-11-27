import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Actor,
  BondbotUpdateAvailability,
  BondbotUpdateJob,
  BondbotUpdateMode,
} from "@rakazo/contracts";
import { BONDBOT_VERSION as BONDBOT_API_VERSION } from "@rakazo/contracts";
import {
  BONDBOT_GITHUB_BRANCH,
  BONDBOT_GITHUB_OWNER,
  BONDBOT_GITHUB_REPO,
  BONDBOT_REPO_URL,
  ClientError,
  extractLatestChangelogNotes,
  isBondbotVersionNewer,
  parseBondbotVersionFile,
} from "@rakazo/core";

export class BondbotUpdateForbiddenError extends ClientError {
  constructor(message = "Only workspace owners or admins can update BondBot.") {
    super("FORBIDDEN", message, "BONDBOT_UPDATE_FORBIDDEN");
    this.name = "BondbotUpdateForbiddenError";
  }
}

import { bestEffort, getLogger } from "@rakazo/logging";
import { isAdmin } from "../auth/admins.js";
import type { RouterDeps } from "../router.js";

const CHECK_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_FETCH_TIMEOUT_MS = 10_000;
const SIDECAR_FETCH_TIMEOUT_MS = 10_000;

interface CachedRemoteRelease {
  fetchedAtMs: number;
  checkedAt: string;
  latestUiVersion: string | null;
  latestApiVersion: string | null;
  latestCommit: string | null;
  changelogSummary: string | null;
  checkError: string | null;
}

export interface BondbotCommandResult {
  ok: boolean;
  stdout: string;
  output: string;
}

export type BondbotCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<BondbotCommandResult>;

const defaultRunner: BondbotCommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const combined = `${stdout}${stderr}`.trim();
        const output = combined.length > 3500 ? combined.slice(-3500) : combined;
        resolve({
          ok: !error,
          stdout: String(stdout),
          output: error && !output ? error.message : output,
        });
      },
    );
  });

let cachedRelease: CachedRemoteRelease | null = null;
let inFlightReleaseCheck: Promise<CachedRemoteRelease> | null = null;

let sourceJob: BondbotUpdateJob = {
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

/** Reset in-memory caches for tests. */
export function resetBondbotUpdateStateForTests() {
  cachedRelease = null;
  inFlightReleaseCheck = null;
  sourceJob = {
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

function hasOwnerOrAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "owner" || part === "admin");
}

export async function canManageBondbotUpdate(deps: RouterDeps, actor: Actor): Promise<boolean> {
  if (deps.env?.bondbotAnyMemberUpdate === true) return true;
  if (actor.isDeploymentOwner === true) return true;
  if (await isAdmin(deps, actor.userId)) return true;

  try {
    if (typeof deps.prisma?.spaceMember?.findFirst === "function") {
      const spaceMembership = await deps.prisma.spaceMember.findFirst({
        where: { spaceId: actor.spaceId, userId: actor.userId },
        select: { role: true },
      });
      if (hasOwnerOrAdminRole(spaceMembership?.role)) return true;
    }
    if (typeof deps.prisma?.member?.findFirst === "function") {
      const orgMemberships = await deps.prisma.member.findFirst({
        where: { userId: actor.userId },
        select: { role: true },
      });
      if (hasOwnerOrAdminRole(orgMemberships?.role)) return true;
    }
  } catch (error) {
    getLogger().warn("failed checking workspace role for BondBot updates", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
}

export async function findSourceRepoRoot(startDir = process.cwd()): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      await access(path.join(dir, ".git"));
      await access(path.join(dir, "apps/web/src/lib/bondbot-version.ts"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

async function resolveUpdateMode(
  deps: RouterDeps,
  repoRoot: string | null,
): Promise<BondbotUpdateMode> {
  if (deps.env?.bondbotUpdaterUrl?.trim() && deps.env?.bondbotUpdaterToken?.trim()) {
    return "sidecar";
  }
  if (repoRoot) return "source";
  return "manual";
}

function buildManualCommands(mode: BondbotUpdateMode): string[] {
  if (mode === "source") {
    return [
      `git pull --ff-only origin ${BONDBOT_GITHUB_BRANCH}`,
      "pnpm install --frozen-lockfile",
      "pnpm build",
    ];
  }
  return [
    `git clone --branch ${BONDBOT_GITHUB_BRANCH} --single-branch ${BONDBOT_REPO_URL}.git /tmp/bondbot-src`,
    "docker build -f /tmp/bondbot-src/infra/compose/Dockerfile -t rakazo-voice:local /tmp/bondbot-src",
    "docker compose up -d --no-build api worker web supervisor",
  ];
}

async function fetchRemoteRelease(
  fetchImpl: typeof fetch,
  force: boolean,
): Promise<CachedRemoteRelease> {
  if (!force && cachedRelease && Date.now() - cachedRelease.fetchedAtMs < CHECK_CACHE_TTL_MS) {
    return cachedRelease;
  }
  if (!force && inFlightReleaseCheck) return inFlightReleaseCheck;

  const work = (async (): Promise<CachedRemoteRelease> => {
    const rawBase = `https://raw.githubusercontent.com/${BONDBOT_GITHUB_OWNER}/${BONDBOT_GITHUB_REPO}/${BONDBOT_GITHUB_BRANCH}`;
    const apiUrl = `https://api.github.com/repos/${BONDBOT_GITHUB_OWNER}/${BONDBOT_GITHUB_REPO}/commits/${BONDBOT_GITHUB_BRANCH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
    try {
      const [webRes, contractsRes, changelogRes, commitRes] = await Promise.all([
        fetchImpl(`${rawBase}/apps/web/src/lib/bondbot-version.ts`, {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetchImpl(`${rawBase}/packages/contracts/src/bondbot-version.ts`, {
          cache: "no-store",
          signal: controller.signal,
        }),
        bestEffort(
          "fetch GitHub changelog",
          fetchImpl(`${rawBase}/docs/bondbot/CHANGELOG-BONDBOT.md`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ),
        bestEffort(
          "fetch GitHub commit metadata",
          fetchImpl(apiUrl, {
            cache: "no-store",
            headers: { Accept: "application/vnd.github+json" },
            signal: controller.signal,
          }),
        ),
      ]);

      if (!webRes.ok && !contractsRes.ok) {
        const result: CachedRemoteRelease = {
          fetchedAtMs: Date.now(),
          checkedAt: new Date().toISOString(),
          latestUiVersion: null,
          latestApiVersion: null,
          latestCommit: null,
          changelogSummary: null,
          checkError: `GitHub returned ${webRes.status} while checking BondBot updates.`,
        };
        cachedRelease = result;
        return result;
      }

      const [webText, contractsText, changelogText, commitJson] = await Promise.all([
        webRes.ok ? webRes.text() : Promise.resolve(""),
        contractsRes.ok ? contractsRes.text() : Promise.resolve(""),
        changelogRes?.ok ? changelogRes.text() : Promise.resolve(""),
        commitRes?.ok
          ? bestEffort(
              "parse GitHub commit metadata",
              commitRes.json() as Promise<{ sha?: string }>,
            )
          : Promise.resolve(null),
      ]);

      const latestUiVersion = webText ? parseBondbotVersionFile(webText) : null;
      const latestApiVersion = contractsText ? parseBondbotVersionFile(contractsText) : null;
      const latestCommit =
        typeof commitJson?.sha === "string" && commitJson.sha.length >= 7
          ? commitJson.sha.slice(0, 12)
          : null;
      const changelogSummary = changelogText
        ? extractLatestChangelogNotes(changelogText, latestUiVersion)
        : null;

      const result: CachedRemoteRelease = {
        fetchedAtMs: Date.now(),
        checkedAt: new Date().toISOString(),
        latestUiVersion,
        latestApiVersion,
        latestCommit,
        changelogSummary,
        checkError: null,
      };
      cachedRelease = result;
      return result;
    } catch (error) {
      return {
        fetchedAtMs: Date.now(),
        checkedAt: new Date().toISOString(),
        latestUiVersion: cachedRelease?.latestUiVersion ?? null,
        latestApiVersion: cachedRelease?.latestApiVersion ?? null,
        latestCommit: cachedRelease?.latestCommit ?? null,
        changelogSummary: cachedRelease?.changelogSummary ?? null,
        checkError:
          error instanceof Error ? error.message : "Could not reach GitHub to check updates.",
      };
    } finally {
      clearTimeout(timer);
      inFlightReleaseCheck = null;
    }
  })();

  inFlightReleaseCheck = work;
  return work;
}

async function resolveCurrentUiVersion(
  explicitUiVersion: string | undefined,
  repoRoot: string | null,
): Promise<string> {
  if (explicitUiVersion && parseBondbotVersionFile(`BONDBOT_VERSION = "${explicitUiVersion}"`)) {
    return explicitUiVersion.replace(/^v/i, "");
  }
  if (repoRoot) {
    try {
      const content = await readFile(
        path.join(repoRoot, "apps/web/src/lib/bondbot-version.ts"),
        "utf8",
      );
      const parsed = parseBondbotVersionFile(content);
      if (parsed) return parsed;
    } catch {
      // Fallback below.
    }
  }
  return BONDBOT_API_VERSION;
}

export async function getBondbotUpdateAvailability(
  deps: RouterDeps,
  actor: Actor,
  input?: { force?: boolean; uiVersion?: string },
  options?: { fetch?: typeof fetch; startDir?: string },
): Promise<BondbotUpdateAvailability> {
  const canManage = await canManageBondbotUpdate(deps, actor);
  const repoRoot = await findSourceRepoRoot(options?.startDir);
  const mode = await resolveUpdateMode(deps, repoRoot);
  const currentUiVersion = await resolveCurrentUiVersion(input?.uiVersion, repoRoot);
  const currentApiVersion = BONDBOT_API_VERSION;
  const currentCommit = deps.env?.gitSha ?? null;

  if (!canManage) {
    return {
      canManage: false,
      mode,
      canApply: false,
      currentUiVersion,
      currentApiVersion,
      currentCommit,
      latestUiVersion: null,
      latestApiVersion: null,
      latestCommit: null,
      updateAvailable: false,
      changelogSummary: null,
      repoUrl: BONDBOT_REPO_URL,
      branch: BONDBOT_GITHUB_BRANCH,
      checkedAt: null,
      checkError: null,
      manualCommands: [],
    };
  }

  const release = await fetchRemoteRelease(options?.fetch ?? fetch, input?.force === true);
  const updateAvailable = isBondbotVersionNewer({
    currentUiVersion,
    currentApiVersion,
    latestUiVersion: release.latestUiVersion,
    latestApiVersion: release.latestApiVersion,
  });

  return {
    canManage: true,
    mode,
    canApply: mode === "sidecar" || mode === "source",
    currentUiVersion,
    currentApiVersion,
    currentCommit,
    latestUiVersion: release.latestUiVersion,
    latestApiVersion: release.latestApiVersion,
    latestCommit: release.latestCommit,
    updateAvailable,
    changelogSummary: release.changelogSummary,
    repoUrl: BONDBOT_REPO_URL,
    branch: BONDBOT_GITHUB_BRANCH,
    checkedAt: release.checkedAt,
    checkError: release.checkError,
    manualCommands: buildManualCommands(mode),
  };
}

export async function applyBondbotUpdate(
  deps: RouterDeps,
  actor: Actor,
  input?: { expectedVersion?: string },
  options?: { fetch?: typeof fetch; run?: BondbotCommandRunner; startDir?: string },
): Promise<BondbotUpdateJob> {
  if (!(await canManageBondbotUpdate(deps, actor))) {
    throw new BondbotUpdateForbiddenError("Only workspace owners or admins can update BondBot.");
  }

  const repoRoot = await findSourceRepoRoot(options?.startDir);
  const mode = await resolveUpdateMode(deps, repoRoot);

  if (mode === "sidecar") {
    return proxyUpdaterSidecar(deps, "/bondbot/apply", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: input?.expectedVersion }),
      fetchImpl: options?.fetch ?? fetch,
    });
  }

  if (mode === "source" && repoRoot) {
    if (sourceJob.running) return sourceJob;
    sourceJob = {
      jobId: randomUUID(),
      running: true,
      phase: "checking",
      progress: 8,
      message: "Preparing local BondBot update...",
      targetUiVersion: input?.expectedVersion ?? null,
      targetApiVersion: null,
      targetCommit: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      restartRequired: false,
      logTail: null,
    };
    void runSourceCheckoutUpdate(repoRoot, options?.run ?? defaultRunner);
    return sourceJob;
  }

  return {
    jobId: null,
    running: false,
    phase: "failed",
    progress: 0,
    message: "Automatic updates require the updater sidecar or a git checkout.",
    targetUiVersion: null,
    targetApiVersion: null,
    targetCommit: null,
    startedAt: null,
    finishedAt: new Date().toISOString(),
    error: "No updater sidecar or git checkout is configured on this deployment.",
    restartRequired: false,
    logTail: null,
  };
}

export async function getBondbotUpdateProgress(
  deps: RouterDeps,
  actor: Actor,
  options?: { fetch?: typeof fetch; startDir?: string },
): Promise<BondbotUpdateJob> {
  if (!(await canManageBondbotUpdate(deps, actor))) {
    throw new BondbotUpdateForbiddenError(
      "Only workspace owners or admins can inspect update progress.",
    );
  }
  const repoRoot = await findSourceRepoRoot(options?.startDir);
  const mode = await resolveUpdateMode(deps, repoRoot);
  if (mode === "sidecar") {
    return proxyUpdaterSidecar(deps, "/bondbot/status", {
      method: "GET",
      fetchImpl: options?.fetch ?? fetch,
    });
  }
  return sourceJob;
}

async function proxyUpdaterSidecar(
  deps: RouterDeps,
  routePath: string,
  options: { method: "GET" | "POST"; body?: string; fetchImpl: typeof fetch },
): Promise<BondbotUpdateJob> {
  const baseUrl = deps.env?.bondbotUpdaterUrl?.trim().replace(/\/$/, "");
  const token = deps.env?.bondbotUpdaterToken?.trim();
  if (!baseUrl || !token) {
    throw new Error("Updater sidecar credentials are not configured.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDECAR_FETCH_TIMEOUT_MS);
  try {
    const res = await options.fetchImpl(`${baseUrl}${routePath}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = (await bestEffort("read updater error body", res.text())) ?? "";
      throw new Error(text || `Updater sidecar returned ${res.status}.`);
    }
    return (await res.json()) as BondbotUpdateJob;
  } finally {
    clearTimeout(timer);
  }
}

async function runSourceCheckoutUpdate(repoRoot: string, run: BondbotCommandRunner) {
  try {
    sourceJob = {
      ...sourceJob,
      phase: "checking",
      progress: 12,
      message: "Checking local git status...",
    };
    const status = await run("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      timeoutMs: 15_000,
    });
    if (!status.ok) throw new Error(status.output || "Could not inspect git working tree.");
    if (status.stdout.trim().length > 0) {
      throw new Error(
        "Local git working tree has uncommitted changes. Commit or stash them first.",
      );
    }

    sourceJob = {
      ...sourceJob,
      phase: "downloading",
      progress: 26,
      message: `Pulling latest ${BONDBOT_GITHUB_BRANCH} from GitHub...`,
    };
    const pull = await run("git", ["pull", "--ff-only", "origin", BONDBOT_GITHUB_BRANCH], {
      cwd: repoRoot,
      timeoutMs: 120_000,
    });
    if (!pull.ok) throw new Error(pull.output || "Could not fast-forward pull from GitHub.");

    const rev = await run("git", ["rev-parse", "--short=10", "HEAD"], {
      cwd: repoRoot,
      timeoutMs: 10_000,
    });
    sourceJob = {
      ...sourceJob,
      targetCommit: rev.ok ? rev.stdout.trim() || null : null,
      phase: "building",
      progress: 48,
      message: "Installing workspace dependencies...",
    };

    const install = await run("pnpm", ["install", "--frozen-lockfile"], {
      cwd: repoRoot,
      timeoutMs: 300_000,
    });
    if (!install.ok) throw new Error(install.output || "pnpm install failed.");

    sourceJob = {
      ...sourceJob,
      progress: 72,
      message: "Building BondBot packages and web app...",
    };
    const build = await run("pnpm", ["build"], {
      cwd: repoRoot,
      timeoutMs: 600_000,
    });
    if (!build.ok) throw new Error(build.output || "Workspace build failed.");

    await bestEffort(
      "run optional source migration",
      run("pnpm", ["--filter", "@rakazo/db", "generate"], {
        cwd: repoRoot,
        timeoutMs: 60_000,
      }),
    );

    sourceJob = {
      ...sourceJob,
      running: false,
      phase: "succeeded",
      progress: 100,
      message: "Updated local checkout! Restart the server process and reload.",
      restartRequired: true,
      finishedAt: new Date().toISOString(),
      logTail: build.output || null,
    };
  } catch (error) {
    sourceJob = {
      ...sourceJob,
      running: false,
      phase: "failed",
      message: "Local update failed.",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    };
  }
}
