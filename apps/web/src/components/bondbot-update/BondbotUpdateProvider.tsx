import { useTimeout } from "@rakazo/chat-ui/hooks";
import type { BondbotUpdateAvailability, BondbotUpdateJob } from "@rakazo/contracts";
import { bestEffort } from "@rakazo/logging/best-effort";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { BONDBOT_VERSION } from "../../lib/bondbot-version";
import { bondbotSkippedVersionPreference } from "../../lib/preferences/bondbot-update-pref";
import { useQueryUserId, useSave, useSpaceQueries } from "../../lib/query/query";

export interface BondbotUpdateContextValue {
  availability: BondbotUpdateAvailability | null;
  job: BondbotUpdateJob | null;
  /** True when the user can manage updates, an update is newer than skipped, or an update is active. */
  showNotificationDot: boolean;
  /** True when a version update is offered (even if already started). */
  canOpenPopover: boolean;
  isUpdating: boolean;
  reconnecting: boolean;
  reloading: boolean;
  applyPending: boolean;
  applyError: string | null;
  checking: boolean;
  skippedVersion: string | null;
  checkNow: () => Promise<void>;
  startUpdate: () => void;
  skipCurrentUpdate: () => void;
  reloadApp: () => void;
}

export const BondbotUpdateContext = createContext<BondbotUpdateContextValue | null>(null);

export function useBondbotUpdate(): BondbotUpdateContextValue | null {
  return useContext(BondbotUpdateContext);
}

const HEALTH_POLL_INTERVAL_MS = 2_000;
const PROGRESS_POLL_INTERVAL_MS = 1_500;
const RELOAD_DELAY_MS = 650;

