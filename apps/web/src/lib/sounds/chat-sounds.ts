import type { ProductEvent } from "@rakazo/contracts";
import { bestEffort } from "@rakazo/logging/best-effort";
import type { ChatSoundKind } from "../preferences/chat-sound-mutes-pref";
import { mutedChatSoundsPreference } from "../preferences/chat-sound-mutes-pref";
import attentionUrl from "./assets/attention.m4a";
import errorUrl from "./assets/error.m4a";
import sentUrl from "./assets/sent.m4a";
import sentUrl2 from "./assets/sent-2.m4a";
import sentUrl3 from "./assets/sent-3.m4a";
import sentUrl4 from "./assets/sent-4.m4a";
import workingUrl from "./assets/working.m4a";
import workingUrl2 from "./assets/working-2.m4a";
import workingUrl3 from "./assets/working-3.m4a";
import workingUrl4 from "./assets/working-4.m4a";
import type { ChatSoundCue } from "./chat-sound-events";
import { chatSoundFor } from "./chat-sound-events";
import type { TickState } from "./tick-plan";
import { idleTicks, nextVariant, planTicks } from "./tick-plan";

/** The everyday cues have several versions. The two that ask for you stay recognisable. */
const CUE_URLS: Record<ChatSoundCue, string[]> = {
  sent: [sentUrl, sentUrl2, sentUrl3, sentUrl4],
  working: [workingUrl, workingUrl2, workingUrl3, workingUrl4],
  attention: [attentionUrl],
  error: [errorUrl],
};

const CUE_KINDS: Record<ChatSoundCue, ChatSoundKind> = {
  sent: "sent",
  working: "tools",
  attention: "alerts",
  error: "alerts",
};
/** The sounds that only keep you company play far under the ones that ask for you. */
const CUE_LEVELS: Record<ChatSoundCue, number> = {
  sent: 0.6,
  working: 0.25,
  attention: 1,
  error: 1,
};

const muted = (kind: ChatSoundKind) => mutedChatSoundsPreference.get().includes(kind);

/** A cue for the same chat inside this window plays once, whichever stream reported it first. */
const REPEAT_MS: Record<ChatSoundCue, number> = {
  sent: 300,
  working: 1_200,
  attention: 5_000,
  error: 5_000,
};

/** Barely there: thinking should be noticed only if you listen for it. */
const TICK_PEAK = 0.022;
/** Four sets of relay ticks and tocks. Each burst of thinking uses one set. */
const TICK_SETS = [
  { ticks: [2_100, 2_400, 1_900], tocks: [950, 1_050, 1_000] },
  { ticks: [1_700, 1_900, 1_600], tocks: [760, 850, 810] },
  { ticks: [2_500, 2_800, 2_300], tocks: [1_150, 1_250, 1_200] },
  { ticks: [1_450, 1_650, 1_350], tocks: [660, 720, 690] },
];
/** A pause this long, in seconds, ends a burst, and the next may sound different. */
const BURST_GAP = 2;

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
  private cues = new Map<string, Promise<AudioBuffer>>();
  private lastVariant = new Map<ChatSoundCue, number>();
  private tickSets: { ticks: AudioBuffer[]; tocks: AudioBuffer[] }[] = [];
  private tickSet = -1;
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
    if (!ctx || muted(CUE_KINDS[cue])) return;
    const key = `${threadId}:${cue}`;
    const now = Date.now();
    if (now - (this.lastPlayed.get(key) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS[cue]) return;
    this.lastPlayed.set(key, now);
    void bestEffort(
      "play chat sound",
      this.cue(ctx, cue).then((buffer) =>
        this.start(ctx, buffer, ctx.currentTime, CUE_LEVELS[cue]),
      ),
    );
  }

  private streamed(chars: number) {
    const ctx = this.running();
    if (!ctx || muted("thinking")) return;
    const { lastArrival } = this.tickState;
    if (lastArrival === null || ctx.currentTime - lastArrival > BURST_GAP)
      this.tickSet = nextVariant(this.tickSets.length, this.tickSet);
    const set = this.tickSets[this.tickSet];
    if (!set) return;
    const planned = planTicks(chars, ctx.currentTime, this.tickState);
    this.tickState = planned.state;
    for (const at of planned.times) {
      const bank = this.nextIsTock ? set.tocks : set.ticks;
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
    const urls = CUE_URLS[cue];
    const variant = nextVariant(urls.length, this.lastVariant.get(cue) ?? -1);
    this.lastVariant.set(cue, variant);
    const url = urls[variant]!;
    let loading = this.cues.get(url);
    if (!loading) {
      loading = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes));
      // A failed load is tried again next time.
      loading.catch(() => this.cues.delete(url));
      this.cues.set(url, loading);
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
    this.tickSets = TICK_SETS.map(({ ticks, tocks }) => ({
      ticks: ticks.map((freq) => renderTick(ctx, freq)),
      tocks: tocks.map((freq) => renderTick(ctx, freq)),
    }));
    return ctx;
  }
}

export const chatSounds = new ChatSounds();
