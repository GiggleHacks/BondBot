import { createStoredPreference } from "./stored-preference";

/** Read by public/theme.js too, so a reload paints in the chosen style from the start. */
function stylePreference(key: string, attribute: "chatColors" | "terminalFont") {
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
export const terminalFontPreference = stylePreference("bondbot.terminalFont", "terminalFont");
