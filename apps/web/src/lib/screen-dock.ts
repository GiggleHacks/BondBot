// Local addition (David, 2026-11-21): the phone's docked screen above the chat.
import { createStoredPreference } from "./stored-preference";

/** Whether the live screen is docked above the chat on a phone. */
export const screenDockPreference = createStoredPreference<boolean>({
  key: "rakazo.screenDock",
  parse: (raw) => raw === "on",
  serialize: (on) => (on ? "on" : "off"),
});

/** The docked screen's height in pixels; 0 means "not chosen yet". */
export const screenDockHeightPreference = createStoredPreference<number>({
  key: "rakazo.screenDockHeight",
  parse: (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  },
  serialize: (height) => String(Math.round(height)),
});

export const DOCK_MIN_HEIGHT = 84;

/** Keeps the screen from swallowing the chat: at most 70% of the view, 40% while the keyboard is up. */
export function clampDockHeight(height: number, viewportHeight: number): number {
  const ratio = viewportHeight < 520 ? 0.4 : 0.7;
  const max = Math.max(DOCK_MIN_HEIGHT, Math.round(viewportHeight * ratio));
  return Math.min(max, Math.max(DOCK_MIN_HEIGHT, Math.round(height)));
}

export function defaultDockHeight(viewportHeight: number): number {
  return clampDockHeight(viewportHeight * 0.32, viewportHeight);
}
