import { expect, it } from "vitest";
import { usageReadings } from "./bot-usage-line";

it("gives short RAM and CPU readings, coloured by how full they are", () => {
  expect(
    usageReadings({ memoryBytes: 3.6 * 1024 ** 3, memoryLimitBytes: 4 * 1024 ** 3, cpuPercent: 8 }),
  ).toEqual([
    { label: "RAM", value: "3.6 GB", tone: "text-destructive" },
    { label: "CPU", value: "8%", tone: "text-success" },
  ]);
});
