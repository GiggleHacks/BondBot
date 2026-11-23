// Local addition (David, 2026-11-21): the live screen docked above the chat on a phone, with a
// draggable divider, a full screen view and a way to close it.
import type { Bot, ComputerStatus } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Maximize2, MessageSquare, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBackLayer } from "../../lib/back-layers";
import { screenFrames, screenIframeSandbox } from "../../lib/computer-screen";
import {
  clampDockHeight,
  defaultDockHeight,
  screenDockHeightPreference,
} from "../../lib/screen-dock";
import { computerPlaceholder, resolveOwnedComputerScreen } from "./computer-view";

/** The floating header's height, so the docked screen starts just under it. */
const HEADER_OFFSET = 66;
const DIVIDER_HEIGHT = 24;
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

function useViewportHeight(): number {
  const read = () => window.visualViewport?.height ?? window.innerHeight;
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const update = () => setHeight(read());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

const roundButton =
  "grid size-8 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20 active:bg-black/80";

export function DockedScreen({
  bot,
  computer,
  embeddedScreenUrl,
  screenBotId,
  screenFrameKey,
  heldScreen,
  screenFrameRef,
  computerScreenError,
  computerBooting,
  booting,
  onWake,
  onRefresh,
  onClose,
}: {
  bot: Bot;
  computer: ComputerStatus | null;
  embeddedScreenUrl: string | null;
  screenBotId?: string | null;
  screenFrameKey?: string;
  heldScreen?: { url: string; key: string } | null;
  /** Left out while another frame (the bot panel) owns the screen's state reports. */
  screenFrameRef?: (frame: HTMLIFrameElement | null) => void;
  computerScreenError: ReactNode;
  computerBooting: ReactNode;
  booting: boolean;
  onWake: () => void;
  /** One press brings the screen back where it is: wakes a stopped computer, reconnects a running one. */
  onRefresh?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const viewport = useViewportHeight();
  const [chosen, setChosen] = useState(() => screenDockHeightPreference.get());
  const [full, setFull] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (refreshing || !onRefresh) return;
    setRefreshing(true);
    try {
      await Promise.race([
        Promise.resolve(onRefresh()),
        new Promise((resolve) => window.setTimeout(resolve, 6000)),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  // The Back gesture leaves full screen first.
  useBackLayer(full, () => setFull(false));
  const height = clampDockHeight(chosen || defaultDockHeight(viewport), viewport);
  // The newest height, so letting go saves what the last drag step set even before it has rendered.
  const latest = useRef(height);
  latest.current = height;
  const owned = resolveOwnedComputerScreen(bot.id, computer, embeddedScreenUrl, screenBotId, heldScreen);
  const showing =
    owned.computer?.state === "running" && owned.embeddedScreenUrl && !computerScreenError;
  const asleep =
    !showing &&
    !booting &&
    !computerBooting &&
    !computerScreenError &&
    (!owned.computer || owned.computer.state === "stopped" || owned.computer.state === "suspended");

  const setHeight = useCallback(
    (next: number) => {
      const clamped = clampDockHeight(next, viewport);
      latest.current = clamped;
      setChosen(clamped);
    },
    [viewport],
  );
  const saveHeight = () => screenDockHeightPreference.set(latest.current);

  // Local addition (David, 2026-11-21): pinch to zoom the screen like a photo, drag to pan, double-tap
  // to zoom in and out. The layer is moved with a CSS transform, so nothing reloads or reconnects.
  const viewRef = useRef<HTMLDivElement>(null);
  const zoomLayer = useRef<HTMLDivElement>(null);
  const zoom = useRef({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pinch"; dist: number; s: number; x: number; y: number; mid: { x: number; y: number } }
    | { kind: "pan"; s: number; x: number; y: number; at: { x: number; y: number }; moved: number; t0: number }
    | null
  >(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const applyZoom = useCallback((scale: number, x: number, y: number) => {
    const view = viewRef.current;
    if (!view) return;
    const { width, height } = view.getBoundingClientRect();
    const s = Math.min(MAX_ZOOM, Math.max(1, scale));
    const nx = s <= 1 ? 0 : Math.min(0, Math.max(width - width * s, x));
    const ny = s <= 1 ? 0 : Math.min(0, Math.max(height - height * s, y));
    zoom.current = { s, x: nx, y: ny };
    const layer = zoomLayer.current;
    if (layer) {
      layer.style.transform = s === 1 ? "" : `translate3d(${nx}px, ${ny}px, 0) scale(${s})`;
      layer.dataset.zoom = s.toFixed(2);
    }
    setZoomed((was) => (was === s > 1.01 ? was : s > 1.01));
  }, []);
  const local = (clientX: number, clientY: number) => {
    const rect = viewRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };
  /** Starts (or restarts, when a finger is added or lifted) the gesture from where the zoom is now. */
  const beginGesture = () => {
    const points = [...pointers.current.values()];
    const z = zoom.current;
    if (points.length >= 2) {
      const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s: z.s,
        x: z.x,
        y: z.y,
        mid: local((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
    } else if (points.length === 1) {
      const [a] = points as [{ x: number; y: number }];
      gesture.current = { kind: "pan", s: z.s, x: z.x, y: z.y, at: { ...a }, moved: 0, t0: performance.now() };
    } else {
      gesture.current = null;
    }
  };
  const onZoomDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || (event.target as HTMLElement).closest("button")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  };
  const onZoomMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const points = [...pointers.current.values()];
      const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
      const now = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = Math.min(MAX_ZOOM, Math.max(1, (g.s * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / g.dist));
      // The point of the screen that was under the fingers stays under them.
      const px = (g.mid.x - g.x) / g.s;
      const py = (g.mid.y - g.y) / g.s;
      applyZoom(s, now.x - px * s, now.y - py * s);
    } else {
      const dx = event.clientX - g.at.x;
      const dy = event.clientY - g.at.y;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      if (zoom.current.s > 1) applyZoom(zoom.current.s, g.x + dx, g.y + dy);
    }
  };
  const onZoomUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (g?.kind === "pan" && event.type === "pointerup" && g.moved < 10 && performance.now() - g.t0 < 300) {
      const tap = local(event.clientX, event.clientY);
      const last = lastTap.current;
      const now = performance.now();
      if (last && now - last.t < 320 && Math.hypot(tap.x - last.x, tap.y - last.y) < 30) {
        lastTap.current = null;
        if (zoom.current.s > 1.05) applyZoom(1, 0, 0);
        else applyZoom(DOUBLE_TAP_ZOOM, tap.x - tap.x * DOUBLE_TAP_ZOOM, tap.y - tap.y * DOUBLE_TAP_ZOOM);
      } else {
        lastTap.current = { t: now, x: tap.x, y: tap.y };
      }
    }
    if (zoom.current.s < 1.02) applyZoom(1, 0, 0);
    beginGesture();
  };
  // A new bot, full screen or not, or a screen that went away starts at 1x again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these only trigger the reset.
  useEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    applyZoom(1, 0, 0);
  }, [bot.id, full, showing, applyZoom]);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  return (
    <div
      data-testid="docked-screen"
      className={`relative shrink-0 bg-background md:hidden ${full ? "z-[80]" : "z-[5]"}`}
      style={{ marginTop: HEADER_OFFSET, height: height + DIVIDER_HEIGHT }}
    >
      <div
        ref={viewRef}
        data-testid="docked-screen-view"
        data-full={full ? "" : undefined}
        onPointerDown={onZoomDown}
        onPointerMove={onZoomMove}
        onPointerUp={onZoomUp}
        onPointerCancel={onZoomUp}
        className={
          full
            ? "fixed inset-0 z-[70] bg-black"
            : "absolute inset-x-2 top-0 overflow-hidden rounded-xl bg-black"
        }
        style={{ touchAction: "none", ...(full ? { paddingTop: "env(safe-area-inset-top)" } : { height }) }}
      >
        {showing ? (
          <div ref={zoomLayer} data-testid="docked-screen-zoom" data-zoom="1" className="absolute inset-0 origin-top-left">
          {screenFrames(screenFrameKey, owned.embeddedScreenUrl as string, owned.heldScreen).map(
            (frame) => (
              <iframe
                key={frame.key}
                title={frame.held ? undefined : "Bot screen"}
                aria-hidden={frame.held || undefined}
                tabIndex={frame.held ? -1 : undefined}
                ref={frame.held ? undefined : screenFrameRef}
                src={frame.url}
                sandbox={screenIframeSandbox(frame.url)}
                className={`h-full w-full border-0 bg-black${frame.held ? " absolute inset-0" : ""}`}
                allow="clipboard-read; clipboard-write"
                style={{ pointerEvents: "none" }}
              />
            ),
          )}
          </div>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-body text-white/70">
            <div className="flex flex-col items-center gap-3">
              <span>
                {computerScreenError ??
                  computerBooting ??
                  computerPlaceholder(
                    owned.computer?.state,
                    booting,
                    "Connecting to the screen…",
                  )}
              </span>
              {asleep ? (
                <Button size="sm" variant="secondary" onClick={onWake}>
                  Wake
                </Button>
              ) : null}
              {!asleep && !computerScreenError && !booting && !computerBooting && onRefresh ? (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="docked-screen-refresh-button"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  Refresh
                </Button>
              ) : null}
            </div>
          </div>
        )}
        {zoomed ? (
          <button
            type="button"
            aria-label="Reset zoom"
            data-testid="docked-screen-zoom-reset"
            onClick={() => applyZoom(1, 0, 0)}
            className={`${roundButton} absolute start-3 top-3 text-[11px] font-semibold`}
            style={full ? { marginTop: "env(safe-area-inset-top)" } : undefined}
          >
            1×
          </button>
        ) : null}
        {full ? (
          <>
            <button
              type="button"
              aria-label="Close screen"
              data-testid="docked-screen-close"
              onClick={onClose}
              className={`${roundButton} absolute end-3 top-3`}
              style={{ marginTop: "env(safe-area-inset-top)" }}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="docked-screen-chat"
              onClick={() => setFull(false)}
              className="absolute bottom-6 start-4 flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-body font-semibold text-white ring-1 ring-white/20 active:bg-white/25"
            >
              <MessageSquare className="size-[18px]" aria-hidden="true" />
              Chat
            </button>
          </>
        ) : (
          <div className="absolute end-2 top-2 flex gap-2">
            {onRefresh ? (
              <button
                type="button"
                aria-label="Refresh screen"
                data-testid="docked-screen-refresh"
                disabled={refreshing}
                onClick={() => void refresh()}
                className={roundButton}
              >
                <RefreshCw
                  className={`size-4${refreshing ? " animate-spin motion-reduce:animate-none" : ""}`}
                  aria-hidden="true"
                />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Full screen"
              data-testid="docked-screen-full"
              onClick={() => setFull(true)}
              className={roundButton}
            >
              <Maximize2 className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Close screen"
              data-testid="docked-screen-close"
              onClick={onClose}
              className={roundButton}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {full ? null : (
        // biome-ignore lint/a11y/useSemanticElements: a draggable divider is a custom separator.
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize screen"
          aria-valuemin={0}
          aria-valuenow={height}
          tabIndex={0}
          data-testid="docked-screen-divider"
          className="absolute inset-x-0 flex cursor-row-resize items-center justify-center [touch-action:none]"
          style={{ top: height, height: DIVIDER_HEIGHT }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { startY: event.clientY, startHeight: height };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setHeight(drag.current.startHeight + (event.clientY - drag.current.startY));
          }}
          onPointerUp={() => {
            drag.current = null;
            saveHeight();
          }}
          onPointerCancel={() => {
            drag.current = null;
            saveHeight();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") setHeight(height - 20);
            else if (event.key === "ArrowDown") setHeight(height + 20);
            else return;
            event.preventDefault();
          }}
          onKeyUp={saveHeight}
        >
          <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-foreground/25" />
        </div>
      )}
    </div>
  );
}
