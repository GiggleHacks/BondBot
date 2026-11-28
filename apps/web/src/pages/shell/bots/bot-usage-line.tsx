import type { ComputerStats, ComputerStatus } from "@rakazo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../../lib/query/query";

const GIB = 1024 ** 3;

/** Green while there is room, amber when it is getting full, red when it is about to run out. */
export function usageTone(share: number): string {
  if (share >= 0.85) return "text-destructive";
  return share >= 0.6 ? "text-warning" : "text-success";
}

export function usageReadings({ memoryBytes, memoryLimitBytes, cpuPercent }: ComputerStats) {
  return [
    {
      label: "RAM",
      value: `${Math.round((memoryBytes / GIB) * 10) / 10} GB`,
      tone: usageTone(memoryBytes / memoryLimitBytes),
    },
    { label: "CPU", value: `${cpuPercent}%`, tone: usageTone(cpuPercent / 100) },
  ];
}

/**
 * A small colour-coded reading of what the bot's computer is using. It is read when the panel opens, the
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
      title={`This bot's computer. Memory limit ${Math.round(data.memoryLimitBytes / GIB)} GB.`}
      className="mt-1 flex gap-3 text-label tabular-nums"
    >
      {usageReadings(data).map((reading) => (
        <span key={reading.label} className="flex gap-1">
          <span className="text-faint-foreground">{reading.label}</span>
          <span className={reading.tone}>{reading.value}</span>
        </span>
      ))}
    </p>
  );
}
