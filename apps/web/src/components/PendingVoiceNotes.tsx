// Local addition (David, 2026-11-21): a voice note shows in the chat the moment you let go, thin like the
// player, with its status underneath: waiting for connection, sending, then transcribing (animated).
import { Mic, RotateCcw, Trash2, WifiOff } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { formatVoiceTime, placeholderPeaks, VOICE_NOTE_BARS } from "../lib/voice-note";
import type { VoiceNoteTarget } from "../lib/voice-notes/store";
import { voiceNotes } from "../lib/voice-notes/voice-notes";

type Phase = "waiting" | "sending" | "transcribing" | "failed";

type Row = {
  key: string;
  durationMs: number;
  phase: Phase;
  status: string;
  onRetry?: () => void;
  onDelete?: () => void;
};

function sameTarget(a: VoiceNoteTarget, b: ArtifactTarget): boolean {
  return "groupId" in a
    ? "groupId" in b && a.groupId === b.groupId
    : "botId" in b && a.botId === b.botId;
}

const STYLES = `
@keyframes vnwave{0%,100%{opacity:.22}50%{opacity:1}}
@keyframes vndot{0%,100%{opacity:.2}40%{opacity:1}}
.vn-bar{animation:vnwave 1.1s ease-in-out infinite}
.vn-dot{animation:vndot 1.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.vn-bar,.vn-dot{animation:none!important}}
`;

/** Voice notes of this chat that are not in it yet, drawn as the bubbles they are about to become. */
export function PendingVoiceNotes({ target }: { target: ArtifactTarget }) {
  const state = useSyncExternalStore(voiceNotes.subscribe, voiceNotes.getSnapshot);
  useEffect(() => voiceNotes.start(), []);

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const note of state.queue) {
    if (!sameTarget(note.target, target)) continue;
    seen.add(note.clientId);
    const progress = state.progress[note.clientId];
    const failed = note.state === "failed";
    const waiting = !failed && !state.online;
    rows.push({
      key: note.clientId,
      durationMs: note.durationMs,
      phase: failed ? "failed" : waiting ? "waiting" : "sending",
      status: failed
        ? (note.error ?? "Could not send")
        : waiting
          ? "Offline · will send when connected"
          : note.state === "uploading" && progress !== undefined
            ? `Sending ${Math.round(progress * 100)}%`
            : note.retryAt
              ? "Will retry soon"
              : "Sending…",
      onRetry: failed ? () => void voiceNotes.retry(note.clientId) : undefined,
      onDelete: () => void voiceNotes.discard(note.clientId),
    });
  }
  for (const note of state.server) {
    if (!sameTarget(note.target, target) || seen.has(note.clientId)) continue;
    seen.add(note.clientId);
    const failed = note.status === "failed";
    const stalled = !failed && Boolean(note.error);
    rows.push({
      key: note.clientId,
      durationMs: note.durationMs,
      phase: failed || stalled ? "failed" : note.status === "sending" ? "sending" : "transcribing",
      status: failed
        ? (note.error ?? "Could not transcribe")
        : stalled
          ? `Retrying: ${note.error}`
          : note.status === "sending"
            ? "Sending…"
            : note.segmentsTotal > 1
              ? `Transcribing ${note.segmentsDone}/${note.segmentsTotal}`
              : "Transcribing",
      onRetry: failed ? () => void voiceNotes.retryOnServer(note.clientId) : undefined,
      onDelete:
        failed || stalled || note.status === "queued"
          ? () => void voiceNotes.deleteOnServer(note.clientId)
          : undefined,
    });
  }
  // Let go a moment ago: the device is still closing the recording, so say it is on its way.
  for (const note of state.finishing) {
    if (!sameTarget(note.target, target) || seen.has(note.clientId)) continue;
    rows.push({
      key: note.clientId,
      durationMs: note.durationMs,
      phase: state.online ? "sending" : "waiting",
      status: state.online ? "Sending…" : "Offline · will send when connected",
    });
  }

  const keys = rows.map((row) => row.key).join(",");
  const last = useRef<HTMLDivElement>(null);
  const shown = useRef("");
  // A new note brings the end of the chat into view.
  useEffect(() => {
    const fresh = keys.split(",").filter((key) => key && !shown.current.split(",").includes(key));
    shown.current = keys;
    if (fresh.length > 0) last.current?.scrollIntoView({ block: "end" });
  }, [keys]);

  if (rows.length === 0) return null;
  return (
    <div data-testid="pending-voice-notes" className="flex flex-col gap-2">
      <style>{STYLES}</style>
      {rows.map((row, at) => {
        const live = row.phase === "sending" || row.phase === "transcribing";
        const peaks = placeholderPeaks(row.key, VOICE_NOTE_BARS);
        return (
          <div
            key={row.key}
            ref={at === rows.length - 1 ? last : undefined}
            data-testid="pending-voice-note"
            data-phase={row.phase}
            className="flex flex-col items-end gap-0.5"
          >
            <div className="flex w-[260px] max-w-full select-none items-center gap-2.5 rounded-2xl bg-chat-user px-2.5 py-1.5 text-chat-user-foreground">
              <span
                aria-hidden="true"
                className={`grid size-8 shrink-0 place-items-center rounded-full bg-chat-user-foreground text-chat-user ${row.phase === "waiting" ? "opacity-60" : ""}`}
              >
                {row.phase === "waiting" ? (
                  <WifiOff className="size-4" strokeWidth={2} />
                ) : (
                  <Mic className="size-4" strokeWidth={2} />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex h-5 items-center gap-[2px]" aria-hidden="true">
                  {peaks.map((peak, index) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed bar order
                      key={index}
                      data-live={live ? "" : undefined}
                      className={`block min-w-[2px] max-w-[4px] flex-1 rounded-full bg-current ${live ? "vn-bar" : "opacity-40"}`}
                      style={{
                        height: `${Math.round(peak * 100)}%`,
                        animationDelay: live ? `${index * 35}ms` : undefined,
                      }}
                    />
                  ))}
                </div>
                <div className="flex h-3.5 items-center text-[11px] leading-none tabular-nums opacity-80">
                  {formatVoiceTime(Math.max(1, Math.round(row.durationMs / 1000)))}
                </div>
              </div>
            </div>
            <div
              data-testid="pending-voice-status"
              aria-live="polite"
              className={`flex max-w-full items-center gap-1.5 pe-1 text-[11px] leading-4 ${row.phase === "failed" ? "text-destructive" : "text-muted-foreground"}`}
            >
              <span className="truncate">{row.status}</span>
              {row.phase === "transcribing" ? (
                <span aria-hidden="true" className="inline-flex gap-[2px]">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="vn-dot size-[3px] rounded-full bg-current"
                      style={{ animationDelay: `${dot * 180}ms` }}
                    />
                  ))}
                </span>
              ) : null}
              {row.onRetry ? (
                <button
                  type="button"
                  aria-label="Retry voice note"
                  onClick={row.onRetry}
                  className="grid size-5 place-items-center rounded-full hover:bg-accent"
                >
                  <RotateCcw size={12} strokeWidth={1.8} />
                </button>
              ) : null}
              {row.onDelete ? (
                <button
                  type="button"
                  aria-label="Delete voice note"
                  onClick={row.onDelete}
                  className="grid size-5 place-items-center rounded-full hover:bg-accent"
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
