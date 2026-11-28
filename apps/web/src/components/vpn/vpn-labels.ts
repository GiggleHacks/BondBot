import type { VpnProfileInfo, VpnTestResult } from "@rakazo/contracts";

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

/** One sentence on a connection test, saying what to do when it failed. */
export function vpnTestMessage(result: VpnTestResult): string {
  switch (result.outcome) {
    case "connected":
      return `Working. Bots on it appear to be in ${countryNameFor(result.exitCountry ?? result.profile.countryCode)}${result.exitIp ? ` (${result.exitIp})` : ""}.`;
    case "no_handshake":
      return "The VPN server did not answer. This file may be old or deleted. Make a new one and upload it.";
    case "no_internet":
      return "The VPN server answered, but nothing got through it. Try again later or use another server.";
    case "not_private":
      return "Traffic did not go through the VPN, so it is not hiding anything. Try another file.";
  }
}
