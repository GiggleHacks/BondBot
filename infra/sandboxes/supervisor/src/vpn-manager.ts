import { existsSync } from "node:fs";
import http from "node:http";
import { computerBridgeNameFor } from "./computer-spec.js";

export interface HostVpnProfile {
  id: string;
  name?: string;
  /** The Space that uploaded the file; absent for files the operator put on the host. */
  owner?: string | null;
  countryCode: string;
  countryName: string;
  serverLabel: string;
  iface: string;
  up: boolean;
  handshakeAgeSec: number | null;
  endpoint?: string | null;
}

export interface HostVpnBridgeState {
  bridge: string;
  profile: string | null;
  locked: boolean;
  running: boolean;
  containerName: string | null;
  state: "direct" | "vpn" | "fallback" | "blocked" | "stopped";
  exitIp: string | null;
  exitCountry: string | null;
  probedAt: number | null;
}

export interface HostVpnStatusResponse {
  supported: boolean;
  /** Whether a computer can be locked to its VPN (it needs SANDBOX_COMPUTER_DNS). */
  killSwitchAvailable?: boolean;
  hostIp: string | null;
  hostCountry: string | null;
  profiles: HostVpnProfile[];
  bridges: Record<string, HostVpnBridgeState>;
}

const DEFAULT_VPN_SOCK = "/var/run/rakazo-vpn/vpn.sock";

export function vpnSocketPath(): string | undefined {
  const configured = (process.env.RAKAZO_VPN_SOCK ?? "").trim();
  const target = configured || DEFAULT_VPN_SOCK;
  return existsSync(target) ? target : undefined;
}

function requestUnixJson<T>(
  socketPath: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 12_000,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          try {
            const parsed = text ? (JSON.parse(text) as T) : ({} as T);
            resolve({ status: res.statusCode ?? 500, data: parsed });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("VPN manager request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function fetchHostVpnStatus(): Promise<HostVpnStatusResponse> {
  const socketPath = vpnSocketPath();
  if (!socketPath) {
    return {
      supported: false,
      hostIp: null,
      hostCountry: null,
      profiles: [],
      bridges: {},
    };
  }
  const { status, data } = await requestUnixJson<Omit<HostVpnStatusResponse, "supported">>(
    socketPath,
    "GET",
    "/status",
  );
  if (status < 200 || status >= 300) {
    throw new Error(`VPN status failed (${status})`);
  }
  return {
    supported: true,
    hostIp: data.hostIp ?? null,
    hostCountry: data.hostCountry ?? null,
    profiles: data.profiles ?? [],
    bridges: data.bridges ?? {},
  };
}

export async function setHomeVpnPolicy(
  homeKey: string,
  policy: { profile: string | null; locked: boolean },
): Promise<HostVpnBridgeState> {
  const socketPath = vpnSocketPath();
  if (!socketPath) {
    throw new Error("Host VPN manager is not configured");
  }
  const bridge = computerBridgeNameFor(homeKey);
  const { status, data } = await requestUnixJson<HostVpnBridgeState & { error?: string }>(
    socketPath,
    "PUT",
    `/bridges/${encodeURIComponent(bridge)}`,
    policy,
  );
  if (status < 200 || status >= 300) {
    throw new Error(data.error ?? `VPN update failed (${status})`);
  }
  return data;
}

export async function reconcileHomeVpnPolicies(
  homes: Array<{ homeKey: string; profile: string | null; locked: boolean }>,
): Promise<HostVpnStatusResponse> {
  const socketPath = vpnSocketPath();
  if (!socketPath) {
    return {
      supported: false,
      hostIp: null,
      hostCountry: null,
      profiles: [],
      bridges: {},
    };
  }
  const bridges: Record<string, { profile: string | null; locked: boolean }> = {};
  for (const home of homes) {
    if (home.profile || home.locked) {
      bridges[computerBridgeNameFor(home.homeKey)] = {
        profile: home.profile,
        locked: home.locked,
      };
    }
  }
  const { status, data } = await requestUnixJson<
    Omit<HostVpnStatusResponse, "supported"> & { error?: string }
  >(socketPath, "POST", "/reconcile", { bridges });
  if (status < 200 || status >= 300) {
    throw new Error(data.error ?? `VPN reconcile failed (${status})`);
  }
  return {
    supported: true,
    hostIp: data.hostIp ?? null,
    hostCountry: data.hostCountry ?? null,
    profiles: data.profiles ?? [],
    bridges: data.bridges ?? {},
  };
}

export interface HostVpnTestResult {
  profile: HostVpnProfile;
  result: "connected" | "no_handshake" | "no_internet" | "not_private";
  exitIp: string | null;
  exitCountry: string | null;
  latencyMs?: number | null;
}

/** A refusal from the VPN manager, with the status it answered (400 bad file, 409 in use). */
export class HostVpnError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function hostVpnCall<T>(
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const socketPath = vpnSocketPath();
  if (!socketPath) throw new HostVpnError(503, "Host VPN manager is not configured");
  const { status, data } = await requestUnixJson<T & { error?: string }>(
    socketPath,
    method,
    path,
    body,
    timeoutMs,
  );
  if (status < 200 || status >= 300) {
    throw new HostVpnError(status, data.error ?? `VPN manager answered ${status}`);
  }
  return data;
}

export function addHostVpnProfile(input: {
  name: string;
  config: string;
  owner: string;
}): Promise<HostVpnProfile> {
  return hostVpnCall("POST", "/profiles", input, 30_000);
}

export async function removeHostVpnProfile(id: string, owner: string): Promise<void> {
  await hostVpnCall("DELETE", `/profiles/${encodeURIComponent(id)}`, { owner }, 20_000);
}

export function testHostVpnProfile(id: string): Promise<HostVpnTestResult> {
  // One request through the tunnel (8 s), plus bringing it up and the host's own address.
  return hostVpnCall("POST", `/profiles/${encodeURIComponent(id)}/test`, {}, 30_000);
}
