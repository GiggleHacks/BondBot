import { BOT_AVATAR_VALUE_MAX_LENGTH, isDataImageUrl } from "../bots/bot-avatar.js";

/**
 * True for a value the account photo may hold: nothing, an https image a sign-in provider
 * supplied, or an uploaded image small enough to ride along with every session read.
 */
export function isUserImageValue(raw: string | null | undefined): boolean {
  if (raw == null || raw === "") return true;
  if (raw.length > BOT_AVATAR_VALUE_MAX_LENGTH) return false;
  if (raw.startsWith("data:")) return isDataImageUrl(raw);
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
