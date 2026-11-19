import { Globe } from "lucide-react";

/**
 * Crisp inline SVG country flags so Windows/Linux browsers render real colorful flags
 * instead of monochrome two-letter region glyphs.
 */
export function CountryFlag({
  code,
  className = "h-3 w-4 shrink-0 rounded-[2px] ring-1 ring-white/15",
}: {
  code: string | null | undefined;
  className?: string;
}) {
  const cc = (code ?? "").toUpperCase();
  switch (cc) {
    case "TH":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#A51931" />
          <rect y="3" width="24" height="12" fill="#F4F5F8" />
          <rect y="6" width="24" height="6" fill="#2D2A4A" />
        </svg>
      );
    case "SG":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="9" fill="#EF3340" />
          <rect y="9" width="24" height="9" fill="#FFFFFF" />
          <circle cx="6.2" cy="4.5" r="2.8" fill="#FFFFFF" />
          <circle cx="7.2" cy="4.5" r="2.5" fill="#EF3340" />
          <circle cx="8.6" cy="3.2" r="0.45" fill="#FFFFFF" />
          <circle cx="9.7" cy="4.3" r="0.45" fill="#FFFFFF" />
          <circle cx="9.1" cy="5.7" r="0.45" fill="#FFFFFF" />
          <circle cx="7.5" cy="5.7" r="0.45" fill="#FFFFFF" />
          <circle cx="7.2" cy="4.3" r="0.45" fill="#FFFFFF" />
        </svg>
      );
    case "HK":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#DE2910" />
          <g fill="#FFFFFF" transform="translate(12 9)">
            <ellipse cx="0" cy="-3.4" rx="1.2" ry="2.6" />
            <ellipse cx="0" cy="-3.4" rx="1.2" ry="2.6" transform="rotate(72)" />
            <ellipse cx="0" cy="-3.4" rx="1.2" ry="2.6" transform="rotate(144)" />
            <ellipse cx="0" cy="-3.4" rx="1.2" ry="2.6" transform="rotate(216)" />
            <ellipse cx="0" cy="-3.4" rx="1.2" ry="2.6" transform="rotate(288)" />
            <circle r="1.1" fill="#DE2910" />
          </g>
        </svg>
      );
    case "TW":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FE0000" />
          <rect width="12" height="9" fill="#000095" />
          <circle cx="6" cy="4.5" r="2.1" fill="#FFFFFF" />
          <circle cx="6" cy="4.5" r="1.5" fill="#000095" />
          <circle cx="6" cy="4.5" r="1.2" fill="#FFFFFF" />
        </svg>
      );
    case "JP":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FFFFFF" />
          <circle cx="12" cy="9" r="4.6" fill="#BC002D" />
        </svg>
      );
    case "US":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FFFFFF" />
          <rect y="0" width="24" height="2" fill="#B22234" />
          <rect y="3.2" width="24" height="2" fill="#B22234" />
          <rect y="6.4" width="24" height="2" fill="#B22234" />
          <rect y="9.6" width="24" height="2" fill="#B22234" />
          <rect y="12.8" width="24" height="2" fill="#B22234" />
          <rect y="16" width="24" height="2" fill="#B22234" />
          <rect width="11" height="9.6" fill="#3C3B6E" />
          <circle cx="3" cy="2.5" r="0.6" fill="#FFFFFF" />
          <circle cx="6" cy="2.5" r="0.6" fill="#FFFFFF" />
          <circle cx="9" cy="2.5" r="0.6" fill="#FFFFFF" />
          <circle cx="4.5" cy="4.8" r="0.6" fill="#FFFFFF" />
          <circle cx="7.5" cy="4.8" r="0.6" fill="#FFFFFF" />
          <circle cx="3" cy="7.2" r="0.6" fill="#FFFFFF" />
          <circle cx="6" cy="7.2" r="0.6" fill="#FFFFFF" />
          <circle cx="9" cy="7.2" r="0.6" fill="#FFFFFF" />
        </svg>
      );
    case "GB":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#012169" />
          <path d="M0 0L24 18M24 0L0 18" stroke="#FFFFFF" strokeWidth="3.2" />
          <path d="M0 0L24 18M24 0L0 18" stroke="#C8102E" strokeWidth="1.6" />
          <path d="M12 0V18M0 9H24" stroke="#FFFFFF" strokeWidth="5" />
          <path d="M12 0V18M0 9H24" stroke="#C8102E" strokeWidth="3" />
        </svg>
      );
    case "DE":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="6" fill="#000000" />
          <rect y="6" width="24" height="6" fill="#DD0000" />
          <rect y="12" width="24" height="6" fill="#FFCE00" />
        </svg>
      );
    case "NL":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="6" fill="#AE1C28" />
          <rect y="6" width="24" height="6" fill="#FFFFFF" />
          <rect y="12" width="24" height="6" fill="#21468B" />
        </svg>
      );
    case "FR":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="8" height="18" fill="#0055A4" />
          <rect x="8" width="8" height="18" fill="#FFFFFF" />
          <rect x="16" width="8" height="18" fill="#EF4135" />
        </svg>
      );
    case "CH":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FF0000" />
          <rect x="10.2" y="3.5" width="3.6" height="11" fill="#FFFFFF" />
          <rect x="6.5" y="7.2" width="11" height="3.6" fill="#FFFFFF" />
        </svg>
      );
    case "KR":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FFFFFF" />
          <circle cx="12" cy="9" r="4" fill="#C60C30" />
          <path d="M8 9A4 4 0 0 0 16 9Z" fill="#003478" />
        </svg>
      );
    case "CA":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#FF0000" />
          <rect x="6" width="12" height="18" fill="#FFFFFF" />
          <path d="M12 4L13.2 7.5H15L13.5 9.3L14.2 12L12 10.5L9.8 12L10.5 9.3L9 7.5H10.8Z" fill="#FF0000" />
        </svg>
      );
    case "AU":
      return (
        <svg viewBox="0 0 24 18" className={className} aria-hidden="true">
          <rect width="24" height="18" fill="#00008B" />
          <rect width="11" height="8" fill="#012169" />
          <path d="M5.5 0V8M0 4H11" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M5.5 0V8M0 4H11" stroke="#C8102E" strokeWidth="1" />
          <circle cx="17.5" cy="5.5" r="1" fill="#FFFFFF" />
          <circle cx="19.5" cy="9" r="0.8" fill="#FFFFFF" />
          <circle cx="16.5" cy="12" r="1" fill="#FFFFFF" />
        </svg>
      );
    default:
      return <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}
