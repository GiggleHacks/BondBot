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
  LOCK_DISTANCE_PX,
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

function Harness() {
  const talk = useHoldToTalk({ target: { botId: "bot-1" } });
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

  const mic = () =>
    container!.querySelector<HTMLButtonElement>('[aria-label="Record voice note"]')!;
  const pointer = (type: string, clientY = 100) =>
    new PointerEvent(type, { bubbles: true, button: 0, clientY, pointerId: 1 });

  it("records while held and sends on release", () => {
    act(() => {
      mic().dispatchEvent(pointer("pointerdown"));
    });
    expect(voiceNotes.record).toHaveBeenCalledWith({
      spaceId: "space-1",
      target: { botId: "bot-1" },
    });
    expect(container!.querySelector('[data-testid="hold-to-talk-strip"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(TAP_MS + 50));
    act(() => {
      mic().dispatchEvent(pointer("pointerup"));
    });
    expect(voiceNotes.stop).toHaveBeenCalledWith(true);
    expect(container!.querySelector('[data-testid="hold-to-talk-strip"]')).toBeNull();
  });

  it("keeps recording hands-free after a tap, then sends or discards by hand", () => {
    act(() => {
      mic().dispatchEvent(pointer("pointerdown"));
      mic().dispatchEvent(pointer("pointerup"));
    });
    expect(voiceNotes.stop).not.toHaveBeenCalled();
    const send = container!.querySelector<HTMLButtonElement>('[aria-label="Send recording"]');
    expect(send).not.toBeNull();
    act(() => send!.click());
    expect(voiceNotes.stop).toHaveBeenCalledWith(true);

    act(() => {
      mic().dispatchEvent(pointer("pointerdown"));
      mic().dispatchEvent(pointer("pointerup"));
    });
    act(() =>
      container!.querySelector<HTMLButtonElement>('[aria-label="Discard recording"]')!.click(),
    );
    expect(voiceNotes.stop).toHaveBeenLastCalledWith(false);
  });

  it("stops and sends when the red mic is tapped again", () => {
    act(() => {
      mic().dispatchEvent(pointer("pointerdown"));
      mic().dispatchEvent(pointer("pointerup"));
    });
    const stop = container!.querySelector<HTMLButtonElement>(
      '[aria-label="Stop and send recording"]',
    );
    expect(stop).not.toBeNull();
    act(() => stop!.click());
    expect(voiceNotes.stop).toHaveBeenCalledWith(true);
    expect(container!.querySelector('[aria-label="Stop and send recording"]')).toBeNull();
  });

  it("locks when slid up while held", () => {
    act(() => {
      mic().dispatchEvent(pointer("pointerdown", 200));
    });
    act(() => {
      mic().dispatchEvent(pointer("pointermove", 200 - LOCK_DISTANCE_PX));
    });
    expect(container!.querySelector('[aria-label="Send recording"]')).not.toBeNull();
    expect(voiceNotes.stop).not.toHaveBeenCalled();
  });
});
