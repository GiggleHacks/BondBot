import { createStoredPreference } from "./stored-preference";

/** Whether the workspace is currently showing the multi-computer grid instead of a single chat. */
export const multiviewOpenPreference = createStoredPreference<boolean>({
  key: "bondbot.multiviewOpen",
  parse: (raw) => raw === "on",
  serialize: (on) => (on ? "on" : "off"),
});
