import type { VpnProfileInfo } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { vpnProfileLabel, vpnTestMessage } from "./vpn-labels";

const profile: VpnProfileInfo = {
  id: "vpn-0123456789ab",
  name: "office",
  countryCode: "UN",
  countryName: "UN",
  serverLabel: "office",
  up: false,
  handshakeAgeSec: null,
  shared: false,
};

describe("vpn labels", () => {
  it("names a file by its country once known, and by its file name before", () => {
    expect(vpnProfileLabel(profile)).toBe("office");
    expect(vpnProfileLabel({ ...profile, countryCode: "JP", serverLabel: "JP#412" })).toBe(
      "Japan (JP#412)",
    );
    expect(vpnProfileLabel({ ...profile, countryCode: "DE" })).toBe("Germany");
  });

  it("says where a working VPN comes out", () => {
    expect(
      vpnTestMessage({ profile, outcome: "connected", exitIp: "203.0.113.5", exitCountry: "NL" }),
    ).toBe("Working. Bots on it appear to be in Netherlands (203.0.113.5).");
  });
});
