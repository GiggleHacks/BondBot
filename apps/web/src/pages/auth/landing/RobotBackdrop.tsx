import { bestEffort } from "@rakazo/logging/best-effort";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type { AsciiGrid } from "./robot-ascii";
import { asciiGrid, glyphCoverage, glyphRamp, SPACE } from "./robot-ascii";

// Local addition (BondBot): the BondBot robot filling the landing, drawn with Quake console glyphs
// in an SNES-style palette. The screen first fills with faint scrambling code; then, from the eyes
// outward, the code scrambles brighter and settles into the robot while the rest dissolves. Idle,
// a band of him now and then breaks back into code and re-forms, and a rare glyph glitches.
// Every glyph is one drawImage from a pre-tinted glyph sheet. Settled glyphs live on a static
// layer and the faint code on its own layer, of which only a slice changes per frame, so a frame
// is two blits plus the few hundred glyphs that move.

const SHEET = "/brand/conchars.png";
const ROBOT = "/brand/bondbot-landing-robot.webp";
const CELL = 4;
/** The head inside the robot picture, as fractions of its width and height. */
/** Settled pixels keep the picture's own colors, with more contrast and a little darker. */
const SETTLED_CONTRAST = 1.55;
const SETTLED_MIDPOINT = 0.4;
const SETTLED_BRIGHTNESS = 0.88;

