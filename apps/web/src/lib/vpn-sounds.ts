export type VpnSoundKind = "vpn-on" | "vpn-off" | "lock-on" | "lock-off" | "error";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

/** Call synchronously inside a click handler so the AudioContext stays unlocked after async RPCs. */
export function primeVpnAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

interface ToneStep {
  freq: number;
  delay: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
}

function scheduleChime(ctx: AudioContext, steps: readonly ToneStep[], cutoffHz: number): void {
  const now = ctx.currentTime;
  const masterFilter = ctx.createBiquadFilter();
  masterFilter.type = "lowpass";
  masterFilter.frequency.setValueAtTime(cutoffHz, now);
  masterFilter.Q.setValueAtTime(0.7, now);
  masterFilter.connect(ctx.destination);

  for (const step of steps) {
    const start = now + step.delay;
    const stop = start + step.duration;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = step.type ?? "sine";
    osc.frequency.setValueAtTime(step.freq, start);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(step.gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);

    osc.connect(env);
    env.connect(masterFilter);
    osc.start(start);
    osc.stop(stop + 0.02);
  }
}

/**
 * Plays a dark, Windows 11-inspired crystalline chime for VPN and Kill Switch state transitions.
 */
export function playVpnSound(kind: VpnSoundKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }

  switch (kind) {
    case "vpn-on":
      // Warm ascending crystalline fifth + octave (D4 undertone, D5 -> A5)
      scheduleChime(
        ctx,
        [
          { freq: 293.66, delay: 0, duration: 0.24, gain: 0.06, type: "triangle" },
          { freq: 587.33, delay: 0, duration: 0.2, gain: 0.11, type: "sine" },
          { freq: 880.0, delay: 0.075, duration: 0.3, gain: 0.12, type: "sine" },
        ],
        2400,
      );
      break;
    case "vpn-off":
      // Calm descending dark resolution (F#5 -> B4)
      scheduleChime(
        ctx,
        [
          { freq: 739.99, delay: 0, duration: 0.18, gain: 0.095, type: "sine" },
          { freq: 493.88, delay: 0.08, duration: 0.26, gain: 0.105, type: "sine" },
          { freq: 246.94, delay: 0.08, duration: 0.24, gain: 0.045, type: "triangle" },
        ],
        1900,
      );
      break;
    case "lock-on":
      // Grounded, reassuring lock double-chime (E4 -> B4 + E5)
      scheduleChime(
        ctx,
        [
          { freq: 329.63, delay: 0, duration: 0.11, gain: 0.09, type: "triangle" },
          { freq: 493.88, delay: 0.06, duration: 0.22, gain: 0.1, type: "sine" },
          { freq: 659.25, delay: 0.06, duration: 0.24, gain: 0.075, type: "sine" },
        ],
        2100,
      );
      break;
    case "lock-off":
      // Soft release (B4 -> E4)
      scheduleChime(
        ctx,
        [
          { freq: 493.88, delay: 0, duration: 0.14, gain: 0.08, type: "sine" },
          { freq: 329.63, delay: 0.065, duration: 0.2, gain: 0.085, type: "triangle" },
        ],
        1600,
      );
      break;
    case "error":
      scheduleChime(
        ctx,
        [
          { freq: 261.63, delay: 0, duration: 0.12, gain: 0.08, type: "triangle" },
          { freq: 196.0, delay: 0.07, duration: 0.18, gain: 0.08, type: "triangle" },
        ],
        1200,
      );
      break;
  }
}
