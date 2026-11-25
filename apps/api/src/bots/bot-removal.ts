import { destroyBot } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { createRepos } from "@rakazo/db";
import { requireSpaceOwner } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { setSupervisorHomeVpn } from "../computer-vpn.js";
import type { RouterDeps } from "../router.js";

/** A bot this actor may remove: theirs or the owner's, in this space, archived included. */
export async function loadBotForRemoval(
  prisma: RouterDeps["prisma"],
  repos: ReturnType<typeof createRepos>,
  actor: Actor,
  botId: string,
) {
  const bot = await repos.getBot(actor, botId, { includeArchived: true });
  // Any member can archive; only the bot's creator or the space owner deletes for good.
  if (bot.userId !== actor.userId) await requireSpaceOwner(prisma, actor);
  return bot;
}

export function createBotRemoval(deps: RouterDeps, repos: ReturnType<typeof createRepos>) {
  const removeBot = async (
    actor: Actor,
    botId: string,
    options: Parameters<typeof destroyBot>[3],
  ) => {
    const bot = await loadBotForRemoval(deps.prisma, repos, actor, botId);
    const result = await destroyBot(
      {
        prisma: deps.prisma,
        sandbox: deps.sandbox,
        home: deps.home,
        jobs: deps.jobs,
        memoryProviders: deps.memoryProviders,
        artifacts: deps.artifacts,
        secretStore: deps.secrets,
        dataDir: deps.dataDir,
        messagingInstallations: deps.messagingInstallations,
        ...(deps.meetings && { meetings: deps.meetings }),
      },
      bot,
      {
        operationId: "destroy",
        traceId: "destroy",
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: bot.id,
        signal: new AbortController().signal,
      },
      options,
    );
    if (bot.computer?.scope === "dedicated" && (bot.computer.vpnProfile || bot.computer.vpnLocked)) {
      await setSupervisorHomeVpn(deps.env, bot.computer.homeKey, {
        profile: null,
        locked: false,
      }).catch((error) => {
        getLogger().warn("bot removal VPN cleanup failed", {
          botId: bot.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return result;
  };
  return removeBot;
}
