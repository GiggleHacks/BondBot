import { expect, it } from "vitest";
import { asciiGrid, glyphRamp, quantizePalette, SPACE } from "./robot-ascii";

function pixels(colors: [number, number, number][]) {
  return Uint8ClampedArray.from(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}

it("orders the ramp from space to the densest glyph", () => {
  const coverage = new Float32Array(128);
  coverage[46] = 0.1; // .
  coverage[35] = 0.6; // #
  coverage[64] = 0.8; // @
  expect(glyphRamp(coverage, 4)).toEqual([SPACE, 46, 35, 64]);
});

it("leaves black empty, draws bright cells densest and marks red as glow", () => {
  const ramp = [SPACE, 46, 35, 64];
  const grid = asciiGrid(
    pixels([
      [0, 0, 0],
      [220, 220, 220],
      [240, 20, 20],
    ]),
    3,
    1,
    ramp,
  );
  expect(grid.glyph[0]).toBe(SPACE);
  expect(grid.glyph[1]).toBe(64);
  expect(grid.glow[2]).toBe(1);
  expect(grid.glow[1]).toBe(0);
});

it("keeps a rare saturated accent in the palette next to many greys", () => {
  const greys = Array.from({ length: 40 }, (_, i) => [i * 6, i * 6, i * 6] as const);
  const palette = quantizePalette([...greys, [230, 20, 20]], 8);
  expect(palette).toHaveLength(8);
  expect(palette.some(([r, g]) => r > 200 && g < 60)).toBe(true);
});
