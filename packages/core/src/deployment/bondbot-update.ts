/** Public GitHub repository and branch that BondBot deployments track. */
export const BONDBOT_GITHUB_OWNER = "GiggleHacks";
export const BONDBOT_GITHUB_REPO = "BondBot";
export const BONDBOT_GITHUB_BRANCH = "main";
export const BONDBOT_REPO_URL = `https://github.com/${BONDBOT_GITHUB_OWNER}/${BONDBOT_GITHUB_REPO}`;
export const BONDBOT_GIT_URL = `${BONDBOT_REPO_URL}.git`;

const VERSION_EXPORT = /BONDBOT(?:_API)?_VERSION\s*=\s*["']([^"']+)["']/;
const SEMVER_PARTS = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
const CHANGELOG_HEADING = /^##\s+([^\n]+)$/m;

/** Extract `BONDBOT_VERSION` or `BONDBOT_API_VERSION` from a version module source string. */
export function parseBondbotVersionFile(source: string): string | null {
  const match = VERSION_EXPORT.exec(source);
  const raw = match?.[1]?.trim();
  if (!raw || !SEMVER_PARTS.test(raw)) return null;
  return raw.replace(/^v/i, "");
}

/** Compare two semantic versions (`major.minor.patch`); returns -1, 0, or 1. */
export function compareBondbotSemver(left: string, right: string): number {
  const a = parseSemverTuple(left);
  const b = parseSemverTuple(right);
  if (!a || !b) return left.localeCompare(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! > b[i]!) return 1;
    if (a[i]! < b[i]!) return -1;
  }
  return 0;
}

function parseSemverTuple(raw: string): [number, number, number] | null {
  const match = SEMVER_PARTS.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Determine whether remote versions on GitHub are newer than the currently running build. */
export function isBondbotVersionNewer(input: {
  currentUiVersion: string;
  currentApiVersion: string;
  latestUiVersion: string | null;
  latestApiVersion: string | null;
}): boolean {
  if (
    input.latestUiVersion &&
    compareBondbotSemver(input.latestUiVersion, input.currentUiVersion) > 0
  ) {
    return true;
  }
  if (
    input.latestApiVersion &&
    compareBondbotSemver(input.latestApiVersion, input.currentApiVersion) > 0
  ) {
    return true;
  }
  return false;
}

/** Extract concise release notes for the matching or latest version section in CHANGELOG-BONDBOT.md. */
export function extractLatestChangelogNotes(
  markdown: string,
  version?: string | null,
): string | null {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const matches = [...normalized.matchAll(new RegExp(CHANGELOG_HEADING.source, "gm"))];
  if (matches.length === 0) return null;

  const cleanVersion = version?.trim().replace(/^v/i, "");
  const versionPattern = cleanVersion
    ? new RegExp(`(?:^|[^0-9.])v?${cleanVersion.replace(/\./g, "\\.")}(?:$|[^0-9.])`)
    : null;
  const targetMatch =
    (versionPattern
      ? matches.find(
          (m) => versionPattern.test(m[1] ?? "") && !/^deployed\s+to\b/i.test(m[1] ?? ""),
        )
      : undefined) ?? matches[matches.length - 1];
  if (!targetMatch || targetMatch.index === undefined) return null;

  const afterHeader = normalized.indexOf("\n", targetMatch.index);
  if (afterHeader < 0) return null;
  const nextIndex =
    matches.find((m) => (m.index ?? -1) > targetMatch.index!)?.index ?? normalized.length;
  const body = normalized.slice(afterHeader + 1, nextIndex).trim();
  if (!body) return null;
  return body.length > 1500 ? `${body.slice(0, 1497)}...` : body;
}
