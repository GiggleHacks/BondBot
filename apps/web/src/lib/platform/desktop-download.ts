import { useQuery } from "@tanstack/react-query";

export type DesktopBuild = {
  platform: "windows" | "mac";
  href: string;
  fileName: string;
};

const WINDOWS: DesktopBuild = {
  platform: "windows",
  href: "/api/desktop/windows",
  fileName: "BondBot.exe",
};
const MAC: DesktopBuild = { platform: "mac", href: "/api/desktop/mac", fileName: "BondBot.dmg" };

/** True on a Mac only: an iPad sends the same desktop Safari agent, but has a touch screen. */
export function isMac(agent: string, touchPoints: number): boolean {
  return /macintosh/i.test(agent) && touchPoints <= 1;
}

/** The builds to offer, this visitor's first. The Mac one appears only when the server has it. */
export function useDesktopBuilds(): DesktopBuild[] {
  const { data: hasMacBuild } = useQuery({
    queryKey: ["desktop-download", "mac"],
    queryFn: async ({ signal }) => (await fetch(MAC.href, { method: "HEAD", signal })).ok,
  });
  if (!hasMacBuild) return [WINDOWS];
  return isMac(navigator.userAgent, navigator.maxTouchPoints) ? [MAC, WINDOWS] : [WINDOWS, MAC];
}
