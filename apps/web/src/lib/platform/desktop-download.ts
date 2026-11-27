// Which desktop build to offer on the settings screen. The download routes answer 404 when the
// operator never dropped that build on the server, so this only decides what is worth showing.

export type DesktopPlatform = "mac" | "windows" | "linux";

/**
 * The visitor's platform, from the user agent alone. iPadOS reports a desktop Safari agent, but a
 * tablet runs neither the Mac nor the Windows build, so it answers linux and shows both.
 */
export function desktopPlatformFrom(agent: string): DesktopPlatform {
  // Phones and tablets run neither build; iOS also says "like Mac OS X", so check it first.
  if (/iphone|ipod|ipad|android/i.test(agent)) return "linux";
  if (/windows/i.test(agent)) return "windows";
  if (/macintosh|mac os x/i.test(agent)) return "mac";
  return "linux";
}

export function currentDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return "linux";
  return desktopPlatformFrom(navigator.userAgent);
}