export function BondbotUpdateProvider({ children }: { children: ReactNode }) {
  const userId = useQueryUserId();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const skippedVersion = bondbotSkippedVersionPreference.use();
  const statusQueryKey = queries.bondbotUpdate.status.queryKey({
    input: { uiVersion: BONDBOT_VERSION },
  });

  const [forcedAvailability, setForcedAvailability] = useState<BondbotUpdateAvailability | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [job, setJob] = useState<BondbotUpdateJob | null>(null);
  const [pollingProgress, setPollingProgress] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [baselineApiVersion, setBaselineApiVersion] = useState<string | null>(null);
  const [progressTick, setProgressTick] = useState<object | null>(null);
  const [healthTick, setHealthTick] = useState<object | null>(null);

  const statusQuery = useQuery({
    ...queries.bondbotUpdate.status.queryOptions({
      input: { uiVersion: BONDBOT_VERSION },
    }),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const availability = forcedAvailability ?? statusQuery.data ?? null;
  const targetVersion = availability?.latestUiVersion ?? availability?.latestApiVersion ?? null;
  const updateAvailable = Boolean(availability?.canManage && availability.updateAvailable);
  const isSkipped = Boolean(targetVersion && skippedVersion && targetVersion === skippedVersion);
  const isUpdating = Boolean(job?.running || reconnecting);
  const showNotificationDot = Boolean((updateAvailable && !isSkipped) || isUpdating);
  const canOpenPopover = Boolean(availability?.canManage || isUpdating);

  const applySave = useSave<string | undefined, BondbotUpdateJob>({
    save: (expectedVersion, rpc) => rpc.bondbotUpdate.apply({ expectedVersion }),
    onSaved: (startedJob) => {
      setJob(startedJob);
      setBaselineApiVersion(availability?.currentApiVersion ?? null);
      if (startedJob.running) {
        setPollingProgress(true);
        setProgressTick({});
      } else if (startedJob.phase === "succeeded" && !startedJob.restartRequired) {
        setReconnecting(true);
        setHealthTick({});
      }
    },
  });

  useTimeout(
    () => {
      void pollJobProgress();
    },
    pollingProgress && progressTick ? PROGRESS_POLL_INTERVAL_MS : null,
    progressTick,
  );

  useTimeout(
    () => {
      void probeServerHealth();
    },
    reconnecting && healthTick ? HEALTH_POLL_INTERVAL_MS : null,
    healthTick,
  );

  useTimeout(
    () => {
      window.location.reload();
    },
    reloading ? RELOAD_DELAY_MS : null,
    reloading,
  );

  async function pollJobProgress() {
    try {
      const nextJob = await queryClient.fetchQuery({
        ...queries.bondbotUpdate.progress.queryOptions(),
        staleTime: 0,
      });
      setJob(nextJob);
      if (!nextJob.running) {
        setPollingProgress(false);
        if (nextJob.phase === "succeeded" && !nextJob.restartRequired) {
          setReconnecting(true);
          setHealthTick({});
        } else {
          await bestEffort("refresh BondBot update status", checkNowInternal(false));
        }
        return;
      }
      setProgressTick({});
    } catch {
      // During Docker container recreate, the API briefly drops while services swap over.
      setPollingProgress(false);
      setReconnecting(true);
      setJob((prev) =>
        prev
          ? {
              ...prev,
              phase: "reconnecting",
              progress: Math.max(prev.progress, 94),
              message: "Restarting BondBot and reconnecting...",
            }
          : prev,
      );
      setHealthTick({});
    }
  }

  async function probeServerHealth() {
    try {
      const healthUrl =
        typeof window === "undefined"
          ? "http://127.0.0.1:5173/health"
          : `${window.location.origin}/health`;
      const res = await fetch(healthUrl, { cache: "no-store" });
      if (res.ok) {
        const body = (await bestEffort(
          "parse health payload",
          res.json() as Promise<{ ok?: boolean; version?: string }>,
        )) ?? { ok: false };
        if (body.ok) {
          const targetApi = job?.targetApiVersion ?? availability?.latestApiVersion ?? null;
          const versionChanged =
            (baselineApiVersion && body.version && body.version !== baselineApiVersion) ||
            (targetApi && body.version === targetApi);
          if (versionChanged || !targetApi) {
            setReconnecting(false);
            setReloading(true);
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    running: false,
                    phase: "succeeded",
                    progress: 100,
                    message: "Updated! Reloading BondBot...",
                  }
                : prev,
            );
            return;
          }
        }
      }
    } catch {
      // Server is still restarting; keep waiting quietly.
    }
    setHealthTick({});
  }

  async function checkNowInternal(force = true) {
    if (!userId) return;
    setChecking(true);
    try {
      const fresh = await queryClient.fetchQuery({
        ...queries.bondbotUpdate.status.queryOptions({
          input: { force, uiVersion: BONDBOT_VERSION },
        }),
        staleTime: 0,
      });
      setForcedAvailability(fresh);
      queryClient.setQueryData(statusQueryKey, fresh);
    } catch {
      // Handled gracefully in popover if manual check fails.
    } finally {
      setChecking(false);
    }
  }

  function startUpdate() {
    if (!availability?.canApply || isUpdating || applySave.pending) return;
    applySave.reset();
    bondbotSkippedVersionPreference.set(null);
    void applySave.run(targetVersion ?? undefined);
  }

  function skipCurrentUpdate() {
    if (targetVersion) {
      bondbotSkippedVersionPreference.set(targetVersion);
    }
  }

  function reloadApp() {
    window.location.reload();
  }

  return (
    <BondbotUpdateContext.Provider
      value={{
        availability,
        job,
        showNotificationDot,
        canOpenPopover,
        isUpdating,
        reconnecting,
        reloading,
        applyPending: applySave.pending,
        applyError: applySave.error?.message ?? null,
        checking,
        skippedVersion,
        checkNow: () => checkNowInternal(true),
        startUpdate,
        skipCurrentUpdate,
        reloadApp,
      }}
    >
      {children}
    </BondbotUpdateContext.Provider>
  );
}
