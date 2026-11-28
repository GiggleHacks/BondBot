// Local addition (David, 2026-11-21): the docked screen above the chat.
import { createStoredPreference } from "./preferences/stored-preference";

/** Whether the live screen is docked above the chat, on this device. */
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

/** A wide window has the room for a larger screen than a phone does. */
export function defaultDockHeight(viewportHeight: number, phone: boolean): number {
  return clampDockHeight(viewportHeight * (phone ? 0.32 : 0.45), viewportHeight);
}
