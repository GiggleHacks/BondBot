import { ORPCError } from "@orpc/server";
import {
  checkpointAndStopComputer,
  endTeachingWithLease,
  hasActiveComputerControl,
  toComputerRef,
} from "@rakazo/adapters";
import type { Actor, Bot, ComputerMode } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, ClientError, COMPUTER_USING_RUNS } from "@rakazo/core";
import {
  type createRepos,
  expireComputerExecutionLeases,
  IsolationError,
  isRecordNotFound,
  recordComputerRunEnd,
} from "@rakazo/db";
import type { RouterDeps } from "./router.js";
import { computerContext } from "./routes/shared.js";

/**
 * Safely switches a bot between the shared Team Computer ("team") and its Own Computer
 * ("dedicated"), stopping a dedicated sandbox cleanly before detaching it.
 */
export async function switchBotComputerMode(
  deps: RouterDeps,
  repos: ReturnType<typeof createRepos>,
  actor: Actor,
  botId: string,
  mode: ComputerMode,
): Promise<Bot> {
  const bot = await repos.getBot(actor, botId);
  if (!bot.computer) throw new IsolationError();
  const currentMode = bot.computer.scope === "dedicated" ? "dedicated" : "team";
  if (currentMode === mode) {
    return repos.setBotComputer(actor, bot.id, mode);
  }
  const claimed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM computers WHERE id = ${bot.computerId} FOR UPDATE`;
    return tx.bot.updateMany({
      where: { id: bot.id, computerSwitching: false, computer: { maintenanceId: null } },
      data: { computerSwitching: true },
    });
  });
  if (claimed.count !== 1) throw new ORPCError("CONFLICT");
  try {
    const active = await deps.prisma.run.findFirst({
      where: {
        botId: bot.id,
        status: { in: [...ACTIVE_RUN_STATUSES] },
        ...COMPUTER_USING_RUNS,
      },
      select: { id: true },
    });
    if (active) {
      throw new ORPCError("BAD_REQUEST", { message: "Stop the bot first" });
    }
    if (currentMode === "dedicated" && mode === "team" && bot.computer.vpnLocked) {
      throw new ORPCError("BAD_REQUEST", { message: "Unlock Kill Switch first" });
    }
    if (bot.computer.controlBotId === bot.id && hasActiveComputerControl(bot.computer)) {
      throw new ORPCError("BAD_REQUEST", { message: "Release the computer first" });
    }
    if (bot.computer.scope === "dedicated" && bot.computer.providerRef) {
      const ctx = computerContext(actor, bot.id, "computer.switch");
      const ref = toComputerRef(bot.computer);
      if (bot.computer.state === "running") {
        await checkpointAndStopComputer(deps, bot.computer, ref, ctx);
      }
      await expireComputerExecutionLeases(deps.prisma, {
        computerId: bot.computer.id,
        botId: bot.id,
      });
      await deps.prisma.computer.update({
        where: { id: bot.computer.id },
        data: {
          state: "stopped",
          controlHolder: "none",
          controlLeaseId: null,
          controlUserId: null,
          controlLeaseExpiresAt: null,
          controlBotId: null,
          executionRunId: null,
          executionBotId: null,
          executionLeaseExpiresAt: null,
        },
      });
      await recordComputerRunEnd(deps.prisma, bot.computer, "stopped");
      await endTeachingWithLease(deps, actor.spaceId, bot.computer.controlLeaseId);
    }
    const updated = await repos.setBotComputer(actor, bot.id, mode);
    deps.analytics?.capture(actor.userId, {
      name: "bot_setting_changed",
      setting: "computer",
    });
    return updated;
  } catch (error) {
    // Removing the bot mid-switch also deletes its dedicated computer.
    if (isRecordNotFound(error)) throw new ClientError("NOT_FOUND", "Not Found");
    throw error;
  } finally {
    await deps.prisma.bot.updateMany({
      where: { id: bot.id },
      data: { computerSwitching: false },
    });
  }
}
