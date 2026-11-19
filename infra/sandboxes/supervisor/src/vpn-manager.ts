import { existsSync } from "node:fs";
import http from "node:http";
import { computerBridgeNameFor } from "./computer-spec.js";

export interface HostVpnProfile {
  id: string;
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
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path,
        method,
        timeout: 12_000,
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
  const { status, data } = await requestUnixJson<Omit<HostVpnStatusResponse, "supported"> & { error?: string }>(
    socketPath,
    "POST",
    "/reconcile",
    { bridges },
  );
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
