import { describe, expect, it } from "vitest";
import { idleTicks, nextVariant, planTicks } from "./tick-plan";

const still = () => 0;
const jumpy = () => 1;

describe("planTicks", () => {
  it("ticks more for a bigger chunk of text", () => {
    const small = planTicks(10, 1, idleTicks, still);
    const big = planTicks(60, 1, idleTicks, still);
    expect(small.times).toHaveLength(1);
    expect(big.times.length).toBeGreaterThan(small.times.length);
  });

  it("keeps a flood of text to a patter, never closer than the minimum gap", () => {
    let state = idleTicks;
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const planned = planTicks(400, 1 + i * 0.01, state, still);
      state = planned.state;
      times.push(...planned.times);
    }
    const gaps = times.slice(1).map((at, i) => at - (times[i] ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.07 - 1e-9);
    expect(Math.max(...times)).toBeLessThanOrEqual(1.19 + 0.45);
  });

  it("holds the minimum gap even when the jitter pulls ticks together", () => {
    const first = planTicks(12, 1, idleTicks, jumpy);
    const next = planTicks(72, 1.01, first.state, still);
    const times = [...first.times, ...next.times];
    const gaps = times.slice(1).map((at, i) => at - (times[i] ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.07 - 1e-9);
  });

  it("goes quiet soon after the text stops", () => {
    const planned = planTicks(400, 5, idleTicks, still);
    expect(Math.max(...planned.times)).toBeLessThanOrEqual(5.45);
  });

  it("makes no sound for an empty chunk", () => {
    expect(planTicks(0, 1, idleTicks, still)).toEqual({ times: [], state: idleTicks });
  });
});

it("never picks the version just played", () => {
  for (const random of [0, 0.5, 0.999]) {
    for (let last = 0; last < 4; last += 1) {
      const next = nextVariant(4, last, () => random);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(4);
    }
  }
});
