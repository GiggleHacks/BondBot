/** One tick per this many streamed characters, so a fast stream ticks faster than a slow one. */
const CHARS_PER_TICK = 24;
const MAX_TICKS_PER_CHUNK = 3;
/** Closest two ticks may sit, in seconds: a flood of text stays a patter, never a buzz. */
const MIN_GAP = 0.12;
/** How far ahead ticks are scheduled. When text stops arriving, the ticks stop this soon after. */
const HORIZON = 0.45;
const FIRST_CHUNK_SPREAD = 0.15;
const JITTER = 0.015;

export type TickState = { nextFree: number; lastArrival: number | null };

export const idleTicks: TickState = { nextFree: 0, lastArrival: null };

/**
 * Audio-clock times for the ticks a chunk of `chars` streamed characters gets, spread across the
 * gap expected before the next chunk (the gap since the last one).
 */
export function planTicks(
  chars: number,
  now: number,
  state: TickState,
  random: () => number = Math.random,
): { times: number[]; state: TickState } {
  if (chars <= 0) return { times: [], state };
  const count = Math.min(MAX_TICKS_PER_CHUNK, Math.max(1, Math.round(chars / CHARS_PER_TICK)));
  const spread =
    state.lastArrival === null
      ? FIRST_CHUNK_SPREAD
      : Math.min(HORIZON, Math.max(MIN_GAP, now - state.lastArrival));
  const step = Math.max(MIN_GAP, spread / count);
  const start = Math.max(now, state.nextFree);
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const previous = times.at(-1);
    const at = Math.max(
      start + i * step + random() * JITTER,
      previous === undefined ? 0 : previous + MIN_GAP,
    );
    if (at > now + HORIZON) break;
    times.push(at);
  }
  const last = times.at(-1);
  return {
    times,
    state: { nextFree: last === undefined ? state.nextFree : last + MIN_GAP, lastArrival: now },
  };
}

/** Another of `count` versions than the one just played, so a sound never repeats back to back. */
export function nextVariant(count: number, last: number, random: () => number = Math.random) {
  if (count < 2) return 0;
  if (last < 0) return Math.floor(random() * count);
  return (last + 1 + Math.floor(random() * (count - 1))) % count;
}
