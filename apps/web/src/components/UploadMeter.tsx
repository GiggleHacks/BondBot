import { X } from "lucide-react";
import { formatSpeed } from "../lib/upload-progress";

/** A real bar plus speed. Replaces the little upload icon. */
export function UploadMeter({
  fraction,
  bps,
  label,
  onCancel,
}: {
  fraction: number;
  bps?: number;
  label: string;
  onCancel?: () => void;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const speed = bps ? formatSpeed(bps) : "";
  return (
    <div data-testid="upload-meter" className="flex w-full min-w-[180px] max-w-[280px] items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-foreground/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={label}
        >
          <div
            className="h-full rounded-full bg-current transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] leading-4 tabular-nums opacity-80">
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0">{speed ? `${speed} · ${pct}%` : `${pct}%`}</span>
        </div>
      </div>
      {onCancel ? (
        <button
          type="button"
          aria-label="Cancel upload"
          onClick={onCancel}
          className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-accent"
        >
          <X size={12} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
