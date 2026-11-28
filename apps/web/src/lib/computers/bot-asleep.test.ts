import { expect, it } from "vitest";
import { isBotAsleep } from "./bot-asleep";

it.each([
  [true, "idle", undefined, true],
  [true, "running", undefined, false],
  [true, "idle", "booting", false],
  [false, "idle", undefined, false],
] as const)(
  "computer asleep %s, bot %s, live %s draws asleep: %s",
  (computerAsleep, status, live, asleep) => {
    expect(isBotAsleep({ computerAsleep, status }, live)).toBe(asleep);
  },
);
