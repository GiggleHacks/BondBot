import type { AddVpnProfilesResult, VpnProfileInfo } from "@rakazo/contracts";
import { VPN_PROFILE_MAX_BYTES, VPN_PROFILE_UPLOAD_LIMIT } from "@rakazo/contracts";
import type { RpcClient } from "../../lib/query/rpc";

/** Reads the picked files and sends them in batches the server accepts. */
export async function uploadVpnFiles(
  picked: readonly File[],
  rpc: RpcClient,
): Promise<AddVpnProfilesResult> {
  const result: AddVpnProfilesResult = { added: [], failed: [] };
  const files: { name: string; config: string }[] = [];
  for (const file of picked) {
    if (file.size > VPN_PROFILE_MAX_BYTES) {
      result.failed.push({
        name: file.name,
        message: "This file is too big to be a WireGuard file.",
      });
      continue;
    }
    const config = await file.text();
    if (!config.trim()) {
      result.failed.push({ name: file.name, message: "This file is empty." });
      continue;
    }
    files.push({ name: file.name.slice(0, 200) || "VPN", config });
  }
  for (let start = 0; start < files.length; start += VPN_PROFILE_UPLOAD_LIMIT) {
    const batch = await rpc.computer.addVpnProfiles({
      files: files.slice(start, start + VPN_PROFILE_UPLOAD_LIMIT),
    });
    result.added.push(...batch.added);
    result.failed.push(...batch.failed);
  }
  return result;
}

/** Bot names per VPN, for "Used by" and for refusing to remove one that is in use. */
export function botsByVpnProfile(
  bots: Record<string, { vpnProfile: string | null }>,
  botNames: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const users = new Map<string, string[]>();
  for (const [botId, status] of Object.entries(bots)) {
    const name = botNames.get(botId);
    if (!status.vpnProfile || !name) continue;
    users.set(status.vpnProfile, [...(users.get(status.vpnProfile) ?? []), name]);
  }
  return users;
}

export function sortVpnProfiles(profiles: readonly VpnProfileInfo[]): VpnProfileInfo[] {
  // The Space's own uploads first, then by name so a bulk upload reads in file order.
  return [...profiles].sort(
    (a, b) => Number(a.shared) - Number(b.shared) || a.name.localeCompare(b.name),
  );
}
