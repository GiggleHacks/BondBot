import { cn } from "@rakazo/ui-web";

/**
 * How many messages wait in a chat, as a pill. A chat only marked unread has none to count and
 * keeps a plain dot.
 */
export function UnreadBadge({
  count = 0,
  className,
}: {
  count: number | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-roster-unread-dot
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-unread text-caption font-semibold text-background tabular-nums",
        count > 0 ? "h-5 min-w-5 px-1.5" : "size-2",
        className,
      )}
    >
      {count > 999 ? "999+" : count > 0 ? count : null}
    </span>
  );
}
