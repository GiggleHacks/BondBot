import type { ProductEvent } from "@rakazo/contracts";
import { bestEffort } from "@rakazo/logging/best-effort";
import attentionUrl from "./assets/attention.m4a";
import errorUrl from "./assets/error.m4a";
import sentUrl from "./assets/sent.m4a";
import workingUrl from "./assets/working.m4a";
import type { ChatSoundCue } from "./chat-sound-events";
import { chatSoundFor } from "./chat-sound-events";
import type { TickState } from "./tick-plan";
import { idleTicks, planTicks } from "./tick-plan";

const CUE_URLS: Record<ChatSoundCue, string> = {
  sent: sentUrl,
  working: workingUrl,
  attention: attentionUrl,
  error: errorUrl,
};

/** A cue for the same chat inside this window plays once, whichever stream reported it first. */
const REPEAT_MS: Record<ChatSoundCue, number> = {
  sent: 300,
  working: 1_200,
  attention: 5_000,
  error: 5_000,
};

const TICK_PEAK = 0.1;
const TICK_FREQS = [2_100, 2_400, 1_900];
const TOCK_FREQS = [950, 1_050, 1_000];

/** A relay tick: a short noise snap over a ringing body that dies in a few milliseconds. */
function renderTick(ctx: BaseAudioContext, freq: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.round(rate * 0.012);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const fadeFrom = length - Math.round(rate * 0.002);
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const snap = (Math.random() * 2 - 1) * Math.exp(-t / 0.0004) * 0.4;
    const body =
      Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.0015) +
      0.35 * Math.sin(2 * Math.PI * freq * 1.63 * t) * Math.exp(-t / 0.0009);
    const fade = i < fadeFrom ? 1 : (length - i) / (length - fadeFrom);
    data[i] = (snap + body) * fade;
    peak = Math.max(peak, Math.abs(data[i] ?? 0));
  }
  for (let i = 0; i < length; i += 1) data[i] = (data[i] ?? 0) / (peak || 1);
  return buffer;
}

class ChatSounds {
  private enabled = false;
  private ctx: AudioContext | null = null;
  private output: AudioNode | null = null;
  private cues = new Map<ChatSoundCue, Promise<AudioBuffer>>();
  private ticks: AudioBuffer[] = [];
  private tocks: AudioBuffer[] = [];
  private tickState: TickState = idleTicks;
  private nextIsTock = false;
  private lastPlayed = new Map<string, number>();

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Browsers start audio only after a gesture, so the shell calls this from one. */
  unlock() {
    if (!this.enabled) return;
    const ctx = this.context();
    if (ctx?.state === "suspended") void bestEffort("resume chat sounds", ctx.resume());
  }

  /** A sound for a live event in the open chat. */
  threadEvent(
    event: Pick<ProductEvent, "type" | "payload" | "createdAt" | "threadId">,
    meId: string | undefined,
  ) {
    if (!this.enabled) return;
    const sound = chatSoundFor(event, meId);
    if (!sound) return;
    if ("cue" in sound) this.play(sound.cue, event.threadId);
    else this.streamed(sound.streamed);
  }

  play(cue: ChatSoundCue, threadId: string) {
    const ctx = this.running();
    if (!ctx) return;
    const key = `${threadId}:${cue}`;
    const now = Date.now();
    if (now - (this.lastPlayed.get(key) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS[cue]) return;
    this.lastPlayed.set(key, now);
    void bestEffort(
      "play chat sound",
      this.cue(ctx, cue).then((buffer) => this.start(ctx, buffer, ctx.currentTime, 1)),
    );
  }

  private streamed(chars: number) {
    const ctx = this.running();
    if (!ctx) return;
    const planned = planTicks(chars, ctx.currentTime, this.tickState);
    this.tickState = planned.state;
    for (const at of planned.times) {
      const bank = this.nextIsTock ? this.tocks : this.ticks;
      this.nextIsTock = !this.nextIsTock;
      const buffer = bank[Math.floor(Math.random() * bank.length)];
      if (buffer) this.start(ctx, buffer, at, TICK_PEAK * (0.6 + Math.random() * 0.4));
    }
  }

  private start(ctx: AudioContext, buffer: AudioBuffer, at: number, level: number) {
    if (!this.output) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = level;
    source.connect(gain).connect(this.output);
    source.start(at);
  }

  private cue(ctx: AudioContext, cue: ChatSoundCue): Promise<AudioBuffer> {
    let loading = this.cues.get(cue);
    if (!loading) {
      loading = fetch(CUE_URLS[cue])
        .then((response) => response.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes));
      // A failed load is tried again next time.
      loading.catch(() => this.cues.delete(cue));
      this.cues.set(cue, loading);
    }
    return loading;
  }

  /** Sounds made before the first gesture would all burst out at once when it comes. */
  private running(): AudioContext | null {
    if (!this.enabled) return null;
    const ctx = this.context();
    return ctx?.state === "running" ? ctx : null;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === "undefined") return null;
    const ctx = new AudioContext();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5_000;
    lowpass.connect(ctx.destination);
    this.ctx = ctx;
    this.output = lowpass;
    this.ticks = TICK_FREQS.map((freq) => renderTick(ctx, freq));
    this.tocks = TOCK_FREQS.map((freq) => renderTick(ctx, freq));
    return ctx;
  }
}

export const chatSounds = new ChatSounds();
