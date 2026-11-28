import type { Bot, ComputerStatus } from "@rakazo/contracts";

export const ASLEEP_LABEL = "Computer asleep";
export const ASLEEP_AVATAR_CLASS = "opacity-50 grayscale";

/**
 * Whether to draw a bot as asleep: its computer is off and it is not working. A live computer
 * state, where the screen has one, wakes it before the roster has been read again.
 */
export function isBotAsleep(
  bot: Pick<Bot, "computerAsleep" | "status">,
  liveState?: ComputerStatus["state"],
): boolean {
  if (liveState === "running" || liveState === "booting") return false;
  return bot.computerAsleep === true && bot.status === "idle";
}
