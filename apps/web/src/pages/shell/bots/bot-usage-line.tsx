import type { ComputerStats, ComputerStatus } from "@rakazo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../../lib/query/query";

const GIB = 1024 ** 3;
const gib = (bytes: number) => String(Math.round((bytes / GIB) * 10) / 10);

export function usageText({ memoryBytes, memoryLimitBytes, cpuPercent }: ComputerStats): string {
  return `${gib(memoryBytes)} of ${gib(memoryLimitBytes)} GB memory, ${cpuPercent}% CPU`;
}

/**
 * A faint reading of what the bot's computer is using. It is read when the panel opens, the
 * window is focused and the computer starts; it is a snapshot, never polled.
 */
export function BotUsageLine({
  botId,
  computer,
}: {
  botId: string;
  computer: ComputerStatus | null;
}) {
  const running = computer?.botId === botId && computer.state === "running";
  const queries = useSpaceQueries();
  const { data } = useQuery({
    ...queries.computer.stats.queryOptions({ input: { botId } }),
    enabled: running,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  if (!running || !data) return null;
  return (
    <p
      data-testid="bot-usage"
      title="Memory and processor use of this bot's computer"
      className="mt-1 text-label text-faint-foreground tabular-nums"
    >
      {usageText(data)}
    </p>
  );
}
