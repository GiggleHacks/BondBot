// Turns a picture into a grid of Quake console glyphs with a small SNES-style palette.
// Pure functions over pixel arrays, so the canvas code stays thin and this stays testable.

export type Rgb = readonly [number, number, number];

export type AsciiGrid = {
  cols: number;
  rows: number;
  /** Glyph code per cell; 32 (space) for an empty cell. */
  glyph: Uint8Array;
  /** Palette index per cell. */
  color: Uint8Array;
  /** 1 where the picture glows (the eyes), for the idle pulse. */
  glow: Uint8Array;
  palette: Rgb[];
};

export const SPACE = 32;

/**
 * Ink coverage of each printable glyph (33-126) in a 128x128 glyph sheet of 8x8 cells, from its
 * alpha channel. Index is the glyph code.
 */
export function glyphCoverage(sheetAlpha: (index: number) => number): Float32Array {
  const coverage = new Float32Array(128);
  for (let code = 33; code < 127; code++) {
    const x0 = (code & 15) * 8;
    const y0 = (code >> 4) * 8;
    let ink = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) ink += sheetAlpha((y0 + y) * 128 + x0 + x) > 127 ? 1 : 0;
    }
    coverage[code] = ink / 64;
  }
  return coverage;
}

/** Glyph codes from sparsest to densest, `steps` long, starting with a space. */
export function glyphRamp(coverage: Float32Array, steps = 14): number[] {
  const codes: number[] = [];
  for (let code = 33; code < 127; code++) if (coverage[code]! > 0) codes.push(code);
  codes.sort((a, b) => coverage[a]! - coverage[b]!);
  if (codes.length === 0) return [SPACE];
  const ramp = [SPACE];
  for (let i = 0; i < steps - 1; i++) {
    ramp.push(codes[Math.round((i / Math.max(1, steps - 2)) * (codes.length - 1))]!);
  }
  return ramp;
}

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A glowing eye: a strongly red or strongly blue pixel. */
function isGlow(r: number, g: number, b: number) {
  return (r > 90 && r > g * 1.8 && r > b * 1.8) || (b > 110 && b > r * 1.8 && b > g * 1.2);
}

/**
 * The cell's hue at a brightness that follows its level, so highlights stand out against the
 * shadows while even the darkest inked glyph stays visible on black.
 */
function shaded(r: number, g: number, b: number, level: number): Rgb {
  const peak = Math.max(r, g, b, 1);
  const k = (235 * (0.3 + 0.7 * level)) / peak;
  return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
}

/** Snaps a channel to the SNES's 5 bits. */
function snes(channel: number) {
  return Math.round(channel / 8.226) * 8.226;
}

function bin(color: Rgb) {
  return (
    (Math.round(snes(color[0]) / 8.226) << 10) |
    (Math.round(snes(color[1]) / 8.226) << 5) |
    Math.round(snes(color[2]) / 8.226)
  );
}

function unbin(key: number): Rgb {
  return [
    Math.round(((key >> 10) & 31) * 8.226),
    Math.round(((key >> 5) & 31) * 8.226),
    Math.round((key & 31) * 8.226),
  ];
}

function saturation([r, g, b]: Rgb) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * Up to `size` colors: the most common 5-bit colors, plus the most common saturated ones so a
 * small bright accent (red eyes) survives next to a large grey subject.
 */
export function quantizePalette(colors: readonly Rgb[], size = 16): Rgb[] {
  const counts = new Map<number, number>();
  for (const color of colors) {
    const key = bin(color);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const saturated = byCount.filter((key) => saturation(unbin(key)) > 0.5).slice(0, 4);
  const picked = new Set<number>(saturated);
  for (const key of byCount) {
    if (picked.size >= size) break;
    picked.add(key);
  }
  return [...picked].map(unbin);
}

function nearest(palette: readonly Rgb[], color: Rgb) {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const distance = (p[0] - color[0]) ** 2 + (p[1] - color[1]) ** 2 + (p[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * One glyph per pixel of `rgba` (already scaled to cols x rows). Brightness picks the glyph's
 * density, normalized to the picture's own highlights so a dark image still fills the ramp.
 */
export function asciiGrid(
  rgba: Uint8ClampedArray,
  cols: number,
  rows: number,
  ramp: readonly number[],
): AsciiGrid {
  const count = cols * rows;
  const lum = new Float32Array(count);
  for (let i = 0; i < count; i++)
    lum[i] = luminance(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);
  const sorted = Float32Array.from(lum).sort();
  const highlight = Math.max(0.05, sorted[Math.floor((count - 1) * 0.99)] ?? 1);

  const glyph = new Uint8Array(count).fill(SPACE);
  const glow = new Uint8Array(count);
  const cellColors: Rgb[] = new Array(count);
  const inked: Rgb[] = [];
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const level = Math.min(1, lum[i]! / highlight) ** 0.8;
    const step = Math.floor(level * (ramp.length - 1) + 0.15);
    const color = shaded(r, g, b, level);
    cellColors[i] = color;
    if (isGlow(r, g, b)) glow[i] = 1;
    if (step <= 0 && !glow[i]) continue;
    glyph[i] = ramp[Math.max(1, Math.min(ramp.length - 1, step))]!;
    inked.push(color);
  }
  const palette = quantizePalette(inked.length ? inked : [[200, 200, 200]]);
  const color = new Uint8Array(count);
  for (let i = 0; i < count; i++) color[i] = nearest(palette, cellColors[i]!);
  return { cols, rows, glyph, color, glow, palette };
}
