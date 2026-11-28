// Local addition (David, 2026-11-21): what the quick switch lists first, most used and starred.
import { accountPreferencesChangesScope } from "@rakazo/db";
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
      starred: authed.botModels.starred.handler(async ({ context }) => {
        return deps.prisma.starredModel.findMany({
          where: { userId: context.actor.userId },
          orderBy: [{ createdAt: "asc" }, { modelId: "asc" }],
          select: { provider: true, modelId: true },
        });
      }),
      // Sets rather than toggles, so a repeated or late request cannot undo a star.
      setStarred: authed.botModels.setStarred.handler(async ({ context, input }) => {
        const { userId } = context.actor;
        const row = { userId, provider: input.provider, modelId: input.modelId };
        if (input.starred) {
          await deps.prisma.starredModel.createMany({ data: row, skipDuplicates: true });
        } else {
          await deps.prisma.starredModel.deleteMany({ where: row });
        }
        await deps.events.publishSpaceChange?.(
          accountPreferencesChangesScope(userId),
          "preferences",
        );
        return { ok: true as const };
      }),
    },
  };
}
