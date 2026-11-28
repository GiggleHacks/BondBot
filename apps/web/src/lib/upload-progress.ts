/** Upload meter helpers: real byte progress and speed, not a spinner. */

export type Meter = {
  fraction: number;
  loaded: number;
  total: number;
  bps: number;
};

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps < 1) return "";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 10_000) return `${Math.round(bps / 1000)} KB/s`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export class SpeedTracker {
  private at = 0;
  private loaded = 0;
  private bps = 0;

  sample(loaded: number, total: number, now = Date.now()): Meter {
    if (this.at > 0 && now > this.at && loaded >= this.loaded) {
      const instant = ((loaded - this.loaded) / (now - this.at)) * 1000;
      this.bps = this.bps > 0 ? this.bps * 0.6 + instant * 0.4 : instant;
    }
    this.at = now;
    this.loaded = loaded;
    const fraction = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : 0;
    return { fraction, loaded, total, bps: this.bps };
  }
}

export function xhrSend(input: {
  url: string;
  method: string;
  headers?: HeadersInit;
  body?: XMLHttpRequestBodyInit | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(input.method, input.url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.timeout = input.timeoutMs ?? 180_000;
    const headers = new Headers(input.headers);
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      xhr.abort();
      fail(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      input.signal?.removeEventListener("abort", onAbort);
    };
    if (input.signal) {
      if (input.signal.aborted) {
        fail(new DOMException("Aborted", "AbortError"));
        return;
      }
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.onload = () => {
      cleanup();
      try {
        const nullBody = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
        const headers: Record<string, string> = {};
        const contentType = xhr.getResponseHeader("content-type");
        if (contentType) headers["content-type"] = contentType;
        resolve(
          new Response(nullBody ? null : xhr.responseText, {
            status: xhr.status,
            headers,
          }),
        );
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => fail(new TypeError("Failed to fetch"));
    xhr.ontimeout = () => fail(new Error("The request timed out."));
    xhr.onabort = () => fail(new DOMException("Aborted", "AbortError"));
    xhr.send(input.body ?? null);
  });
}
