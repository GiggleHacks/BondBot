import { useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import { Button, cn } from "@rakazo/ui-web";
import { ArrowUp, Mic, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { selectedSpaceId } from "../../lib/rpc";
import { voiceNotes } from "../../lib/voice-notes/voice-notes";
import { IconTooltip } from "../IconTooltip";

/** A Ctrl/Cmd+D press shorter than this is a tap: it keeps recording hands-free. */
export const TAP_MS = 350;
/** Taps on stop this soon after starting are the tail of a double tap and are ignored. */
export const STRAY_TAP_MS = 500;
const HINT_MS = 2_500;

type Recording = { locked: boolean; startedAt: number } | null;

/**
 * Voice notes: tap the mic to start recording, tap the red button in its place to stop and
 * send (Ctrl/Cmd+D also supports hold-to-talk). Nothing is transcribed
 * while recording: the note is stored on the device, uploaded when there is a
 * connection, and transcribed by the server after it arrives.
 */
export function useHoldToTalk({
  target,
  disabled,
}: {
  target: ArtifactTarget;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState<Recording>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordingRef = useRef(recording);
  const targetRef = useRef(target);
  targetRef.current = target;
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), HINT_MS);
  }, []);

  const clear = useCallback(() => {
    recordingRef.current = null;
    setRecording(null);
  }, []);

  // The hour limit (or another tab) can end the recording without this composer.
  useEffect(
    () =>
      voiceNotes.subscribe(() => {
        if (recordingRef.current && !voiceNotes.state.recording && !voiceNotes.busy) clear();
      }),
    [clear],
  );

  // Start the upload queue even where the chat's pending-note list is not on the page.
  useEffect(() => voiceNotes.start(), []);

  // The recorder reports a recording that could not be saved or was cut off (a call, a headset).
  useEffect(() => voiceNotes.subscribeNotice(showNotice), [showNotice]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      // Leaving mid-recording keeps what was said: it is sent like a release.
      if (recordingRef.current) void voiceNotes.stop(true);
    },
    [],
  );

  const start = useCallback(
    (locked: boolean) => {
      setNotice(null);
      const next = { locked, startedAt: Date.now() };
      recordingRef.current = next;
      setRecording(next);
      voiceNotes
        .record({ spaceId: selectedSpaceId(), target: targetRef.current })
        .catch((error: unknown) => {
          clear();
          showNotice(
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Allow microphone access to record"
              : "Could not start recording",
          );
        });
    },
    [clear, showNotice],
  );

  const submit = useCallback(() => {
    if (!recordingRef.current) return;
    // A double tap's second half lands on the stop button; that is not "stop".
    if (Date.now() - recordingRef.current.startedAt < STRAY_TAP_MS) return;
    clear();
    void voiceNotes.stop(true);
  }, [clear]);

  const cancel = useCallback(() => {
    if (!recordingRef.current) return;
    clear();
    void voiceNotes.stop(false);
  }, [clear]);

  const lock = useCallback(() => {
    const current = recordingRef.current;
    if (!current) return;
    const next = { ...current, locked: true };
    recordingRef.current = next;
    setRecording(next);
  }, []);

  const startHandsFree = useCallback(() => {
    if (disabled || recordingRef.current) return;
    start(true);
  }, [disabled, start]);

  /** Push-to-talk from the keyboard: starts unlocked; `release` decides tap or hold. */
  const startHeld = useCallback(() => {
    if (disabled || recordingRef.current) return;
    start(false);
  }, [disabled, start]);

  /** A short press keeps recording hands-free; a long one sends on release. */
  const release = useCallback(
    (heldMs: number) => {
      if (!recordingRef.current || recordingRef.current.locked) return;
      if (heldMs < TAP_MS) lock();
      else submit();
    },
    [lock, submit],
  );

  return {
    recording,
    /** Transcription happens on the server after sending, never while recording. */
    transcribing: false,
    transcript: "",
    notice,
    submit,
    cancel,
    startHandsFree,
    startHeld,
    release,
    buttonProps: {
      // A tap starts recording hands-free. It acts on click (after the finger lifts), so the
      // red stop button that takes the mic's place never receives this same tap.
      onClick: () => startHandsFree(),
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
  };
}

function useSeconds(since: number, active: boolean): number {
  // Ticks only while recording; the strip is mounted all the time.
  const now = useNow(active ? 500 : null);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/** Takes the text field's place while recording: a live dot, the time, and what was heard. */
export function HoldToTalkStrip({ talk }: { talk: ReturnType<typeof useHoldToTalk> }) {
  const startedAt = talk.recording?.startedAt ?? Date.now();
  const seconds = useSeconds(startedAt, talk.recording !== null);
  if (!talk.recording) return null;
  const hint = talk.recording.locked ? "Recording… tap the red button to send" : "Release to send";
  return (
    <div
      data-testid="hold-to-talk-strip"
      className="flex min-h-6 min-w-0 flex-1 items-center gap-2.5 py-0.5 text-body"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 animate-pulse rounded-full bg-destructive"
      />
      <span className="shrink-0 tabular-nums text-foreground/80">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <span
        className={cn("truncate", talk.transcript ? "text-foreground" : "text-muted-foreground")}
        dir="auto"
        aria-live="polite"
      >
        {talk.transcript || hint}
      </span>
    </div>
  );
}

/** The microphone button, plus the lock target above it and Cancel/Send once locked. */
export function HoldToTalkControls({
  talk,
  disabled,
}: {
  talk: ReturnType<typeof useHoldToTalk>;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { recording } = talk;
  if (recording?.locked) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Discard recording`}
          onClick={talk.cancel}
          className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </Button>
        {/* The mic stays where it was, now red: tapping it again stops and sends. */}
        <Button
          size="icon"
          aria-label="Stop and send recording"
          onClick={talk.submit}
          className="size-8 shrink-0 animate-pulse rounded-full bg-destructive-fill text-destructive-foreground shadow-sm hover:bg-destructive-fill/90"
        >
          <Square size={11} strokeWidth={0} fill="currentColor" />
        </Button>
        <Button
          size="icon"
          aria-label={t`Send recording`}
          onClick={talk.submit}
          className="size-8 shrink-0 rounded-full shadow-sm"
        >
          <ArrowUp size={16} strokeWidth={2.2} />
        </Button>
      </>
    );
  }
  return (
    <span className="relative inline-flex">
      {talk.notice && !recording ? (
        <span
          role="status"
          className="pointer-events-none absolute bottom-full end-0 mb-2 w-max max-w-64 rounded-lg border border-border bg-card px-2.5 py-1.5 text-label text-foreground shadow-md"
        >
          {talk.notice}
        </span>
      ) : null}
      <IconTooltip label="Tap to record">
        <Button
          variant="outline"
          size="icon"
          aria-label="Record voice note"
          disabled={disabled}
          {...talk.buttonProps}
          className={cn(
            "size-8 shrink-0 touch-none select-none rounded-full text-foreground/75 [-webkit-touch-callout:none]",
            // The pointer is over the button while holding, so the outline variant's hover
            // colours (a grey fill in dark, dark text) must not win over the recording red.
            recording &&
              "scale-125 border-destructive-fill bg-destructive-fill text-destructive-foreground hover:bg-destructive-fill hover:text-destructive-foreground dark:hover:bg-destructive-fill",
          )}
        >
          <Mic size={16} strokeWidth={1.8} />
        </Button>
      </IconTooltip>
    </span>
  );
}
