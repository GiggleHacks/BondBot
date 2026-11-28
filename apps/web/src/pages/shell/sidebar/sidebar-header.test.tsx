// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarHeader } from "./sidebar-header";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));
vi.mock("../app-rail", () => ({ useAppRail: () => false }));
vi.mock("../../../components/BondBotMark", () => ({ BondBotMark: () => <span>mark</span> }));
vi.mock("../../../components/WindowChrome", () => ({
  WindowChrome: () => <span data-testid="window-chrome" />,
}));
vi.mock("../bots/bot-picker", () => ({ BotCreatePicker: () => null }));

afterEach(() => {
  delete window.rakazoDesktop;
});

it.each([
  ["linux", true, false],
  ["win32", true, false],
  ["darwin", undefined, true],
  ["linux", false, true],
] as const)(
  "on %s with a native frame %s, reserves room for window controls: %s",
  (platform, nativeWindowFrame, reserved) => {
    window.rakazoDesktop = { platform, nativeWindowFrame } as unknown as Window["rakazoDesktop"];
    const props = { bots: [] } as unknown as ComponentProps<typeof SidebarHeader>;
    const html = renderToStaticMarkup(<SidebarHeader {...props} />);
    expect(html.includes('data-testid="window-chrome"')).toBe(reserved);
  },
);
