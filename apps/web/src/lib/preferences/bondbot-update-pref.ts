import { createStoredPreference } from "./stored-preference";

export const BONDBOT_SKIPPED_VERSION_KEY = "rakazo.bondbotSkippedVersion";

function normalizeVersion(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().replace(/^v/i, "");
  return trimmed || null;
}

export const bondbotSkippedVersionPreference = createStoredPreference<string | null>({
  key: BONDBOT_SKIPPED_VERSION_KEY,
  parse: normalizeVersion,
  serialize: normalizeVersion,
});
