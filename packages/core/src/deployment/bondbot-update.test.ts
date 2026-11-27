import { describe, expect, it } from "vitest";
import {
  compareBondbotSemver,
  extractLatestChangelogNotes,
  isBondbotVersionNewer,
  parseBondbotVersionFile,
} from "./bondbot-update.js";

describe("bondbot-update helpers", () => {
  it("parses web and api BondBot version exports", () => {
    expect(parseBondbotVersionFile('export const BONDBOT_VERSION = "0.4.0";\n')).toBe("0.4.0");
    expect(parseBondbotVersionFile("export const BONDBOT_API_VERSION = '1.9.0';")).toBe("1.9.0");
    expect(parseBondbotVersionFile("export const OTHER = '1.0.0';")).toBeNull();
    expect(parseBondbotVersionFile('export const BONDBOT_VERSION = "not-semver";')).toBeNull();
  });

  it("compares semantic versions properly across multi-digit components", () => {
    expect(compareBondbotSemver("0.10.0", "0.9.9")).toBe(1);
    expect(compareBondbotSemver("1.8.0", "1.9.0")).toBe(-1);
    expect(compareBondbotSemver("0.4.0", "v0.4.0")).toBe(0);
  });

  it("detects when either UI or API version is newer on GitHub", () => {
    expect(
      isBondbotVersionNewer({
        currentUiVersion: "0.3.0",
        currentApiVersion: "1.8.0",
        latestUiVersion: "0.4.0",
        latestApiVersion: "1.8.0",
      }),
    ).toBe(true);
    expect(
      isBondbotVersionNewer({
        currentUiVersion: "0.3.0",
        currentApiVersion: "1.8.0",
        latestUiVersion: "0.3.0",
        latestApiVersion: "1.9.0",
      }),
    ).toBe(true);
    expect(
      isBondbotVersionNewer({
        currentUiVersion: "0.4.0",
        currentApiVersion: "1.9.0",
        latestUiVersion: "0.3.0",
        latestApiVersion: "1.8.0",
      }),
    ).toBe(false);
  });

  it("extracts matching or latest changelog section body", () => {
    const changelog = [
      "# BondBot Changelog",
      "",
      "## v0.3.0 / 1.8.0 (2026-11-26)",
      "- Multiview screens",
      "",
      "## v0.4.0 / 1.9.0 (2026-11-27)",
      "",
      "### Added",
      "- One-click updater in sidebar",
    ].join("\n");

    expect(extractLatestChangelogNotes(changelog, "0.4.0")).toContain("One-click updater");
    expect(extractLatestChangelogNotes(changelog, "0.3.0")).toBe("- Multiview screens");
    expect(extractLatestChangelogNotes(changelog)).toContain("One-click updater");
  });
});
