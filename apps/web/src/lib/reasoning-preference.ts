import { createStoredPreference } from "./stored-preference";

export const REASONING_STORAGE_KEY = "rakazo.showReasoning";

/** Default on: only a saved "off" hides the reasoning under bot replies. */
export function normalizeReasoningEnabled(raw: string | null | undefined): boolean {
  return raw?.trim().toLowerCase() !== "off";
}

export const reasoningPreference = createStoredPreference({
  key: REASONING_STORAGE_KEY,
  parse: normalizeReasoningEnabled,
  serialize: (enabled) => (enabled ? "on" : "off"),
});
