// Local addition (David, 2026-11-21): the live screen docked above the chat, with a draggable
// divider, a full screen view and a way to close it. Phone only until 2026-11-28, now every width.
import type { Bot, ComputerStatus } from "@rakazo/contracts";
import { computerPreviewPlaceholder } from "@rakazo/i18n/computer-preview";
import { Button } from "@rakazo/ui-web";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { Maximize2, MessageSquare, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBackLayer } from "../../lib/back-layers";
import { screenFrames, screenIframeSandbox } from "../../lib/computers/computer-screen";
import {
  clampDockHeight,
  defaultDockHeight,
  screenDockHeightPreference,
} from "../../lib/screen-dock";
import { resolveOwnedComputerScreen } from "./computers/computer-view";

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
  hasControl = false,
  onTakeControl,
  onRelease,
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
  /** True while this person holds control of the screen: it then takes taps, drags and keys itself. */
  hasControl?: boolean;
  /** Takes control; resolves true when it is granted. */
  onTakeControl?: () => Promise<boolean> | boolean;
  /** Hands control back. */
  onRelease?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const viewport = useViewportHeight();
  const phone = useIsMobile();
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
  const height = clampDockHeight(chosen || defaultDockHeight(viewport, phone), viewport);
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

  // Local change (David, 2026-11-23): no Take control button. A tap on the screen, or opening it full
  // screen, takes control; a bot that is working on it is asked about first.
  const controlling = Boolean(hasControl && showing);
  const [taking, setTaking] = useState(false);
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const tapTimer = useRef<number | undefined>(undefined);
  const takeControl = useCallback(async () => {
    if (!onTakeControl) return;
    setConfirmTakeover(false);
    setTaking(true);
    try {
      await onTakeControl();
    } finally {
      setTaking(false);
    }
  }, [onTakeControl]);
  const requestControl = useCallback(() => {
    if (!onTakeControl || !showing || controlling || taking) return;
    if (owned.computer?.controlHolder === "bot") {
      setConfirmTakeover(true);
      return;
    }
    void takeControl();
  }, [onTakeControl, showing, controlling, taking, owned.computer?.controlHolder, takeControl]);
  const requestControlRef = useRef(requestControl);
  requestControlRef.current = requestControl;
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new bot, lost screen, or taking control drops pending tap/confirm state.
  useEffect(() => {
    window.clearTimeout(tapTimer.current);
    setConfirmTakeover(false);
  }, [bot.id, showing, controlling]);

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
    if (controlling || (event.target as HTMLElement).closest("button")) return;
    if (event.pointerType === "mouse") {
      if (event.button === 0) requestControlRef.current();
      return;
    }
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
        window.clearTimeout(tapTimer.current);
        if (zoom.current.s > 1.05) applyZoom(1, 0, 0);
        else applyZoom(DOUBLE_TAP_ZOOM, tap.x - tap.x * DOUBLE_TAP_ZOOM, tap.y - tap.y * DOUBLE_TAP_ZOOM);
      } else {
        lastTap.current = { t: now, x: tap.x, y: tap.y };
        // A single tap takes control once it is clear no second tap (zoom) follows.
        window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => requestControlRef.current(), 340);
      }
    }
    if (zoom.current.s < 1.02) applyZoom(1, 0, 0);
    beginGesture();
  };
  // A new bot, full screen or not, entering control mode, or a screen that went away starts at 1x again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these only trigger the reset.
  useEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    applyZoom(1, 0, 0);
  }, [bot.id, full, showing, controlling, applyZoom]);

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
      className={`relative shrink-0 bg-background ${full ? "z-[80]" : "z-[5]"}`}
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
                style={{ pointerEvents: controlling ? "auto" : "none" }}
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
                  computerPreviewPlaceholder(owned.computer?.state, booting)}
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
        {controlling ? (
          <div
            aria-hidden="true"
            data-testid="docked-screen-control-ring"
            className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit] ring-2 ring-inset ring-emerald-400/80"
          />
        ) : null}
        {showing && !controlling && !taking && !confirmTakeover && onTakeControl ? (
          <div
            data-testid="docked-screen-control-hint"
            className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
            style={full ? { bottom: 88 } : undefined}
          >
            <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] text-white ring-1 ring-white/20">
              {phone ? "Tap" : "Click"} the screen to control
            </span>
          </div>
        ) : null}
        {taking ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center" style={full ? { bottom: 88 } : undefined}>
            <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] text-white ring-1 ring-white/20">
              Taking control…
            </span>
          </div>
        ) : null}
        {controlling ? (
          <div
            data-testid="docked-screen-control-tag"
            className={`absolute flex items-center gap-2 rounded-full bg-black/65 py-1 pe-1 ps-3 text-[11px] text-white ring-1 ring-white/20 ${full ? "start-1/2 -translate-x-1/2" : "start-2"}`}
            style={full ? { top: "calc(env(safe-area-inset-top) + 12px)" } : { bottom: 8 }}
          >
            <span aria-hidden="true" className="size-[7px] rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.95)]" />
            You're in control
            <button
              type="button"
              data-testid="docked-screen-release"
              onClick={() => void onRelease?.()}
              className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold active:bg-white/30"
            >
              Release
            </button>
          </div>
        ) : null}
        {confirmTakeover ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 px-4">
            <div
              role="dialog"
              aria-label="Take over from the bot"
              data-testid="docked-screen-takeover"
              className="w-full max-w-[300px] rounded-2xl border border-white/15 bg-neutral-900 p-4 text-white shadow-xl"
            >
              <div className="text-body font-semibold">Bot is working on this screen</div>
              <div className="mt-1 text-body-sm text-white/70">
                Taking over pauses it. It can continue when you release.
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void takeControl()}>
                  Take over
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmTakeover(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}
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
              onClick={() => {
                setFull(true);
                requestControl();
              }}
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
