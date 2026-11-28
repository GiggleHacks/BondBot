import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type {
  AddVpnProfilesInput,
  AddVpnProfilesResult,
  BotVpnStatus,
  ComputerMode,
  ComputerVpnOverview,
  ComputerVpnRuntimeState,
  VpnProfileInfo,
  VpnTestOutcome,
  VpnTestResult,
} from "@rakazo/contracts";
import { ClientError } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

export interface SupervisorVpnEnv {
  sandboxProvider: string;
  sandboxSupervisorUrl?: string;
  sandboxSupervisorToken?: string;
}

interface SupervisorVpnBridgeState {
  bridge: string;
  profile: string | null;
  locked: boolean;
  running: boolean;
  state: ComputerVpnRuntimeState;
  exitIp: string | null;
  exitCountry: string | null;
}

/** A profile as the host reports it: `owner` is the Space that uploaded it, none for the operator's. */
interface HostVpnProfile {
  id: string;
  name?: string;
  owner?: string | null;
  countryCode: string;
  countryName: string;
  serverLabel: string;
  up: boolean;
  handshakeAgeSec: number | null;
}

interface SupervisorVpnStatusResponse {
  supported: boolean;
  killSwitchAvailable?: boolean;
  hostIp: string | null;
  hostCountry: string | null;
  profiles: HostVpnProfile[];
  bridges: Record<string, SupervisorVpnBridgeState>;
}

/** A VPN request the person can fix: a bad file, a VPN still in use, one that is not theirs. */
export class VpnProfileError extends ClientError {}

function toProfileInfo(profile: HostVpnProfile): VpnProfileInfo {
  return {
    id: profile.id,
    name: profile.name || profile.serverLabel || profile.id,
    countryCode: profile.countryCode,
    countryName: profile.countryName,
    serverLabel: profile.serverLabel,
    up: profile.up,
    handshakeAgeSec: profile.handshakeAgeSec,
    shared: !profile.owner,
  };
}

/** The profiles a Space may see and assign: its own uploads and the operator's shared files. */
export function visibleVpnProfiles(profiles: HostVpnProfile[], spaceId: string): VpnProfileInfo[] {
  return profiles
    .filter((profile) => !profile.owner || profile.owner === spaceId)
    .map(toProfileInfo);
}

export function bridgeNameForHomeKey(homeKey: string): string {
  const hash = createHash("sha256").update(homeKey).digest("hex").slice(0, 7);
  return `rakazo-c${hash}`;
}

function supervisorCredentials(
  env: SupervisorVpnEnv | undefined,
): { url: string; token: string } | undefined {
  if (
    !env ||
    env.sandboxProvider !== "docker" ||
    !env.sandboxSupervisorToken ||
    !env.sandboxSupervisorUrl
  ) {
    return undefined;
  }
  return {
    url: env.sandboxSupervisorUrl.replace(/\/$/, ""),
    token: env.sandboxSupervisorToken,
  };
}

