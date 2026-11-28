import { describe, expect, it } from "vitest";
import { assembleVpnOverview, visibleVpnProfiles } from "./computer-vpn.js";

const hostProfile = (id: string, owner: string | null) => ({
  id,
  name: id,
  owner,
  countryCode: "JP",
  countryName: "Japan",
  serverLabel: "JP#1",
  up: true,
  handshakeAgeSec: 3,
});

describe("VPN profiles per Space", () => {
  it("shows a Space its own uploads and the operator's files, never another Space's", () => {
    const profiles = [
      hostProfile("vpn-mine", "space-a"),
      hostProfile("vpn-theirs", "space-b"),
      hostProfile("wg-jp-1", null),
    ];
    expect(visibleVpnProfiles(profiles, "space-a").map((p) => [p.id, p.shared])).toEqual([
      ["vpn-mine", false],
      ["wg-jp-1", true],
    ]);
  });

  it("carries the filtered list and the Kill Switch flag into the overview", () => {
    const overview = assembleVpnOverview(
      [],
      {
        supported: true,
        killSwitchAvailable: true,
        hostIp: null,
        hostCountry: null,
        profiles: [hostProfile("vpn-theirs", "space-b")],
        bridges: {},
      },
      "space-a",
    );
    expect(overview.profiles).toEqual([]);
    expect(overview.killSwitchAvailable).toBe(true);
  });
});