/** One color channel (0-255) with the settled contrast and brightness applied. */
function settledChannel(value: number) {
  const stretched = (value / 255 - SETTLED_MIDPOINT) * SETTLED_CONTRAST + SETTLED_MIDPOINT;
  return Math.round(Math.min(1, Math.max(0, stretched)) * 255 * SETTLED_BRIGHTNESS);
}
const HEAD_CROP = { x: 0.31, y: 0.03, width: 0.38, height: 0.88 };
/** Faint code fills in over this long. */
const FILL_SPAN = 500;
/** Then the robot forms outward from the eyes over this long. */
const RESOLVE_START = 350;
const RESOLVE_SPAN = 2000;
const RESOLVE_JITTER = 350;
/** A glyph scrambles in its final color for this long before it settles. */
const SCRAMBLE = 350;
const INTRO_END = RESOLVE_START + RESOLVE_SPAN + RESOLVE_JITTER + SCRAMBLE;
/** Share of the faint code that changes glyph each frame. */
const CODE_CHURN = 0.06;
/** Share of empty cells that hold faint code before the robot forms. */
const CODE_DENSITY = 0.4;
const WAVE_EVERY = 6000;
const WAVE_ROWS_PER_SECOND = 110;
const WAVE_HEIGHT = 3;
const CODE_DIM = [92, 98, 108] as const;
/** The eyes, drawn in one steady blue so they read from across the room. */
const EYE_BLUE = [70, 160, 255] as const;
const NOISE_CODES = [..."0123456789ABCDEFHKLMNRTXZ@#$%&*+=<>/\\"].map((ch) => ch.charCodeAt(0));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** The glyph sheet recolored to one solid color. */
function tintedSheet(sheet: HTMLImageElement, [r, g, b]: readonly number[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(sheet, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = `rgb(${r} ${g} ${b})`;
  ctx.fillRect(0, 0, 128, 128);
  return canvas;
}

function sheetAlpha(sheet: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return () => 0;
  ctx.drawImage(sheet, 0, 0);
  const data = ctx.getImageData(0, 0, 128, 128).data;
  return (index: number) => data[index * 4 + 3] ?? 0;
}

/**
 * The robot's head scaled to fill `slot` (in cells), centered across the width, one pixel per
 * glyph. The picture's own black background surrounds it.
 */
function sampleRobot(
  robot: HTMLImageElement,
  cols: number,
  rows: number,
  slot: { top: number; height: number },
) {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(cols * rows * 4);
  const sw = robot.width * HEAD_CROP.width;
  const sh = robot.height * HEAD_CROP.height;
  const height = slot.height;
  const width = (sw / sh) * height;
  const x = (cols - width) / 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    robot,
    robot.width * HEAD_CROP.x,
    robot.height * HEAD_CROP.y,
    sw,
    sh,
    x,
    slot.top,
    width,
    height,
  );
  return ctx.getImageData(0, 0, cols, rows).data;
}

/**
 * The robot behind the landing, his head filling `slotRef`'s box. Reduced motion draws it once,
 * settled.
 */
export function RobotBackdrop({ slotRef }: { slotRef: RefObject<HTMLElement | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!host || !canvas || !ctx) return;
    // BondBot: the robot is drawn once, settled, and holds still.
    const reduced = true;
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;

    const loaded = Promise.all([loadImage(SHEET), loadImage(ROBOT)]).then(([sheet, robot]) => {
      if (disposed) return;
      const ramp = glyphRamp(glyphCoverage(sheetAlpha(sheet)));
      const noise = Uint8Array.from(
        { length: 4096 },
        () => NOISE_CODES[Math.floor(Math.random() * NOISE_CODES.length)]!,
      );
      const eyes = tintedSheet(sheet, EYE_BLUE);
      const dim = tintedSheet(sheet, CODE_DIM);
      const layer = document.createElement("canvas");
      const layerCtx = layer.getContext("2d");
      const codeLayer = document.createElement("canvas");
      const codeCtx = codeLayer.getContext("2d");
      if (!layerCtx || !codeCtx) return;

      let grid: AsciiGrid | null = null;
      let atlases: HTMLCanvasElement[] = [];
      /** The solid color each settled cell takes, straight from the picture. */
      let settledColor: string[] = [];
      /** Settled glyphs in the order they settle. */
      let order = new Uint32Array(0);
      let lockTime = new Float32Array(0);
      /** When each cell's faint code appears; Infinity for a cell that never holds any. */
      let codeTime = new Float32Array(0);
      /** Cells that get faint code, in the order it appears. */
      let fillOrder = new Uint32Array(0);
      let fillCursor = 0;
      /** Cells holding faint code right now. */
      let coded: number[] = [];
      let cursor = 0;
      let start = performance.now();
      let glitches: { cell: number; until: number }[] = [];

      /** The sheet a settled glyph is drawn from: steady blue for the eyes, else its palette color. */
      const atlasFor = (cell: number) =>
        grid?.glow[cell] ? eyes : atlases[grid?.color[cell] ?? 0]!;

      function put(
        target: CanvasRenderingContext2D,
        atlas: CanvasImageSource,
        code: number,
        cell: number,
        cols: number,
      ) {
        const x = (cell % cols) * CELL;
        const y = Math.floor(cell / cols) * CELL;
        target.drawImage(atlas, (code & 15) * 8, (code >> 4) * 8, 8, 8, x, y, CELL, CELL);
      }

      /** A settled cell: one solid pixel in the picture's color. */
      function settle(target: CanvasRenderingContext2D, cell: number, cols: number) {
        target.fillStyle = settledColor[cell]!;
        target.fillRect((cell % cols) * CELL, Math.floor(cell / cols) * CELL, CELL, CELL);
      }

      function wipe(target: CanvasRenderingContext2D, cell: number, cols: number) {
        target.clearRect((cell % cols) * CELL, Math.floor(cell / cols) * CELL, CELL, CELL);
      }

      /** Where the head goes, in cells from the top of the backdrop. */
      function slotCells() {
        const slot = slotRef.current?.getBoundingClientRect();
        const top = host!.getBoundingClientRect().top;
        if (!slot) return { top: 0, height: Math.ceil(host!.clientHeight / CELL / 2) };
        return { top: (slot.top - top) / CELL, height: slot.height / CELL };
      }

      function build(settled: boolean) {
        if (!canvas || !ctx || !layerCtx || !codeCtx) return;
        const cols = Math.ceil(host!.clientWidth / CELL);
        const rows = Math.ceil(host!.clientHeight / CELL);
        if (cols < 1 || rows < 1) return;
        const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
        for (const target of [canvas, layer, codeLayer]) {
          target.width = cols * CELL * scale;
          target.height = rows * CELL * scale;
        }
        canvas.style.width = `${cols * CELL}px`;
        canvas.style.height = `${rows * CELL}px`;
        for (const target of [ctx, layerCtx, codeCtx]) {
          target.setTransform(scale, 0, 0, scale, 0, 0);
          target.imageSmoothingEnabled = false;
          target.clearRect(0, 0, cols * CELL, rows * CELL);
        }
        const pixels = sampleRobot(robot, cols, rows, slotCells());
        const g = asciiGrid(pixels, cols, rows, ramp);
        settledColor = Array.from({ length: cols * rows }, (_, i) => {
          const [r, gr, b] = [0, 1, 2].map((k) => settledChannel(pixels[i * 4 + k]!));
          return `rgb(${r} ${gr} ${b})`;
        });
        grid = g;
        atlases = g.palette.map((color) => tintedSheet(sheet, color));

        // The robot forms outward from his eyes (or the middle, if no eyes were found).
        let eyeX = 0;
        let eyeY = 0;
        let eyeCount = 0;
        for (let i = 0; i < cols * rows; i++) {
          if (!g.glow[i]) continue;
          eyeX += i % cols;
          eyeY += Math.floor(i / cols);
          eyeCount++;
        }
        const originX = eyeCount ? eyeX / eyeCount : cols / 2;
        const originY = eyeCount ? eyeY / eyeCount : rows / 3;
        const farthest = Math.hypot(
          Math.max(originX, cols - originX),
          Math.max(originY, rows - originY),
        );

        lockTime = new Float32Array(cols * rows);
        codeTime = new Float32Array(cols * rows).fill(Number.POSITIVE_INFINITY);
        const inked: number[] = [];
        for (let i = 0; i < cols * rows; i++) {
          const distance = Math.hypot((i % cols) - originX, Math.floor(i / cols) - originY);
          lockTime[i] =
            RESOLVE_START +
            (distance / farthest) ** 0.85 * RESOLVE_SPAN +
            Math.random() * RESOLVE_JITTER;
          const ink = g.glyph[i] !== SPACE;
          if (ink) inked.push(i);
          if (ink || Math.random() < CODE_DENSITY) codeTime[i] = Math.random() * FILL_SPAN;
        }
        order = Uint32Array.from(inked.sort((a, b) => lockTime[a]! - lockTime[b]!));
        const filled: number[] = [];
        for (let i = 0; i < cols * rows; i++)
          if (codeTime[i] !== Number.POSITIVE_INFINITY) filled.push(i);
        fillOrder = Uint32Array.from(filled.sort((a, b) => codeTime[a]! - codeTime[b]!));
        fillCursor = 0;
        coded = [];
        cursor = 0;
        glitches = [];
        start = performance.now() - (settled ? INTRO_END : 0);
        if (settled) {
          for (const cell of order) settle(layerCtx, cell, cols);
          cursor = order.length;
        }
      }

      function draw(now: number) {
        frame = 0;
        if (!ctx || !layerCtx || !codeCtx || !grid) return;
        const t = now - start;
        const { cols, rows, glyph } = grid;
        const tick = Math.floor(t / 70);
        const intro = t < INTRO_END;

        if (intro) {
          // Faint code appears, churns, and leaves each cell as the robot reaches it.
          while (fillCursor < fillOrder.length && codeTime[fillOrder[fillCursor]!]! <= t) {
            const cell = fillOrder[fillCursor++]!;
            if (lockTime[cell]! - SCRAMBLE <= t) continue;
            put(codeCtx, dim, noise[(cell * 5) & 4095]!, cell, cols);
            coded.push(cell);
          }
          const churn = Math.ceil(coded.length * CODE_CHURN);
          for (let k = 0; k < churn; k++) {
            const cell = coded[Math.floor(Math.random() * coded.length)]!;
            wipe(codeCtx, cell, cols);
            put(codeCtx, dim, noise[(cell * 3 + tick + k) & 4095]!, cell, cols);
          }
          coded = coded.filter((cell) => {
            if (lockTime[cell]! - SCRAMBLE > t) return true;
            wipe(codeCtx, cell, cols);
            return false;
          });
        }

        while (cursor < order.length && lockTime[order[cursor]!]! <= t) {
          const cell = order[cursor++]!;
          settle(layerCtx, cell, cols);
        }
        ctx.clearRect(0, 0, cols * CELL, rows * CELL);
        if (intro) ctx.drawImage(codeLayer, 0, 0, cols * CELL, rows * CELL);
        ctx.drawImage(layer, 0, 0, cols * CELL, rows * CELL);

        // Glyphs about to settle scramble in their final color, brightening as they near it.
        for (let j = cursor; j < order.length && lockTime[order[j]!]! < t + SCRAMBLE; j++) {
          const cell = order[j]!;
          ctx.globalAlpha = 0.35 + 0.65 * (1 - (lockTime[cell]! - t) / SCRAMBLE);
          put(ctx, atlasFor(cell), noise[(cell * 7 + tick) & 4095]!, cell, cols);
        }
        ctx.globalAlpha = 1;

        if (!intro) {
          canvas!.dataset.phase = "idle";
          const idle = t - INTRO_END;
          // Now and then a band of him breaks back into code on its way down the screen.
          const band =
            Math.floor(((idle % WAVE_EVERY) / 1000) * WAVE_ROWS_PER_SECOND) - WAVE_HEIGHT;
          for (let row = Math.max(0, band); row < Math.min(rows, band + WAVE_HEIGHT); row++) {
            for (let col = 0; col < cols; col++) {
              const cell = row * cols + col;
              if (glyph[cell] === SPACE || Math.random() < 0.4) continue;
              wipe(ctx, cell, cols);
              put(ctx, atlasFor(cell), noise[(cell + tick * 11) & 4095]!, cell, cols);
            }
          }
          if (order.length && Math.random() < 0.12) {
            glitches.push({
              cell: order[Math.floor(Math.random() * order.length)]!,
              until: t + 90,
            });
          }
          glitches = glitches.filter((glitch) => glitch.until > t);
          for (const { cell } of glitches) {
            wipe(ctx, cell, cols);
            put(ctx, atlasFor(cell), noise[(cell + tick * 13) & 4095]!, cell, cols);
          }
        } else {
          canvas!.dataset.phase = "intro";
        }
        if (!reduced) frame = requestAnimationFrame(draw);
      }

      build(reduced);
      draw(performance.now());

      let size = `${host.clientWidth}x${host.clientHeight}`;
      observer = new ResizeObserver(() => {
        const next = `${host.clientWidth}x${host.clientHeight}`;
        if (next === size) return;
        size = next;
        // After a resize the robot is already there: skip straight to idle.
        build(true);
        if (reduced) draw(performance.now());
      });
      observer.observe(host);
    });
    // Without its images the landing is a plain dark backdrop; the form still works.
    void bestEffort("draw the landing robot", loaded);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [slotRef]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        data-testid="robot-backdrop"
        className="block [image-rendering:pixelated]"
      />
    </div>
  );
}
