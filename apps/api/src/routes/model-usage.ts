// Local addition (David, 2026-11-21): the models this account's runs used most in the last 30 days.
import type { RouterContext } from "./context.js";

export function modelUsageRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    botModels: {
      mostUsed: authed.botModels.mostUsed.handler(async ({ context }) => {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await deps.prisma.run.groupBy({
          by: ["modelProvider", "modelId"],
          where: {
            userId: context.actor.userId,
            createdAt: { gte: since },
            modelProvider: { not: null },
            modelId: { not: null },
          },
          _count: { _all: true },
          orderBy: { _count: { id: "desc" } },
          take: 8,
        });
        return rows
          .filter((row) => row.modelProvider && row.modelId)
          .slice(0, 5)
          .map((row) => ({
            provider: row.modelProvider as string,
            modelId: row.modelId as string,
            runs: row._count._all,
          }));
      }),
    },
  };
}
