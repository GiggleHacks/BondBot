import { BONDBOT_VERSION } from "../lib/bondbot-version";

// Local addition (David, 2026-11-20): the BondBot wordmark drawn with the Quake 1 console font.
const GLYPHS = "/brand/conchars.png";

function QuakeText({ text, zoom, className }: { text: string; zoom: number; className?: string }) {
  return (
    <span role="img" aria-label={text} className={`flex shrink-0 ${className ?? ""}`}>
      {[...text].map((ch, i) => {
        const code = ch.charCodeAt(0);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed glyph order
            key={i}
            aria-hidden="true"
            style={{
              width: 8 * zoom,
              height: 8 * zoom,
              flex: "none",
              backgroundImage: `url(${GLYPHS})`,
              backgroundSize: `${128 * zoom}px ${128 * zoom}px`,
              backgroundPosition: `-${(code & 15) * 8 * zoom}px -${(code >> 4) * 8 * zoom}px`,
              imageRendering: "pixelated",
            }}
          />
        );
      })}
    </span>
  );
}

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
        {mini ? null : <QuakeText text={`V${BONDBOT_VERSION}`} zoom={1} className="bb-mark bb-ver" />}
      </div>
    </>
  );
}
