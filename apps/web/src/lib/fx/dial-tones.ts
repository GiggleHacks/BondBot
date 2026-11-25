// Local addition (BondBot): dial-up phone sounds for typing a PIN. Each digit plays its real
// touch-tone (DTMF) pair; a finished PIN plays a short modem handshake. Synthesized with Web Audio,
// so there are no sound files. Quiet by design, and silent where audio is unavailable.

/** Low and high frequency (Hz) of each key's touch-tone. */
const DTMF: Record<string, readonly [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "0": [941, 1336],
};

const VOLUME = 0.07;

let context: AudioContext | null = null;

/** The shared audio context, created on first use (inside the key press that needs it). */
function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    // Audio is a nicety; a browser that refuses it just stays silent.
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, length: number, gain: GainNode) {
  const oscillator = ctx.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  oscillator.start(start);
  oscillator.stop(start + length);
  return oscillator;
}

/** An output with a short fade in and out, so tones do not click. */
function envelope(ctx: AudioContext, start: number, length: number, level = VOLUME) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.008);
  gain.gain.setValueAtTime(level, start + length - 0.015);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(ctx.destination);
  return gain;
}

/**
 * The touch-tone for one PIN digit, `delay` seconds from now. Anything that is not a digit plays
 * nothing.
 */
export function playDialTone(digit: string, delay = 0): void {
  const pair = DTMF[digit];
  const ctx = pair ? audio() : null;
  if (!pair || !ctx) return;
  const start = ctx.currentTime + delay;
  const length = 0.12;
  const gain = envelope(ctx, start, length);
  for (const frequency of pair) tone(ctx, frequency, start, length, gain);
}

/** A short dial-up modem handshake: answer tone, warbling negotiation, then static. */
export function playModemHandshake(): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  // Answer tone.
  tone(ctx, 2100, t, 0.35, envelope(ctx, t, 0.35, VOLUME * 0.8));
  // Negotiation: two carriers whose pitch jumps around every few milliseconds.
  const warble = envelope(ctx, t + 0.4, 0.7, VOLUME * 0.7);
  for (const [base, spread] of [
    [1200, 500],
    [2400, 700],
  ] as const) {
    const oscillator = tone(ctx, base, t + 0.4, 0.7, warble);
    oscillator.type = "square";
    for (let step = 0; step < 70; step++) {
      oscillator.frequency.setValueAtTime(
        base + (Math.random() - 0.5) * spread,
        t + 0.4 + step * 0.01,
      );
    }
  }
  // Static as the line settles.
  const length = 0.45;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  band.Q.value = 0.8;
  noise.connect(band);
  band.connect(envelope(ctx, t + 1.1, length, VOLUME * 0.6));
  noise.start(t + 1.1);
}
