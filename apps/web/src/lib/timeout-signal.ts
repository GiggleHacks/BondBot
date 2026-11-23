// Local addition: AbortSignal.timeout is missing on iOS < 16 and old Chrome; this works everywhere.
/**
 * A signal that aborts after `ms` (or when `parent` aborts). Call `clear` once the request is
 * done so the timer does not outlive it.
 */
export function timeoutSignal(
  ms: number,
  parent?: AbortSignal | null,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  if (parent) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  const clear = () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  };
  return { signal: controller.signal, clear };
}
