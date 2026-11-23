// Local addition (David, 2026-11-20): helpers for the Telegram-style voice note player.
export const VOICE_NOTE_BARS = 40;
export const VOICE_SPEEDS = [1, 1.5, 2] as const;

export function formatVoiceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Bar heights in 0.12..1 from the loudness of each slice of the decoded audio. */
export function peaksFromSamples(samples: ArrayLike<number>, bars: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / bars));
  const step = Math.max(1, Math.floor(size / 200));
  const raw = Array.from({ length: bars }, (_, index) => {
    const start = index * size;
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    let count = 0;
    for (let at = start; at < end; at += step) {
      sum += samples[at] * samples[at];
      count += 1;
    }
    return count ? Math.sqrt(sum / count) : 0;
  });
  const max = Math.max(...raw, 1e-6);
  return raw.map((value) => Math.max(0.12, Math.min(1, (value / max) ** 0.6)));
}

/** A stable stand-in waveform, drawn until the real one is ready. */
export function placeholderPeaks(seed: string, bars: number): number[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: bars }, (_, index) => {
    hash = Math.imul(hash ^ (index + 1), 2246822519) >>> 0;
    const unit = (hash % 1000) / 1000;
    return 0.22 + 0.55 * unit * (0.6 + 0.4 * Math.sin(index / 3) ** 2);
  });
}

export function seekFraction(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(1, (clientX - left) / width));
}

export function nextVoiceSpeed(current: number): number {
  const at = VOICE_SPEEDS.findIndex((speed) => speed === current);
  return VOICE_SPEEDS[(at + 1) % VOICE_SPEEDS.length] ?? 1;
}
