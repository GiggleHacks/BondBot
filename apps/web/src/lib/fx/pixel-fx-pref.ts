import { createStoredPreference } from "../preferences/stored-preference";

/** Read by public/theme.js too, before first paint. */
export const PIXEL_FX_STORAGE_KEY = "bondbot.pixelFx";

/** Default on: only a saved "off" turns off the pixel cursor trail and hover effects. */
export const pixelFxPreference = createStoredPreference<boolean>({
  key: PIXEL_FX_STORAGE_KEY,
  parse: (raw) => raw?.trim().toLowerCase() !== "off",
  serialize: (enabled) => (enabled ? "on" : "off"),
});
