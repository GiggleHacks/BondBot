import { Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { lazy, Suspense, useState } from "react";
import { BONDBOT_VERSION } from "../lib/bondbot-version";
import { useBondbotUpdate } from "./bondbot-update/BondbotUpdateProvider";
import { QuakeText } from "./brand/QuakeText";

const LazyBondBotUpdatePopover = lazy(() =>
  import("./bondbot-update/BondBotUpdatePopover").then((mod) => ({
    default: mod.BondBotUpdatePopover,
  })),
);

// Local addition (David, 2026-11-20): the BondBot wordmark drawn with the Quake 1 console font.
/** BONDBOT and its version at the top left of the sidebar; only the B when the sidebar is collapsed. */
export function BondBotMark({ mini = false }: { mini?: boolean }) {
  const update = useBondbotUpdate();
  const [open, setOpen] = useState(false);

  const showDot = Boolean(update?.showNotificationDot);
  const targetVersion =
    update?.availability?.latestUiVersion ?? update?.availability?.latestApiVersion ?? null;
  const label =
    showDot && targetVersion
      ? `BondBot v${BONDBOT_VERSION}, update to v${targetVersion} available`
      : `BondBot v${BONDBOT_VERSION}`;

  const markContent = (
    <>
      <style>{`.bb-mark{filter:brightness(.55)}html[data-theme="dark"] .bb-mark{filter:brightness(1.7)}.bb-ver{opacity:.75}`}</style>
      <div
        className="relative flex w-fit select-none flex-col gap-1"
        title={label}
        data-testid="bondbot-mark"
      >
        <QuakeText text={mini ? "B" : "BONDBOT"} zoom={mini ? 3 : 2} className="bb-mark" />
        {mini ? null : (
          <QuakeText text={`V${BONDBOT_VERSION}`} zoom={1} className="bb-mark bb-ver" />
        )}
        {showDot ? (
          <span
            data-testid="bondbot-update-dot"
            aria-hidden="true"
            className={`pointer-events-none absolute -top-0.5 ${mini ? "-end-0.5" : "-end-2"} size-2 rounded-full bg-destructive ring-2 ring-background`}
          />
        ) : null}
      </div>
    </>
  );

  if (!update?.canOpenPopover) {
    return <div className="app-no-drag flex">{markContent}</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid="bondbot-mark-trigger"
            className="app-no-drag relative -m-1 rounded-md p-1 text-start transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {markContent}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-auto p-3.5">
        <Suspense
          fallback={
            <div className="w-64 py-2 text-caption text-muted-foreground">
              Checking BondBot updates...
            </div>
          }
        >
          <LazyBondBotUpdatePopover update={update} onClose={() => setOpen(false)} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
