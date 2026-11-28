import { buttonVariants } from "@rakazo/ui-web";
import { SettingsGroup } from "../../components/settings/SettingsRows";
import { useDesktopBuilds } from "../../lib/platform/desktop-download";

const DESKTOP_BUILD_COPY = {
  windows: {
    title: "BondBot for Windows",
    description: "Portable desktop app with its own icon and window — drop it anywhere and run.",
  },
  mac: {
    title: "BondBot for macOS",
    description: "Open the disk image and drag BondBot to Applications.",
  },
};

export function DesktopDownloadSettings() {
  return (
    <SettingsGroup title="Desktop app" data-testid="desktop-download">
      {useDesktopBuilds().map(({ platform, href, fileName }) => (
        <div key={platform} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/brand/bondbot-robot.png"
              alt="BondBot"
              className="size-10 shrink-0 rounded-lg border border-border object-cover [image-rendering:pixelated]"
            />
            <div className="min-w-0">
              <div className="text-body font-medium text-foreground">
                {DESKTOP_BUILD_COPY[platform].title}
              </div>
              <div className="text-body-sm text-muted-foreground">
                {DESKTOP_BUILD_COPY[platform].description}
              </div>
            </div>
          </div>
          <a
            href={href}
            download={fileName}
            className={`${buttonVariants({ variant: "secondary", size: "sm" })} shrink-0`}
          >
            Download {fileName}
          </a>
        </div>
      ))}
    </SettingsGroup>
  );
}