export async function fetchSupervisorVpnStatus(
  env: SupervisorVpnEnv | undefined,
): Promise<SupervisorVpnStatusResponse> {
  const creds = supervisorCredentials(env);
  if (!creds) {
    return {
      supported: false,
      hostIp: null,
      hostCountry: null,
      profiles: [],
      bridges: {},
    };
  }
  try {
    const res = await fetch(`${creds.url}/vpn/status`, {
      headers: { authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      getLogger().warn("supervisor vpn status failed", { status: res.status });
      return {
        supported: false,
        hostIp: null,
        hostCountry: null,
        profiles: [],
        bridges: {},
      };
    }
    return (await res.json()) as SupervisorVpnStatusResponse;
  } catch (error) {
    getLogger().warn("supervisor vpn status unreachable", { error: String(error) });
    return {
      supported: false,
      hostIp: null,
      hostCountry: null,
      profiles: [],
      bridges: {},
    };
  }
}

export async function setSupervisorHomeVpn(
  env: SupervisorVpnEnv | undefined,
  homeKey: string,
  policy: { profile: string | null; locked: boolean },
): Promise<SupervisorVpnBridgeState> {
  const creds = supervisorCredentials(env);
  if (!creds) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Per-computer VPN requires the Docker supervisor",
    });
  }
  const res = await fetch(`${creds.url}/vpn/homes/${encodeURIComponent(homeKey)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${creds.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(policy),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json().catch(() => ({}))) as SupervisorVpnBridgeState & {
    error?: string;
  };
  if (!res.ok) {
    throw new ORPCError(res.status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR", {
      message: body.error ?? `Supervisor VPN update failed (${res.status})`,
    });
  }
  return body;
}

export async function reconcileAllComputerVpns(
  prisma: PrismaClient,
  env: SupervisorVpnEnv | undefined,
): Promise<void> {
  const creds = supervisorCredentials(env);
  if (!creds) return;
  try {
    const computers = await runAsSystem("vpn.reconcile", () =>
      prisma.computer.findMany({
        where: {
          OR: [{ vpnProfile: { not: null } }, { vpnLocked: true }],
        },
        select: {
          homeKey: true,
          vpnProfile: true,
          vpnLocked: true,
        },
      }),
    );
    const homes = computers.map((computer) => ({
      homeKey: computer.homeKey,
      profile: computer.vpnProfile,
      locked: computer.vpnLocked,
    }));
    const res = await fetch(`${creds.url}/vpn/reconcile`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ homes }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      getLogger().warn("initial computer VPN reconcile failed", { status: res.status });
    }
  } catch (error) {
    getLogger().warn("initial computer VPN reconcile error", { error: String(error) });
  }
}

export function buildBotVpnStatus(
  botId: string,
  computer: {
    id: string;
    scope: string;
    homeKey: string;
    state: string;
    vpnProfile: string | null;
    vpnLocked: boolean;
  },
  bridgeState: SupervisorVpnBridgeState | undefined,
  hostIp: string | null,
  hostCountry: string | null,
): BotVpnStatus {
  const computerMode: ComputerMode = computer.scope === "dedicated" ? "dedicated" : "team";
  let state: ComputerVpnRuntimeState = bridgeState?.state ?? "stopped";
  let exitIp = bridgeState?.exitIp ?? null;
  let exitCountry = bridgeState?.exitCountry ?? null;

  if (!bridgeState) {
    if (computer.state !== "running") {
      state = "stopped";
    } else if (computer.vpnProfile) {
      state = computer.vpnLocked ? "blocked" : "fallback";
      if (state === "fallback") {
        exitIp = hostIp;
        exitCountry = hostCountry;
      }
    } else {
      state = "direct";
      exitIp = hostIp;
      exitCountry = hostCountry;
    }
  }

  return {
    botId,
    computerId: computer.id,
    computerMode,
    vpnProfile: computer.vpnProfile,
    vpnLocked: computer.vpnLocked,
    state,
    exitIp,
    exitCountry,
  };
}

export function assembleVpnOverview(
  bots: Array<{
    id: string;
    computer: {
      id: string;
      scope: string;
      homeKey: string;
      state: string;
      vpnProfile: string | null;
      vpnLocked: boolean;
    } | null;
  }>,
  supervisorStatus: SupervisorVpnStatusResponse,
  spaceId: string,
): ComputerVpnOverview {
  const byBot: Record<string, BotVpnStatus> = {};
  for (const bot of bots) {
    if (!bot.computer) continue;
    const bridge = bridgeNameForHomeKey(bot.computer.homeKey);
    byBot[bot.id] = buildBotVpnStatus(
      bot.id,
      bot.computer,
      supervisorStatus.bridges[bridge],
      supervisorStatus.hostIp,
      supervisorStatus.hostCountry,
    );
  }
  return {
    supported: supervisorStatus.supported,
    killSwitchAvailable: supervisorStatus.killSwitchAvailable ?? false,
    hostIp: supervisorStatus.hostIp,
    hostCountry: supervisorStatus.hostCountry,
    profiles: visibleVpnProfiles(supervisorStatus.profiles, spaceId),
    bots: byBot,
  };
}

async function supervisorVpnCall<T>(
  env: SupervisorVpnEnv | undefined,
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
): Promise<T> {
  const creds = supervisorCredentials(env);
  if (!creds) {
    throw new VpnProfileError("BAD_REQUEST", "VPNs need bot computers on this server.");
  }
  const res = await fetch(`${creds.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 400 || res.status === 409) {
    throw new VpnProfileError(
      res.status === 409 ? "CONFLICT" : "BAD_REQUEST",
      data.error ?? "The VPN could not be changed.",
    );
  }
  if (!res.ok) throw new Error(data.error ?? `Supervisor VPN request failed (${res.status})`);
  return data;
}

