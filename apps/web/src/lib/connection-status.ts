// Local addition (David, 2026-11-22): is the app really connected? A light check every few seconds
// (a tiny public request to the server), plus the live streams and the browser's own online flag,
// boiled down to one level the signal bars show.
export type ConnectionLevel = "checking" | "good" | "slow" | "reconnecting" | "offline";

export type ConnectionSnapshot = {
  level: ConnectionLevel;
  latencyMs: number | null;
  lastOkAt: number | null;
  failures: number;
  online: boolean;
  checking: boolean;
  /** Counts up on every answer, so the bars can flash like a packet arriving. */
  blips: number;
};

export const SLOW_MS = 1500;
export const STREAM_GRACE_MS = 10_000;

export function deriveLevel(input: {
  online: boolean;
  failures: number;
  latencyMs: number | null;
  lastOkAt: number | null;
  streamsEverOpened: boolean;
  streams: number;
  streamsZeroSince: number | null;
  now: number;
  slowMs?: number;
  streamGraceMs?: number;
}): ConnectionLevel {
  if (!input.online) return "offline";
  if (input.failures >= 2) return "offline";
  if (input.failures === 1) return "reconnecting";
  if (input.lastOkAt === null) return "checking";
  if (input.latencyMs !== null && input.latencyMs > (input.slowMs ?? SLOW_MS)) return "slow";
  if (
    input.streamsEverOpened &&
    input.streams === 0 &&
    input.streamsZeroSince !== null &&
    input.now - input.streamsZeroSince > (input.streamGraceMs ?? STREAM_GRACE_MS)
  )
    return "reconnecting";
  return "good";
}

async function defaultProbe(timeoutMs: number): Promise<boolean> {
  const res = await fetch("/api/auth/ok", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  // A captive portal or an error page that answers 200 is not the server.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return false;
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  return body?.ok === true;
}

export type ConnectionMonitorOptions = {
  intervalMs?: number;
  retryMs?: number;
  slowMs?: number;
  timeoutMs?: number;
  streamGraceMs?: number;
  probe?: (timeoutMs: number) => Promise<boolean>;
  isOnline?: () => boolean;
};

export class ConnectionMonitor {
  private snapshot: ConnectionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly intervalMs: number;
  private readonly retryMs: number;
  private readonly slowMs: number;
  private readonly timeoutMs: number;
  private readonly streamGraceMs: number;
  private readonly probe: (timeoutMs: number) => Promise<boolean>;
  private readonly isOnline: () => boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private users = 0;
  private teardown: (() => void) | null = null;
  private streams = 0;
  private streamsEverOpened = false;
  private streamsZeroSince: number | null = null;

  constructor(options: ConnectionMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.retryMs = options.retryMs ?? 3_000;
    this.slowMs = options.slowMs ?? SLOW_MS;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.streamGraceMs = options.streamGraceMs ?? STREAM_GRACE_MS;
    this.probe = options.probe ?? defaultProbe;
    this.isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
    this.snapshot = {
      level: "checking",
      latencyMs: null,
      lastOkAt: null,
      failures: 0,
      online: this.isOnline(),
      checking: false,
      blips: 0,
    };
    this.snapshot = { ...this.snapshot, level: this.levelFor(this.snapshot) };
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private levelFor(s: Omit<ConnectionSnapshot, "level"> & { level?: ConnectionLevel }): ConnectionLevel {
    return deriveLevel({
      online: s.online,
      failures: s.failures,
      latencyMs: s.latencyMs,
      lastOkAt: s.lastOkAt,
      streamsEverOpened: this.streamsEverOpened,
      streams: this.streams,
      streamsZeroSince: this.streamsZeroSince,
      now: Date.now(),
      slowMs: this.slowMs,
      streamGraceMs: this.streamGraceMs,
    });
  }

  private update(patch: Partial<ConnectionSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    next.level = this.levelFor(next);
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /** The app's live streams report in, so a stream that stays down shows as reconnecting. */
  streamOpened() {
    this.streams += 1;
    this.streamsEverOpened = true;
    this.streamsZeroSince = null;
    clearTimeout(this.graceTimer);
    this.update({});
  }

  streamClosed() {
    this.streams = Math.max(0, this.streams - 1);
    if (this.streams === 0) {
      this.streamsZeroSince = Date.now();
      clearTimeout(this.graceTimer);
      this.graceTimer = setTimeout(() => this.update({}), this.streamGraceMs + 50);
    }
    this.update({});
  }

  /** Checks right now; a check already out is shared. */
  check(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run() {
    if (!this.isOnline()) {
      this.update({ online: false, checking: false });
      return;
    }
    this.update({ online: true, checking: true });
    const started = performance.now();
    let ok = false;
    try {
      ok = await this.probe(this.timeoutMs);
    } catch {
      ok = false;
    }
    const latencyMs = Math.round(performance.now() - started);
    if (ok) {
      this.update({
        checking: false,
        failures: 0,
        latencyMs,
        lastOkAt: Date.now(),
        blips: this.snapshot.blips + 1,
      });
    } else {
      this.update({ checking: false, failures: this.snapshot.failures + 1 });
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    const delay = this.snapshot.failures > 0 ? Math.min(this.intervalMs, this.retryMs) : this.intervalMs;
    this.timer = setTimeout(() => {
      if (document.visibilityState === "hidden") {
        this.schedule();
        return;
      }
      void this.check().finally(() => {
        if (this.users > 0) this.schedule();
      });
    }, delay);
  }

  /** Starts checking while something shows it; returns the stop function. */
  start(): () => void {
    this.users += 1;
    if (this.users === 1) {
      const onOnline = () => {
        this.update({ online: true });
        void this.check().finally(() => this.schedule());
      };
      const onOffline = () => this.update({ online: false });
      const onVisible = () => {
        if (document.visibilityState === "visible") void this.check().finally(() => this.schedule());
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVisible);
      this.teardown = () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVisible);
        clearTimeout(this.timer);
        clearTimeout(this.graceTimer);
      };
      void this.check().finally(() => this.schedule());
    }
    return () => {
      this.users = Math.max(0, this.users - 1);
      if (this.users === 0) {
        this.teardown?.();
        this.teardown = null;
      }
    };
  }
}

export const connectionMonitor = new ConnectionMonitor();
