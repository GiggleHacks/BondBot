// Local addition (BondBot): text drawn with the Quake 1 console font sprite sheet.
import type { CSSProperties } from "react";

const GLYPHS = "/brand/conchars.png";

/** `text` in Quake console glyphs, each 8px times `zoom`. Read by screen readers as `text`. */
export function QuakeText({
  text,
  zoom,
  className,
}: {
  text: string;
  zoom: number;
  className?: string;
}) {
  return (
    <span role="img" aria-label={text} className={`flex shrink-0 ${className ?? ""}`}>
      {[...text].map((ch, i) => {
        const code = ch.charCodeAt(0);
        return (
          <span
            key={i}
            aria-hidden="true"
            // Lets CSS stagger an animation per letter.
            className="bb-glyph"
            style={
              {
                "--i": i,
                width: 8 * zoom,
                height: 8 * zoom,
                flex: "none",
                backgroundImage: `url(${GLYPHS})`,
                backgroundSize: `${128 * zoom}px ${128 * zoom}px`,
                backgroundPosition: `-${(code & 15) * 8 * zoom}px -${(code >> 4) * 8 * zoom}px`,
                imageRendering: "pixelated",
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
