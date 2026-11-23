// Local addition (David, 2026-11-21): a quick scan across the whole page, played once a model switch is saved.
export type IconSpec = { url: string; mono: boolean; tint?: string };

const DURATION_MS = 380;
const TRAIL = 140;
const CHIP_BG_FALLBACK = "#262626";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("icon failed to load"));
    image.src = url;
  });
}

/** The icon on a square canvas, tinted when it is a one-colour mark. */
async function iconCanvas(spec: IconSpec | null, size = 32): Promise<HTMLCanvasElement | null> {
  if (!spec) return null;
  try {
    const image = await loadImage(spec.url);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, size, size);
    if (spec.mono && spec.tint) {
      context.globalCompositeOperation = "source-in";
      context.fillStyle = spec.tint;
      context.fillRect(0, 0, size, size);
    }
    return canvas;
  } catch {
    return null;
  }
}

/** Where the scan line is (px from the top) after `elapsed` ms. It runs all the way off the bottom. */
export function scanFront(elapsed: number, height: number): number {
  const t = Math.min(1, Math.max(0, elapsed / DURATION_MS));
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return eased * (height + TRAIL);
}

/** The chip shows the old icon until the scan line passes it, then the new one. */
export function iconPhase(elapsed: number, height: number, chipY: number): "old" | "new" {
  return scanFront(elapsed, height) >= chipY ? "new" : "old";
}

/**
 * A fast scan line sweeps down the whole page in the maker's colour, then removes itself.
 * The chip's icon swaps the moment the line crosses it. Call it only after the server has saved the switch.
 */
export async function playModelSwitchFx(options: {
  chip: DOMRect;
  chipBackground?: string;
  from: IconSpec | null;
  to: IconSpec | null;
  color: string;
}): Promise<void> {
  if (typeof document === "undefined") return;
  try {
    navigator.vibrate?.(25);
  } catch {
    // Not every browser buzzes.
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const [oldIcon, newIcon] = await Promise.all([iconCanvas(options.from), iconCanvas(options.to)]);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-testid", "model-switch-fx");
  canvas.setAttribute("aria-hidden", "true");
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));
  canvas.width = width;
  canvas.height = height;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "2147483000",
  });
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  const accent = options.color === "currentColor" ? "#d4d4d8" : options.color;
  const { chip } = options;
  const cx = chip.left + chip.width / 2;
  const cy = chip.top + chip.height / 2;
  const iconSize = Math.round(chip.width * 0.56);
  const ring = chip.width / 2 + 2;
  const chipBackground = options.chipBackground || CHIP_BG_FALLBACK;

  await new Promise<void>((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      context.clearRect(0, 0, width, height);
      const front = scanFront(elapsed, height);
      // The soft trail the line leaves behind it, then the line itself.
      const trail = context.createLinearGradient(0, front - TRAIL, 0, front);
      trail.addColorStop(0, "rgba(0,0,0,0)");
      trail.addColorStop(1, accent);
      context.globalAlpha = 0.22;
      context.fillStyle = trail;
      context.fillRect(0, front - TRAIL, width, TRAIL);
      context.globalAlpha = 1;
      context.save();
      context.shadowColor = accent;
      context.shadowBlur = 14;
      context.fillStyle = accent;
      context.fillRect(0, front - 1, width, 2);
      context.restore();
      context.globalAlpha = 0.8;
      context.fillStyle = "#ffffff";
      context.fillRect(0, front - 0.5, width, 1);
      context.globalAlpha = 1;
      // The chip: covered, showing the old icon until the line crosses it, then the new one with a quick flash.
      const phase = iconPhase(elapsed, height, cy);
      context.fillStyle = chipBackground;
      context.beginPath();
      context.arc(cx, cy, ring - 1, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = phase === "new" ? accent : "rgba(255,255,255,.18)";
      context.beginPath();
      context.arc(cx, cy, ring - 1, 0, Math.PI * 2);
      context.stroke();
      const icon = phase === "old" ? oldIcon : newIcon;
      if (icon) {
        context.imageSmoothingEnabled = true;
        context.drawImage(icon, Math.round(cx - iconSize / 2), Math.round(cy - iconSize / 2), iconSize, iconSize);
      }
      if (elapsed < DURATION_MS) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  canvas.remove();
}
