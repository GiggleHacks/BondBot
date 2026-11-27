import { describe, expect, it } from "vitest";
import { desktopPlatformFrom } from "../../lib/platform/desktop-download";

describe("desktopPlatformFrom", () => {
  it("reads the platform from the user agent", () => {
    expect(desktopPlatformFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(desktopPlatformFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(desktopPlatformFrom("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
  it("treats iPadOS' desktop Safari agent as neither desktop platform", () => {
    expect(desktopPlatformFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile")).toBe("mac");
    expect(desktopPlatformFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("linux");
  });
});
