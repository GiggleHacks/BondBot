import type { VpnProfileInfo } from "@rakazo/contracts";

/** "UN" until a test learns where an uploaded file comes out. */
export const UNKNOWN_COUNTRY = "UN";

let regionNames: Intl.DisplayNames | null | undefined;

/** The country's English name, or the code when the browser has no names for regions. */
export function countryNameFor(code: string | null | undefined): string {
  const cc = (code ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === UNKNOWN_COUNTRY) return "Unknown country";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** What a VPN is called in pickers: its country and server, or its file name before a test. */
export function vpnProfileLabel(profile: VpnProfileInfo): string {
  if (profile.countryCode.toUpperCase() === UNKNOWN_COUNTRY) return profile.name;
  const country = countryNameFor(profile.countryCode);
  return profile.serverLabel && profile.serverLabel !== profile.name
    ? `${country} (${profile.serverLabel})`
    : country;
}
