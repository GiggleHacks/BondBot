import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type {
  BotVpnStatus,
  ComputerMode,
  ComputerVpnOverview,
  ComputerVpnRuntimeState,
  VpnProfileInfo,
} from "@rakazo/contracts";
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

interface SupervisorVpnStatusResponse {
  supported: boolean;
  hostIp: string | null;
  hostCountry: string | null;
  profiles: VpnProfileInfo[];
  bridges: Record<string, SupervisorVpnBridgeState>;
}

export function bridgeNameForHomeKey(homeKey: string): string {
  const hash = createHash("sha256").update(homeKey).digest("hex").slice(0, 7);
  return `rakazo-c${hash}`;
}

function supervisorCredentials(env: SupervisorVpnEnv | undefined): { url: string; token: string } | undefined {
  if (!env || env.sandboxProvider !== "docker" || !env.sandboxSupervisorToken || !env.sandboxSupervisorUrl) {
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
    throw new ORPCError("BAD_REQUEST", { message: "Per-computer VPN requires the Docker supervisor" });
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
  const body = (await res.json().catch(() => ({}))) as SupervisorVpnBridgeState & { error?: string };
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
    hostIp: supervisorStatus.hostIp,
    hostCountry: supervisorStatus.hostCountry,
    profiles: supervisorStatus.profiles,
    bots: byBot,
  };
}
