import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { AudioLines, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { ArtifactTarget } from "../../lib/artifact-open";
import type { VoiceNoteTarget } from "../../lib/voice-notes/store";
import { voiceNotes } from "../../lib/voice-notes/voice-notes";

// Local change (David, 2026-11-21): pending voice notes show in the chat now (PendingVoiceNotes).
const SHOW_IN_COMPOSER = false;

function sameTarget(a: VoiceNoteTarget, b: ArtifactTarget): boolean {
  return "groupId" in a
    ? "groupId" in b && a.groupId === b.groupId
    : "botId" in b && a.botId === b.botId;
}

function length(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type Row = {
  key: string;
  durationMs: number;
  status: string;
  failed: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
};

/**
 * Voice notes of this chat that are not in it yet: waiting for a connection, uploading,
 * or being transcribed. Each leaves the list when its message appears in the chat.
 */
export function VoiceNoteQueue({ target }: { target: ArtifactTarget }) {
  const { t } = useLingui();
  const state = useSyncExternalStore(voiceNotes.subscribe, voiceNotes.getSnapshot);
  useEffect(() => voiceNotes.start(), []);

  const rows: Row[] = [];
  for (const note of state.queue) {
    if (!sameTarget(note.target, target)) continue;
    const progress = state.progress[note.clientId];
    const failed = note.state === "failed";
    rows.push({
      key: `local:${note.clientId}`,
      durationMs: note.durationMs,
      failed,
      status: failed
        ? (note.error ?? t`Could not send`)
        : !state.online
          ? t`Waiting for connection`
          : note.state === "uploading" && progress !== undefined
            ? t`Sending ${Math.round(progress * 100)}%`
            : note.retryAt
              ? t`Will retry soon`
              : t`Sending…`,
      onRetry: failed ? () => void voiceNotes.retry(note.clientId) : undefined,
      onDelete: () => void voiceNotes.discard(note.clientId),
    });
  }
  for (const note of state.server) {
    if (!sameTarget(note.target, target)) continue;
    if (state.queue.some((local) => local.clientId === note.clientId)) continue;
    const failed = note.status === "failed";
    // A note still being worked on that hit an error waits for an automatic retry; say why.
    const stalled = !failed && Boolean(note.error);
    rows.push({
      key: `server:${note.clientId}`,
      durationMs: note.durationMs,
      failed: failed || stalled,
      status: failed
        ? (note.error ?? t`Could not transcribe`)
        : stalled
          ? t`Retrying: ${note.error}`
          : note.status === "sending"
            ? t`Sending…`
            : note.segmentsTotal > 1
              ? t`Transcribing ${note.segmentsDone}/${note.segmentsTotal}`
              : t`Transcribing…`,
      onRetry: failed ? () => void voiceNotes.retryOnServer(note.clientId) : undefined,
      onDelete:
        failed || stalled || note.status === "queued"
          ? () => void voiceNotes.deleteOnServer(note.clientId)
          : undefined,
    });
  }
  if (!SHOW_IN_COMPOSER || rows.length === 0) return null;
  return (
    <ul data-testid="voice-note-queue" className="mb-2 flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-1.5 text-label"
        >
          <AudioLines size={14} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
          <span className="shrink-0 tabular-nums text-foreground/80">{length(row.durationMs)}</span>
          <span
            className={`min-w-0 flex-1 truncate ${row.failed ? "text-destructive" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {row.status}
          </span>
          {row.onRetry ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t`Retry voice note`}
              onClick={row.onRetry}
              className="size-6 shrink-0 rounded-full"
            >
              <RotateCcw size={13} strokeWidth={1.8} />
            </Button>
          ) : null}
          {row.onDelete ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t`Delete voice note`}
              onClick={row.onDelete}
              className="size-6 shrink-0 rounded-full text-muted-foreground"
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
