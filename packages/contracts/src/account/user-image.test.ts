import { expect, it } from "vitest";
import { isUserImageValue } from "./user-image.js";

it("accepts no photo, an https photo, or a small uploaded image", () => {
  expect(isUserImageValue(null)).toBe(true);
  expect(isUserImageValue("")).toBe(true);
  expect(isUserImageValue("https://example.test/me.png")).toBe(true);
  expect(isUserImageValue("data:image/webp;base64,UklGRg==")).toBe(true);
});

it("rejects other schemes, other data types and oversized uploads", () => {
  expect(isUserImageValue("http://example.test/me.png")).toBe(false);
  expect(isUserImageValue("javascript:alert(1)")).toBe(false);
  expect(isUserImageValue("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  expect(isUserImageValue(`data:image/png;base64,${"A".repeat(200_000)}`)).toBe(false);
});
