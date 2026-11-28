import * as z from "zod";

export const BondbotUpdateModeSchema = z.enum(["sidecar", "source", "manual"]);
export type BondbotUpdateMode = z.infer<typeof BondbotUpdateModeSchema>;

export const BondbotUpdatePhaseSchema = z.enum([
  "idle",
  "checking",
  "downloading",
  "building",
  "migrating",
  "restarting",
  "reconnecting",
  "succeeded",
  "failed",
]);
export type BondbotUpdatePhase = z.infer<typeof BondbotUpdatePhaseSchema>;

export const BondbotUpdateCheckRequestSchema = z
  .object({
    force: z.boolean().optional(),
    uiVersion: z.string().max(40).optional(),
  })
  .optional();

export const BondbotUpdateApplyRequestSchema = z
  .object({
    expectedVersion: z.string().max(40).optional(),
  })
  .optional();

export const BondbotUpdateAvailabilitySchema = z.object({
  canManage: z.boolean(),
  mode: BondbotUpdateModeSchema,
  canApply: z.boolean(),
  currentUiVersion: z.string().max(40),
  currentApiVersion: z.string().max(40),
  currentCommit: z.string().max(64).nullable(),
  latestUiVersion: z.string().max(40).nullable(),
  latestApiVersion: z.string().max(40).nullable(),
  latestCommit: z.string().max(64).nullable(),
  updateAvailable: z.boolean(),
  changelogSummary: z.string().max(2000).nullable(),
  repoUrl: z.string().max(300),
  branch: z.string().max(100),
  checkedAt: z.string().nullable(),
  checkError: z.string().max(500).nullable(),
  manualCommands: z.array(z.string().max(400)),
});
export type BondbotUpdateAvailability = z.infer<typeof BondbotUpdateAvailabilitySchema>;

export const BondbotUpdateJobSchema = z.object({
  jobId: z.string().max(100).nullable(),
  running: z.boolean(),
  phase: BondbotUpdatePhaseSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string().max(300),
  targetUiVersion: z.string().max(40).nullable(),
  targetApiVersion: z.string().max(40).nullable(),
  targetCommit: z.string().max(64).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().max(1000).nullable(),
  restartRequired: z.boolean(),
  logTail: z.string().max(4000).nullable(),
  /** What the running command is doing now. The rest below come from its live output. */
  detail: z.string().max(300).nullable().optional(),
  downloadedBytes: z.number().nonnegative().optional(),
  bytesPerSecond: z.number().nonnegative().optional(),
  lastOutputAt: z.string().optional(),
  /** Seconds left, judged by how long the last update took. Absent when that is unknown. */
  etaSeconds: z.number().nonnegative().optional(),
});
export type BondbotUpdateJob = z.infer<typeof BondbotUpdateJobSchema>;
