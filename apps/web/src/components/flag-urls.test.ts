import { describe, expect, it } from "vitest";
import { flagUrl } from "./flag-urls";

describe("flag files", () => {
  it("has a flag for countries beyond the drawn ones and none for an unknown one", () => {
    expect(flagUrl("MX")).toBeTruthy();
    expect(flagUrl("UN")).toBeUndefined();
    expect(flagUrl("WG")).toBeUndefined();
  });
});
