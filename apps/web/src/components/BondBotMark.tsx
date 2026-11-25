import { BONDBOT_VERSION } from "../lib/bondbot-version";
import { QuakeText } from "./brand/QuakeText";

// Local addition (David, 2026-11-20): the BondBot wordmark drawn with the Quake 1 console font.
/** BONDBOT and its version at the top left of the sidebar; only the B when the sidebar is collapsed. */
export function BondBotMark({ mini = false }: { mini?: boolean }) {
  return (
    <>
      <style>{`.bb-mark{filter:brightness(.55)}html[data-theme="dark"] .bb-mark{filter:brightness(1.7)}.bb-ver{opacity:.75}`}</style>
      <div
        className="app-no-drag flex select-none flex-col gap-1"
        title={`BondBot v${BONDBOT_VERSION}`}
        data-testid="bondbot-mark"
      >
        <QuakeText text={mini ? "B" : "BONDBOT"} zoom={mini ? 3 : 2} className="bb-mark" />
        {mini ? null : (
          <QuakeText text={`V${BONDBOT_VERSION}`} zoom={1} className="bb-mark bb-ver" />
        )}
      </div>
    </>
  );
}
