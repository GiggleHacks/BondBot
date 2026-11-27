import { oc } from "@orpc/contract";
import * as z from "zod";
import {
  BondbotUpdateApplyRequestSchema,
  BondbotUpdateAvailabilitySchema,
  BondbotUpdateCheckRequestSchema,
  BondbotUpdateJobSchema,
} from "./bondbot-update.js";
import {
  DeploymentSettingsSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
} from "./server-updates.js";

export const serverRpc = {
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  /**
   * Deployment-owner product updates. When the Compose updater sidecar is reachable, these proxy
   * to its `/state` `/plan` `/apply` contract. Rollback stays on the sidecar for ops only and is
   * not exposed here. Never git-fetch from the API process.
   */
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  /** Self-update checks and 1-click apply against GiggleHacks/BondBot on GitHub. */
  bondbotUpdate: {
    status: oc.input(BondbotUpdateCheckRequestSchema).output(BondbotUpdateAvailabilitySchema),
    apply: oc.input(BondbotUpdateApplyRequestSchema).output(BondbotUpdateJobSchema),
    progress: oc.output(BondbotUpdateJobSchema),
  },
};
