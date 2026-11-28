import { expect, it } from "vitest";
import { isMac } from "./desktop-download";

const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

it.each([
  ["a Mac", SAFARI, 0, true],
  ["an iPad sending the desktop agent", SAFARI, 5, false],
  ["an iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, false],
])("recognizes %s", (_, agent, touchPoints, expected) => {
  expect(isMac(agent, touchPoints)).toBe(expected);
});
