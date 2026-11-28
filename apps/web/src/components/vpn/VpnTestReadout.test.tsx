import type { VpnTestResult } from "@rakazo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VpnTestReadout } from "./VpnTestReadout";

const result: VpnTestResult = {
  profile: {
    id: "vpn-0123456789",
    name: "office",
    countryCode: "NL",
    countryName: "Netherlands",
    serverLabel: "office",
    up: true,
    handshakeAgeSec: 1,
    shared: false,
  },
  outcome: "connected",
  exitIp: "203.0.113.5",
  exitCountry: "NL",
  latencyMs: 42,
};

const text = (shown: VpnTestResult) =>
  renderToStaticMarkup(
    <VpnTestReadout test={{ pending: false, errored: false, result: shown }} />,
  ).replace(/<[^>]+>/g, "|");

describe("VpnTestReadout", () => {
  it("shows ping and IP address, or a few words when it failed", () => {
    expect(text(result).split("|").filter(Boolean)).toEqual(["42 ms", "203.0.113.5"]);
    expect(
      text({ ...result, outcome: "no_handshake", exitIp: null, latencyMs: null })
        .split("|")
        .filter(Boolean),
    ).toEqual(["No response"]);
  });
});
