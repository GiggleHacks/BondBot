import { expect, it } from "vitest";
import { usageText } from "./bot-usage-line";

it("reads memory in gigabytes against the computer's limit", () => {
  expect(
    usageText({ memoryBytes: 1.24 * 1024 ** 3, memoryLimitBytes: 4 * 1024 ** 3, cpuPercent: 8 }),
  ).toBe("1.2 of 4 GB memory, 8% CPU");
});
