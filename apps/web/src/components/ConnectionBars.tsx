// Local addition (David, 2026-11-22): signal bars in the header. Three green bars = live, two amber =
// slow or reconnecting, one red with a slash = offline. Tap for a small panel and an instant check.
import { Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ConnectionLevel, ConnectionSnapshot } from "../lib/connection-status";
import { ConnectionMonitor, connectionMonitor } from "../lib/connection-status";

const STYLES = `
@keyframes cxblip{0%{filter:brightness(2.2)}100%{filter:brightness(1)}}
@keyframes cxpulse{0%,100%{opacity:1}50%{opacity:.3}}
.cx-blip{animation:cxblip .7s ease-out}
.cx-pulse{animation:cxpulse 1.1s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.cx-blip,.cx-pulse{animation:none!important}}
`;

const BAR_HEIGHTS = [6, 10, 14];
const LABEL: Record<ConnectionLevel, string> = {
  checking: "Checking…",
  good: "Live",
  slow: "Slow connection",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};
const LIT: Record<ConnectionLevel, number> = { checking: 0, good: 3, slow: 2, reconnecting: 2, offline: 1 };
const COLOR: Record<ConnectionLevel, string> = {
  checking: "bg-foreground/30",
  good: "bg-emerald-400",
  slow: "bg-amber-400",
  reconnecting: "bg-amber-400",
  offline: "bg-red-400",
};
const DOT: Record<ConnectionLevel, string> = { ...COLOR, checking: "bg-foreground/40" };

function ago(from: number | null, now: number): string {
  if (from === null) return "";
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** What the panel says for the current state. */
export function describeConnection(snap: ConnectionSnapshot, now: number) {
  const since = ago(snap.lastOkAt, now);
  switch (snap.level) {
    case "good":
      return { title: LABEL.good, line: `Server answered in ${snap.latencyMs ?? "?"} ms`, note: "Updates arrive in real time." };
    case "slow":
      return { title: LABEL.slow, line: `Server answered in ${snap.latencyMs ?? "?"} ms`, note: "It works, just slowly. Updates may lag." };
    case "reconnecting":
      return {
        title: LABEL.reconnecting,
        line: since ? `Last answer ${since} ago` : "No answer yet",
        note: "Trying again every few seconds.",
      };
    case "offline":
      return {
        title: LABEL.offline,
        line: since ? `Last answer ${since} ago` : "No answer yet",
        note: snap.online
          ? "Can't reach the server. Check Tailscale or signal. What you see may be out of date."
          : "Your phone is offline. Check Tailscale or signal. What you see may be out of date.",
      };
    default:
      return { title: LABEL.checking, line: "Checking the connection…", note: "" };
  }
}

export function ConnectionBars({ monitor = connectionMonitor }: { monitor?: ConnectionMonitor }) {
  const snap = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  useEffect(() => monitor.start(), [monitor]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);
  const level = snap.level;
  const lit = LIT[level];
  const info = describeConnection(snap, now);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void monitor.check();
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="connection-bars"
            data-level={level}
            aria-label={`Connection: ${LABEL[level]}. Tap for details.`}
            className="app-no-drag relative grid h-[34px] w-8 shrink-0 place-items-center rounded-full"
          />
        }
      >
        <style>{STYLES}</style>
        <span
          key={snap.blips}
          aria-hidden="true"
          className={`flex items-end gap-[2px] ${level === "good" && snap.blips > 1 ? "cx-blip" : ""} ${level === "reconnecting" ? "cx-pulse" : ""}`}
        >
          {BAR_HEIGHTS.map((height, index) => (
            <span
              key={height}
              data-bar={index < lit ? "on" : "off"}
              className={`block w-[4px] rounded-[1.5px] ${index < lit ? COLOR[level] : "bg-foreground/20"}`}
              style={{ height }}
            />
          ))}
        </span>
        {level === "offline" ? (
          <span
            data-testid="connection-slash"
            aria-hidden="true"
            className="absolute h-[2px] w-[22px] -rotate-[48deg] rounded bg-red-400"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        data-testid="connection-panel"
        className="app-no-drag w-[min(280px,calc(100vw-24px))] gap-1.5 p-3"
      >
        <div className="flex items-center gap-2 text-body font-semibold text-foreground">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT[level]}`} />
          <span data-testid="connection-title">{info.title}</span>
        </div>
        <div data-testid="connection-line" className="text-body-sm text-foreground">
          {info.line}
        </div>
        {info.note ? <div className="text-body-sm text-muted-foreground">{info.note}</div> : null}
        <Button
          size="sm"
          variant="secondary"
          data-testid="connection-check"
          disabled={snap.checking}
          onClick={() => void monitor.check()}
          className="mt-1 self-start"
        >
          {snap.checking ? "Checking…" : "Check now"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
