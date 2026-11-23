// Local addition (David, 2026-11-21): the phone's Back gesture closes the top open layer (menu,
// side panel, settings window, computer window, full screen) instead of leaving the app.
// Each open layer owns one browser history entry; closing a layer in the app removes its entry.
import { useEffect, useId, useRef } from "react";

type Layer = { id: string; close: () => void };

const stack: Layer[] = [];
// The href when each of our entries was added, to recognise one the router replaced in place.
const pushedHrefs: string[] = [];
let entries = 0;
let ignorePops = 0;
let scheduled = false;
let listening = false;

function depthOf(state: unknown): number {
  const depth = (state as { rkDepth?: unknown } | null)?.rkDepth;
  return typeof depth === "number" ? depth : 0;
}

function onPop() {
  if (ignorePops > 0) {
    ignorePops -= 1;
    return;
  }
  // The person went back (or forward) to an entry of this depth; layers above it are gone.
  entries = Math.min(entries, depthOf(window.history.state));
  pushedHrefs.length = Math.min(pushedHrefs.length, entries);
  while (stack.length > entries) stack.pop()?.close();
  // Landing on an old marker with no layer left (a forward step, say) must not look like one.
  if (depthOf(window.history.state) > stack.length) {
    window.history.replaceState({ ...window.history.state, rkDepth: stack.length }, "");
    entries = stack.length;
  }
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // A reload keeps the old entry's marker, but nothing of this page's is open yet.
  if (depthOf(window.history.state) > 0) {
    window.history.replaceState({ ...window.history.state, rkDepth: 0 }, "");
  }
  window.addEventListener("popstate", onPop);
}

function reconcile() {
  scheduled = false;
  const want = stack.length;
  if (entries < want) {
    while (entries < want) {
      entries += 1;
      pushedHrefs[entries - 1] = window.location.href;
      window.history.pushState({ ...window.history.state, rkDepth: entries }, "");
    }
    return;
  }
  if (entries > want) {
    const extra = entries - want;
    const topIsOurs = depthOf(window.history.state) === entries;
    // The router replaced our entry's address in place, leaving a copy of the page below it.
    const replacedInPlace = !topIsOurs && window.location.href === pushedHrefs[entries - 1];
    entries = want;
    pushedHrefs.length = want;
    if (topIsOurs || replacedInPlace) {
      ignorePops += 1;
      window.history.go(-extra);
    }
    // Otherwise the router moved on; the old entries stay behind, harmlessly.
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(reconcile);
}

export function openLayer(id: string, close: () => void) {
  ensureListening();
  const known = stack.find((layer) => layer.id === id);
  if (known) {
    known.close = close;
    return;
  }
  stack.push({ id, close });
  schedule();
}

export function closeLayer(id: string) {
  const at = stack.findIndex((layer) => layer.id === id);
  if (at < 0) return;
  stack.splice(at, 1);
  schedule();
}

/** While `open`, the Back gesture calls `close` (the newest open layer first). */
export function useBackLayer(open: boolean, close: () => void, enabled = true) {
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!enabled || !open) return;
    openLayer(id, () => closeRef.current());
    return () => closeLayer(id);
  }, [id, open, enabled]);
}

// Start listening as soon as the app loads, so a marker left by a reload is cleared at once.
ensureListening();
