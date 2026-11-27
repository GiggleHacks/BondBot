import {
  applyBondbotUpdate,
  getBondbotUpdateAvailability,
  getBondbotUpdateProgress,
} from "../bondbot-update/bondbot-update-service.js";
import type { RouterContext } from "./context.js";

export function bondbotUpdateRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    bondbotUpdate: {
      status: authed.bondbotUpdate.status.handler(({ context, input }) =>
        getBondbotUpdateAvailability(deps, context.actor, input),
      ),
      apply: authed.bondbotUpdate.apply.handler(({ context, input }) =>
        applyBondbotUpdate(deps, context.actor, input),
      ),
      progress: authed.bondbotUpdate.progress.handler(({ context }) =>
        getBondbotUpdateProgress(deps, context.actor),
      ),
    },
  };
}
