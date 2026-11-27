// Local addition (BondBot): a pixel trail behind the mouse pointer on the sign-in screens. Hover
// effects are CSS (styles/pixel-fx.css); both follow `html[data-pixel-fx]` and reduced motion.

const GRID = 4;
const LIFE_MS = 360;
const MAX_PIXELS = 320;
const SPACING = 6;

type Pixel = { x: number; y: number; born: number; size: number; accent: boolean };

/** Starts the trail and returns how to stop and remove it. Touch and pen input never draw. */
export function startPixelFx(): () => void {
  // Nothing to draw on where media queries are missing, such as a test DOM.
  if (typeof window.matchMedia !== "function") return () => {};
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.testid = "pixel-trail";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "2147483646",
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  document.body.append(canvas);

  const pixels: Pixel[] = [];
  let frame = 0;
  let last: { x: number; y: number } | null = null;
  let colors = readColors();
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function readColors() {
    const style = getComputedStyle(root);
    return {
      ink: style.getPropertyValue("--foreground").trim() || "#f5f5f5",
      accent: style.getPropertyValue("--ring").trim() || "#1884fc",
    };
  }

  function enabled() {
    return root.dataset.pixelFx !== "off" && !reduced.matches;
  }

  function spawn(x: number, y: number, now: number) {
    pixels.push({
      x: Math.round(x / GRID) * GRID,
      y: Math.round(y / GRID) * GRID,
      born: now,
      size: Math.random() < 0.3 ? GRID * 2 : GRID,
      accent: Math.random() < 0.35,
    });
    if (pixels.length > MAX_PIXELS) pixels.splice(0, pixels.length - MAX_PIXELS);
  }

  function draw(now: number) {
    frame = 0;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const pixel of pixels) {
      const age = (now - pixel.born) / LIFE_MS;
      if (age >= 1) continue;
      pixels[alive++] = pixel;
      // Shrinks in whole grid steps, so it reads as pixels rather than a smooth fade.
      const step = Math.ceil((1 - age) * 3) / 3;
      const size = Math.max(GRID / 2, Math.round((pixel.size * step) / 2) * 2);
      ctx.globalAlpha = step * 0.85;
      ctx.fillStyle = pixel.accent ? colors.accent : colors.ink;
      ctx.fillRect(pixel.x - size / 2, pixel.y - size / 2, size, size);
    }
    pixels.length = alive;
    ctx.globalAlpha = 1;
    if (alive > 0) frame = requestAnimationFrame(draw);
  }

  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !enabled()) {
      last = null;
      return;
    }
    const now = performance.now();
    const point = { x: event.clientX, y: event.clientY };
    if (last) {
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      const steps = Math.min(12, Math.floor(distance / SPACING));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        spawn(last.x + (point.x - last.x) * t, last.y + (point.y - last.y) * t, now);
      }
    } else {
      spawn(point.x, point.y, now);
    }
    last = point;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function leave() {
    last = null;
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerleave", leave);
  // Theme changes recolor the trail.
  const themes = new MutationObserver(() => {
    colors = readColors();
  });
  themes.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });

  return () => {
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", move);
    document.removeEventListener("pointerleave", leave);
    themes.disconnect();
    if (frame) cancelAnimationFrame(frame);
    canvas.remove();
  };
}
