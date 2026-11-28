import { cn } from "@rakazo/ui-web";
import { Moon } from "lucide-react";
import { ASLEEP_LABEL } from "../../lib/computers/bot-asleep";

/** The small mark beside a sleeping bot's name; its owner describes it to screen readers. */
export function AsleepMoon({ className }: { className?: string }) {
  return (
    <span
      title={ASLEEP_LABEL}
      aria-hidden="true"
      data-testid="bot-asleep"
      className={cn("inline-flex shrink-0 text-muted-foreground", className)}
    >
      <Moon className="size-3" strokeWidth={1.9} />
    </span>
  );
}
