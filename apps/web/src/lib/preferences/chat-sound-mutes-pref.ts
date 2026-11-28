import { createStoredPreference } from "./stored-preference";

/** The kinds of chat sound a person can silence on this device, under the account's own switch. */
export const CHAT_SOUND_KINDS = ["sent", "thinking", "tools", "alerts"] as const;
export type ChatSoundKind = (typeof CHAT_SOUND_KINDS)[number];

export const mutedChatSoundsPreference = createStoredPreference<readonly ChatSoundKind[]>({
  key: "bondbot.mutedChatSounds",
  parse: (raw) => CHAT_SOUND_KINDS.filter((kind) => raw?.split(",").includes(kind)),
  serialize: (muted) => (muted.length ? muted.join(",") : null),
});

export function setChatSoundMuted(kind: ChatSoundKind, muted: boolean): void {
  const others = mutedChatSoundsPreference.get().filter((other) => other !== kind);
  mutedChatSoundsPreference.set(muted ? [...others, kind] : others);
}
