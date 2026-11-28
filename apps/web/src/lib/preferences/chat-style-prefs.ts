import { bestEffort } from "@rakazo/logging/best-effort";
import { createStoredPreference } from "./stored-preference";

/** Read by public/theme.js too, so a reload paints in the chosen style from the start. */
function stylePreference(key: string, attribute: "chatColors") {
  const preference = createStoredPreference<boolean>({
    key,
    parse: (raw) => raw === "on",
    serialize: (enabled) => (enabled ? "on" : null),
  });
  const apply = () => {
    if (typeof document === "undefined") return;
    if (preference.get()) document.documentElement.dataset[attribute] = "on";
    else delete document.documentElement.dataset[attribute];
  };
  preference.subscribe(apply);
  return preference;
}

/** Off by default: the app stays monochrome unless someone asks for colour. */
export const chatColorsPreference = stylePreference("bondbot.chatColors", "chatColors");

/** Each typeface ships with the app and downloads only once someone picks it. */
const FONT_FACES = {
  inter: () => import("@fontsource-variable/inter"),
  geist: () => import("@fontsource-variable/geist"),
  serif: () => import("@fontsource-variable/source-serif-4"),
  rounded: () => import("@fontsource-variable/nunito"),
  mono: () => import("@fontsource-variable/jetbrains-mono"),
} as const;

export type AppFont = "system" | keyof typeof FONT_FACES;

export const APP_FONTS: readonly AppFont[] = ["system", ...(Object.keys(FONT_FACES) as AppFont[])];

function isAppFont(value: string | null): value is AppFont {
  return APP_FONTS.includes(value as AppFont);
}

export const appFontPreference = createStoredPreference<AppFont>({
  key: "bondbot.font",
  parse: (raw) => (isAppFont(raw) ? raw : "system"),
  serialize: (font) => (font === "system" ? null : font),
});

/** Sets `data-font` (which chat-style.css reads) and loads the chosen typeface. */
export function applyAppFont(): void {
  if (typeof document === "undefined") return;
  const font = appFontPreference.get();
  if (font === "system") {
    delete document.documentElement.dataset.font;
    return;
  }
  document.documentElement.dataset.font = font;
  void bestEffort(`load ${font} font`, FONT_FACES[font]());
}

appFontPreference.subscribe(applyAppFont);
