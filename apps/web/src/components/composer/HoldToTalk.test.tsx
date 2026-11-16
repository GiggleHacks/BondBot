// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { voiceNotes } from "../../lib/voice-notes/voice-notes";
import {
  HoldToTalkControls,
  HoldToTalkStrip,
  STRAY_TAP_MS,
  TAP_MS,
  useHoldToTalk,
} from "./HoldToTalk";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

vi.mock("../../lib/rpc", () => ({ selectedSpaceId: () => "space-1" }));

vi.mock("../../lib/voice-notes/voice-notes", () => ({
  voiceNotes: {
    subscribe: vi.fn(() => () => {}),
    record: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    state: { recording: null },
    busy: false,
  },
}));

let talkRef: ReturnType<typeof useHoldToTalk> | null = null;

function Harness() {
  const talk = useHoldToTalk({ target: { botId: "bot-1" } });
  talkRef = talk;
  return (
    <div>
      <HoldToTalkStrip talk={talk} />
      <HoldToTalkControls talk={talk} />
    </div>
  );
}

describe("voice note button", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const button = (label: string) =>
    container!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

  it("starts recording on one tap and keeps recording without holding", () => {
    act(() => button("Record voice note")!.click());
    expect(voiceNotes.record).toHaveBeenCalledWith({
      spaceId: "space-1",
      target: { botId: "bot-1" },
    });
    expect(container!.querySelector('[data-testid="hold-to-talk-strip"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(voiceNotes.stop).not.toHaveBeenCalled();
    expect(button("Stop and send recording")).not.toBeNull();
  });

  it("stops and sends when the red button is tapped", () => {
    act(() => button("Record voice note")!.click());
    act(() => vi.advanceTimersByTime(STRAY_TAP_MS + 100));
    act(() => button("Stop and send recording")!.click());
    expect(voiceNotes.stop).toHaveBeenCalledWith(true);
    expect(container!.querySelector('[data-testid="hold-to-talk-strip"]')).toBeNull();
  });

  it("ignores the second half of a double tap", () => {
    act(() => button("Record voice note")!.click());
    act(() => button("Stop and send recording")!.click());
    expect(voiceNotes.stop).not.toHaveBeenCalled();
    expect(button("Stop and send recording")).not.toBeNull();
  });

  it("discards with the trash button", () => {
    act(() => button("Record voice note")!.click());
    act(() => button("Discard recording")!.click());
    expect(voiceNotes.stop).toHaveBeenCalledWith(false);
  });

  it("supports keyboard push-to-talk: a short press locks, a long press sends", () => {
    act(() => talkRef!.startHeld());
    act(() => talkRef!.release(TAP_MS - 50));
    expect(button("Stop and send recording")).not.toBeNull();
    act(() => vi.advanceTimersByTime(STRAY_TAP_MS + 100));
    act(() => talkRef!.submit());
    expect(voiceNotes.stop).toHaveBeenCalledWith(true);

    act(() => talkRef!.startHeld());
    act(() => vi.advanceTimersByTime(STRAY_TAP_MS + 100));
    act(() => talkRef!.release(TAP_MS + 500));
    expect(voiceNotes.stop).toHaveBeenCalledTimes(2);
  });
});
