import { useEffect, useRef } from "react";
import { codeLine } from "./code-lines";

// Local addition (BondBot): a very faint wall of scrolling code behind the landing. Each column
// is text drawn once onto its own strip and redrawn only when a line scrolls off, so a frame is
// one blit per column. The center is masked out so the robot and the form stay clean.

const LINE = 16;
const COLUMN = 440;
const FONT = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INK = "rgb(225 230 240 / 0.045)";
const ACCENT = "rgb(255 70 60 / 0.09)";

type Column = {
  x: number;
  lines: { text: string; accent: boolean }[];
  offset: number;
  speed: number;
  strip: HTMLCanvasElement;
};

function newLine() {
  return { text: codeLine(), accent: Math.random() < 0.07 };
}

export function CodeBackdrop() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!host || !canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let columns: Column[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    function paintStrip(column: Column) {
      const strip = column.strip.getContext("2d");
      if (!strip) return;
      strip.setTransform(dpr, 0, 0, dpr, 0, 0);
      strip.clearRect(0, 0, COLUMN, column.lines.length * LINE);
      strip.font = FONT;
      strip.textBaseline = "top";
      column.lines.forEach((line, i) => {
        strip.fillStyle = line.accent ? ACCENT : INK;
        strip.fillText(line.text, 0, i * LINE + 2);
      });
    }

    function build() {
      width = host!.clientWidth;
      height = host!.clientHeight;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      const rows = Math.ceil(height / LINE) + 2;
      columns = Array.from({ length: Math.ceil(width / COLUMN) }, (_, i) => {
        const strip = document.createElement("canvas");
        strip.width = Math.round(COLUMN * dpr);
        strip.height = Math.round(rows * LINE * dpr);
        const column: Column = {
          x: i * COLUMN + 12,
          lines: Array.from({ length: rows }, newLine),
          offset: Math.random() * LINE,
          speed: 5 + Math.random() * 9,
          strip,
        };
        paintStrip(column);
        return column;
      });
    }

    function draw(now: number) {
      frame = 0;
      if (!ctx) return;
      const dt = last ? Math.min(50, now - last) : 16;
      last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const column of columns) {
        column.offset += (column.speed * dt) / 1000;
        if (column.offset >= LINE) {
          column.offset -= LINE;
          column.lines.shift();
          column.lines.push(newLine());
          paintStrip(column);
        }
        ctx.drawImage(column.strip, column.x * dpr, -column.offset * dpr);
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    }

    build();
    draw(performance.now());
    const observer = new ResizeObserver(() => {
      if (host.clientWidth === width && host.clientHeight === height) return;
      build();
      if (reduced) draw(performance.now());
    });
    observer.observe(host);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="bb-code-backdrop pointer-events-none absolute inset-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