/** The profile as this Space sees it, or a refusal when it is someone else's or gone. */
async function visibleProfile(
  env: SupervisorVpnEnv | undefined,
  spaceId: string,
  id: string,
): Promise<{ profile: VpnProfileInfo; owned: boolean }> {
  const status = await fetchSupervisorVpnStatus(env);
  const found = status.profiles.find((profile) => profile.id === id);
  if (!found || (found.owner && found.owner !== spaceId)) {
    throw new VpnProfileError("NOT_FOUND", "That VPN is no longer available.");
  }
  return { profile: toProfileInfo(found), owned: found.owner === spaceId };
}

export async function assertVpnProfileVisible(
  env: SupervisorVpnEnv | undefined,
  spaceId: string,
  id: string,
): Promise<void> {
  await visibleProfile(env, spaceId, id);
}

export async function addVpnProfiles(
  env: SupervisorVpnEnv | undefined,
  spaceId: string,
  input: AddVpnProfilesInput,
): Promise<AddVpnProfilesResult> {
  if (!supervisorCredentials(env)) {
    throw new VpnProfileError("BAD_REQUEST", "VPNs need bot computers on this server.");
  }
  const result: AddVpnProfilesResult = { added: [], failed: [] };
  // One at a time: each brings a tunnel up on the host.
  for (const file of input.files) {
    try {
      const added = await supervisorVpnCall<HostVpnProfile>(env, "POST", "/vpn/profiles", {
        name: file.name,
        config: file.config,
        owner: spaceId,
      });
      result.added.push(toProfileInfo({ ...added, up: false, handshakeAgeSec: null }));
    } catch (error) {
      if (!(error instanceof VpnProfileError)) {
        getLogger().warn("vpn profile upload failed", { error: String(error) });
      }
      result.failed.push({
        name: file.name,
        message:
          error instanceof VpnProfileError
            ? error.message
            : "This file could not be added. Try again.",
      });
    }
  }
  return result;
}

export async function removeVpnProfile(
  prisma: PrismaClient,
  env: SupervisorVpnEnv | undefined,
  spaceId: string,
  id: string,
): Promise<void> {
  const { owned } = await visibleProfile(env, spaceId, id);
  if (!owned) {
    throw new VpnProfileError(
      "BAD_REQUEST",
      "This VPN was added on the server, so it can only be removed there.",
    );
  }
  const users = await prisma.bot.findMany({
    where: { spaceId, archivedAt: null, computer: { vpnProfile: id } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  if (users.length > 0) {
    throw new VpnProfileError(
      "CONFLICT",
      `${users.map((bot) => bot.name).join(", ")} still ${users.length === 1 ? "uses" : "use"} this VPN. Pick another VPN for ${users.length === 1 ? "it" : "them"} first.`,
    );
  }
  await supervisorVpnCall(env, "DELETE", `/vpn/profiles/${encodeURIComponent(id)}`, {
    owner: spaceId,
  });
}

export async function testVpnProfile(
  env: SupervisorVpnEnv | undefined,
  spaceId: string,
  id: string,
): Promise<VpnTestResult> {
  await visibleProfile(env, spaceId, id);
  const tested = await supervisorVpnCall<{
    profile: HostVpnProfile;
    result: VpnTestOutcome;
    exitIp: string | null;
    exitCountry: string | null;
  }>(env, "POST", `/vpn/profiles/${encodeURIComponent(id)}/test`, {});
  return {
    profile: toProfileInfo(tested.profile),
    outcome: tested.result,
    exitIp: tested.exitIp,
    exitCountry: tested.exitCountry,
  };
}
