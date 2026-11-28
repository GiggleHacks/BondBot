import { bestEffort, getLogger, runWithLogContext } from "@rakazo/logging";
import type Docker from "dockerode";

/** A computer whose every command fails costs one reading in this time. */
const READING_INTERVAL_MS = 60_000;
const NEAR_LIMIT_SHARE = 0.9;
const lastReadingAt = new Map<string, number>();

/**
 * A computer at its PID or memory limit fails commands without naming the limit, so a failed one
 * has it read.
 */
export function warnNearLimits(container: Docker.Container): void {
  const now = Date.now();
  const last = lastReadingAt.get(container.id);
  if (last !== undefined && now - last < READING_INTERVAL_MS) return;
  for (const [id, at] of lastReadingAt) {
    if (now - at >= READING_INTERVAL_MS) lastReadingAt.delete(id);
  }
  lastReadingAt.set(container.id, now);
  // The reading describes the computer, so it does not repeat the failure of the request that
  // triggered it.
  void bestEffort(
    "read a computer's resource limits",
    runWithLogContext({ error: undefined }, () => reportNearLimits(container)),
  );
}

async function reportNearLimits(container: Docker.Container): Promise<void> {
  const stats = await container.stats({ stream: false, "one-shot": true });
  const log = getLogger();
  const pids = nearLimit(stats.pids_stats?.current, stats.pids_stats?.limit);
  if (pids)
    log.warn("computer.pids_near_limit", {
      "container.id": container.id,
      "pids.current": pids.current,
      "pids.limit": pids.limit,
    });
  const memory = stats.memory_stats;
  const resident = nearLimit(residentMemory(memory), memory.limit);
  if (resident)
    log.warn("computer.memory_near_limit", {
      "container.id": container.id,
      "memory.current": resident.current,
      "memory.limit": resident.limit,
    });
}

/**
 * The kernel frees idle file cache before it kills a process for memory, so it is not counted.
 * Docker names it total_inactive_file on cgroup v1 and inactive_file on cgroup v2.
 */
function residentMemory(memory: Docker.ContainerStats["memory_stats"]): number {
  const idleFileCache = memory.stats?.total_inactive_file ?? memory.stats?.inactive_file ?? 0;
  return Math.max(0, (memory.usage ?? 0) - idleFileCache);
}

/**
 * A computer's memory and processor use, or null when Docker reports no memory figures. The
 * processor share is of `nanoCpus`, its allowance, or of the whole host when it has none.
 */
export function computerUsage(stats: Docker.ContainerStats, nanoCpus?: number) {
  const memory = stats.memory_stats;
  if (!memory?.limit) return null;
  const { cpu_stats: cpu, precpu_stats: before } = stats;
  const used = (cpu?.cpu_usage?.total_usage ?? 0) - (before?.cpu_usage?.total_usage ?? 0);
  const elapsed = (cpu?.system_cpu_usage ?? 0) - (before?.system_cpu_usage ?? 0);
  const hostCpus = cpu?.online_cpus || 1;
  const allowance = nanoCpus ? Math.min(nanoCpus / 1e9, hostCpus) : hostCpus;
  const cores = used > 0 && elapsed > 0 ? (used / elapsed) * hostCpus : 0;
  return {
    memoryBytes: residentMemory(memory),
    memoryLimitBytes: memory.limit,
    cpuPercent: Math.round((cores / allowance) * 100),
  };
}

function nearLimit(current = 0, limit = 0): { current: number; limit: number } | undefined {
  return limit > 0 && current >= limit * NEAR_LIMIT_SHARE ? { current, limit } : undefined;
}
