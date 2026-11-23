// Local addition (David, 2026-11-20): Telegram-style voice note player for audio attachments.
import { Spinner } from "@rakazo/ui-web";
import { Download, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { fetchArtifactBytes } from "../lib/artifact-open";
import {
  formatVoiceTime,
  nextVoiceSpeed,
  peaksFromSamples,
  placeholderPeaks,
  seekFraction,
  VOICE_NOTE_BARS,
} from "../lib/voice-note";

// Bigger notes wait for the play button instead of loading as they scroll into view.
const AUTOLOAD_MAX_BYTES = 8 * 1024 * 1024;

// Only one voice note plays at a time, and the speed you chose sticks for the next one.
let current: { pause: () => void } | null = null;
let sharedSpeed = 1;

async function analyse(bytes: Uint8Array): Promise<{ peaks: number[]; duration: number } | null> {
  if (typeof AudioContext === "undefined") return null;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice().buffer);
    return {
      peaks: peaksFromSamples(decoded.getChannelData(0), VOICE_NOTE_BARS),
      duration: decoded.duration,
    };
  } catch {
    return null;
  } finally {
    void context.close().catch(() => {});
  }
}

export function VoiceNotePlayer({
  target,
  artifactId,
  name,
  mimeType,
  size,
  fromUser = false,
  onDownload,
}: {
  target: ArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
  fromUser?: boolean;
  onDownload: () => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const controller = useRef({ pause: () => audio.current?.pause() });
  const life = useRef({ gone: false, loading: false, url: undefined as string | undefined });
  const playWhenReady = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [src, setSrc] = useState<string>();
  const [peaks, setPeaks] = useState<number[]>(() => placeholderPeaks(artifactId, VOICE_NOTE_BARS));
  const [analysed, setAnalysed] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(sharedSpeed);

  const duration = (() => {
    const element = audio.current?.duration;
    if (analysed !== null && Number.isFinite(analysed) && analysed > 0) return analysed;
    return element !== undefined && Number.isFinite(element) ? element : 0;
  })();
  const fraction = duration > 0 ? Math.min(1, time / duration) : 0;

  useEffect(() => {
    const state = life.current;
    state.gone = false;
    return () => {
      state.gone = true;
      if (state.url) URL.revokeObjectURL(state.url);
      if (current === controller.current) current = null;
    };
  }, []);

  const load = useCallback(
    async (thenPlay: boolean) => {
      const state = life.current;
      if (state.loading || state.gone || state.url) return;
      state.loading = true;
      if (thenPlay) playWhenReady.current = true;
      setStatus("loading");
      try {
        const bytes = await fetchArtifactBytes(target, artifactId);
        if (state.gone) return;
        state.url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
        const result = await analyse(bytes);
        if (state.gone) return;
        if (result) {
          setPeaks(result.peaks);
          setAnalysed(result.duration);
        }
        setSrc(state.url);
        setStatus("ready");
      } catch {
        if (!state.gone) setStatus("error");
      } finally {
        state.loading = false;
      }
    },
    [target, artifactId, mimeType],
  );

  // Load as the note scrolls into view, so its real waveform and length are there before it is played.
  useEffect(() => {
    if (size > AUTOLOAD_MAX_BYTES) return;
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      void load(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load(false);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [load, size]);

  // A smooth progress bar while playing: timeupdate alone only fires a few times a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = audio.current;
      if (element) setTime(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const play = useCallback(async () => {
    const element = audio.current;
    if (!element) return;
    if (current && current !== controller.current) current.pause();
    current = controller.current;
    element.playbackRate = sharedSpeed;
    try {
      await element.play();
    } catch {
      // The browser refused to start it; the button stays on play.
    }
  }, []);

  useEffect(() => {
    if (status !== "ready" || !playWhenReady.current) return;
    playWhenReady.current = false;
    void play();
  }, [status, play]);

  const toggle = () => {
    if (status === "idle" || status === "error") {
      void load(true);
      return;
    }
    const element = audio.current;
    if (!element || status !== "ready") return;
    if (element.paused) void play();
    else element.pause();
  };

  const seekTo = (fractionValue: number) => {
    const element = audio.current;
    if (!element || duration <= 0) return;
    element.currentTime = fractionValue * duration;
    setTime(element.currentTime);
    setStarted(true);
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo(seekFraction(event.clientX, rect.left, rect.width));
  };

  const cycleSpeed = () => {
    const next = nextVoiceSpeed(speed);
    sharedSpeed = next;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const playedBars = Math.round(fraction * peaks.length);
  const label = started ? `${formatVoiceTime(time)} / ${formatVoiceTime(duration)}` : formatVoiceTime(duration);
  const colors = fromUser
    ? "bg-chat-user text-chat-user-foreground"
    : "bg-muted text-foreground";
  const buttonColors = fromUser ? "bg-chat-user-foreground text-chat-user" : "bg-foreground text-muted";
  const pillColors = fromUser ? "bg-chat-user-foreground/25" : "bg-foreground/15";

  return (
    <div
      ref={root}
      title={name}
      data-testid="voice-note"
      className={`flex w-[260px] max-w-full select-none items-center gap-2.5 rounded-2xl px-2.5 py-1.5 ${colors}`}
    >
      <button
        type="button"
        aria-label={playing ? `Pause voice note` : `Play voice note`}
        aria-busy={status === "loading"}
        onClick={toggle}
        className={`grid size-8 shrink-0 place-items-center rounded-full ${buttonColors}`}
      >
        {status === "loading" && !src ? (
          <Spinner aria-label={`Loading voice note…`} />
        ) : playing ? (
          <Pause className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Play className="ms-0.5 size-4 fill-current" aria-hidden="true" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* biome-ignore lint/a11y/useSemanticElements: a draggable waveform is a custom slider. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Voice note position`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={label}
          className="flex h-5 cursor-pointer items-center gap-[2px] [touch-action:none]"
          onPointerDown={(event) => {
            if (status !== "ready") {
              toggle();
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons) seekFromPointer(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") seekTo(Math.min(1, (time + 5) / Math.max(duration, 1)));
            else if (event.key === "ArrowLeft") seekTo(Math.max(0, (time - 5) / Math.max(duration, 1)));
            else if (event.key === " " || event.key === "Enter") toggle();
            else return;
            event.preventDefault();
          }}
        >
          {peaks.map((peak, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed bar order
              key={index}
              aria-hidden="true"
              className={`block min-w-[2px] max-w-[4px] flex-1 rounded-full bg-current ${
                index < playedBars ? "opacity-100" : "opacity-40"
              }`}
              style={{ height: `${Math.round(peak * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] leading-none tabular-nums">
          <span className="opacity-80">
            {status === "error" ? `Could not load. Tap play to retry.` : label}
          </span>
          <span className="flex items-center gap-2">
            {started ? (
              <button
                type="button"
                aria-label={`Playback speed ${speed}×`}
                onClick={cycleSpeed}
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${pillColors}`}
              >
                {speed}×
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`Download ${name}`}
              onClick={() => void onDownload()}
              className="opacity-70 hover:opacity-100"
            >
              <Download className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: Voice notes have no caption track. */}
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setStarted(false);
          setTime(0);
          if (audio.current) audio.current.currentTime = 0;
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={() => setTime((value) => value)}
        onError={() => setStatus("error")}
        className="hidden"
      />
    </div>
  );
}
