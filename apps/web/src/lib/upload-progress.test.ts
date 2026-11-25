import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSpeed, SpeedTracker, xhrSend } from "./upload-progress";

class FakeXhr {
  static nextStatus = 200;
  static nextResponseText = '{"ok":true}';
  static nextContentType: string | null = "application/json";
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = "";
  withCredentials = false;
  responseType = "";
  timeout = 0;
  aborted = false;
  headers: Record<string, string> = {};
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open() {}
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  getResponseHeader(k: string) {
    return k.toLowerCase() === "content-type" ? FakeXhr.nextContentType : null;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  send() {
    queueMicrotask(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = FakeXhr.nextStatus;
      this.responseText = FakeXhr.nextResponseText;
      this.onload?.();
    });
  }
}

describe("upload-progress", () => {
  const originalXhr = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXhr;
    FakeXhr.instances = [];
    FakeXhr.nextStatus = 200;
    FakeXhr.nextResponseText = '{"ok":true}';
    FakeXhr.nextContentType = "application/json";
  });

  it("resolves cleanly on HTTP 204 No Content without throwing", async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    FakeXhr.nextStatus = 204;
    FakeXhr.nextResponseText = "";
    FakeXhr.nextContentType = null;
    const onProgress = vi.fn();
    const res = await xhrSend({ url: "/api/voice-notes/test/parts/0", method: "PUT", onProgress });
    expect(res.status).toBe(204);
    expect(res.ok).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  it("resolves JSON response and cleans up abort listener", async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const res = await xhrSend({
      url: "/rpc/artifacts/create",
      method: "POST",
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeSpy).toHaveBeenCalled();
  });

  it("tracks smoothed speed and formats units", () => {
    const tracker = new SpeedTracker();
    expect(tracker.sample(0, 1000, 1000).bps).toBe(0);
    const second = tracker.sample(500, 1000, 1500);
    expect(second.fraction).toBe(0.5);
    expect(second.bps).toBe(1000);
    expect(formatSpeed(second.bps)).toBe("1.0 KB/s");
    expect(formatSpeed(2_500_000)).toBe("2.5 MB/s");
  });
});
