import { useCallback } from "react";
import { multiviewOpenPreference } from "../../../lib/preferences/multiview-pref";
import { screenDockPreference } from "../../../lib/screen-dock";

/** Whether Multiview or the screen above the chat is showing. */
export function useShellViewModes({
  inGroup,
  hasActiveBot,
  navigate,
  setMobileSidebarOpen,
}: {
  inGroup: boolean;
  hasActiveBot: boolean;
  navigate: (path: string) => void;
  setMobileSidebarOpen: (open: boolean) => void;
}) {
  const multiviewOpen = multiviewOpenPreference.use();
  const toggleMultiview = useCallback(() => {
    setMobileSidebarOpen(false);
    multiviewOpenPreference.set(!multiviewOpenPreference.get());
  }, [setMobileSidebarOpen]);
  // Opening a bot's chat leaves Multiview.
  const openBot = useCallback(
    (id: string) => {
      multiviewOpenPreference.set(false);
      navigate(`/app/${id}`);
    },
    [navigate],
  );
  const selectBot = useCallback(
    (id: string) => {
      setMobileSidebarOpen(false);
      openBot(id);
    },
    [openBot, setMobileSidebarOpen],
  );
  const screenDockOn = screenDockPreference.use();
  // Multiview shows screens of its own, so the dock steps aside while it is open.
  const screenDockActive = screenDockOn && !multiviewOpen && !inGroup && hasActiveBot;
  return { multiviewOpen, toggleMultiview, screenDockActive, openBot, selectBot };
}
