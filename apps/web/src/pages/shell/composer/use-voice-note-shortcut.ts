import type { RefObject } from "react";
import { useRef } from "react";
import { hasOpenDialog } from "../../../lib/platform/has-open-dialog";
import { useEventListener } from "../../../lib/use-event-listener";
import { isApplePlatform, isEditableTarget, primaryModifier } from "../shell-shortcuts";
import type { useHoldToTalk } from "./hold-to-talk";

export function useVoiceNoteShortcut({
  talk,
  available,
  textareaRef,
}: {
  talk: ReturnType<typeof useHoldToTalk>;
  available: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // Cmd/Ctrl+D records a voice note like the mic button: tap to record hands-free (press
  // again to send), or hold to talk and release to send. Escape discards. The field hides
  // while recording, so the keys are heard window-wide.
  const dictateKey = useRef({ talk, available: false, downAt: 0 });
  dictateKey.current = { talk, available, downAt: dictateKey.current.downAt };
  useEventListener(window, "keydown", (event) => {
    const { talk, available } = dictateKey.current;
    if (talk.recording && event.key === "Escape" && !hasOpenDialog(document)) {
      event.preventDefault();
      talk.cancel();
      return;
    }
    if (event.repeat || event.altKey || event.shiftKey || event.key?.toLowerCase() !== "d") return;
    if (!primaryModifier(event, isApplePlatform())) return;
    if (talk.recording) {
      // Pressed while typing elsewhere, it belongs to that field rather than this recording.
      if (!talk.recording.locked) return;
      if (isEditableTarget(event.target) || hasOpenDialog(document)) return;
      event.preventDefault();
      talk.submit();
    } else if (
      available &&
      (document.activeElement === textareaRef.current ||
        (!isEditableTarget(event.target) && !hasOpenDialog(document)))
    ) {
      event.preventDefault();
      dictateKey.current.downAt = Date.now();
      talk.startHeld();
    }
  });
  const releaseTalkKey = () => {
    const { talk, downAt } = dictateKey.current;
    if (!downAt || !talk.recording || talk.recording.locked) return;
    dictateKey.current.downAt = 0;
    talk.release(Date.now() - downAt);
  };
  useEventListener(window, "keyup", (event) => {
    const key = event.key?.toLowerCase();
    if (key !== "d" && key !== "control" && key !== "meta") return;
    releaseTalkKey();
  });
  // The keyup never arrives when the window loses focus or the page hides while the key is
  // held (alt-tab, a call, the screen locking): let go as if it had.
  useEventListener(window, "blur", releaseTalkKey);
  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") releaseTalkKey();
  });
}
