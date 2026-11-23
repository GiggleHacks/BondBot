import { createStoredPreference } from "./stored-preference";

export const MODEL_GLOW_STORAGE_KEY = "rakazo.modelGlow";

/** Default on: only a saved "off" hides the faint colour around the chat. */
export const modelGlowPreference = createStoredPreference<boolean>({
  key: MODEL_GLOW_STORAGE_KEY,
  parse: (raw) => raw?.trim().toLowerCase() !== "off",
  serialize: (enabled) => (enabled ? "on" : "off"),
});
