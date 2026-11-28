import { useTimeout } from "@rakazo/chat-ui/hooks";
import type { BondbotUpdateAvailability, BondbotUpdateJob } from "@rakazo/contracts";
import { bestEffort } from "@rakazo/logging/best-effort";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { BONDBOT_VERSION } from "../../lib/bondbot-version";
import { bondbotSkippedVersionPreference } from "../../lib/preferences/bondbot-update-pref";
import { useQueryUserId, useSave, useSpaceQueries } from "../../lib/query/query";

export interface BondbotUpdateContextValue {
  availability: BondbotUpdateAvailability | null;
  job: BondbotUpdateJob | null;
  /** True while an update that has not been skipped is offered, or one is under way. */
  showUpdate: boolean;
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

const PROGRESS_POLL_INTERVAL_MS = 1_000;
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
  const [progressTick, setProgressTick] = useState<object | null>(null);

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
  // A started job stays on screen until it is dismissed or the app reloads.
  const showUpdate = Boolean((updateAvailable && !isSkipped) || isUpdating || reloading);
  const canOpenPopover = Boolean(availability?.canManage || isUpdating);

  const applySave = useSave<string | undefined, BondbotUpdateJob>({
    save: (expectedVersion, rpc) => rpc.bondbotUpdate.apply({ expectedVersion }),
    onSaved: (startedJob) => {
      setJob(startedJob);
      if (startedJob.running) {
        follow();
      } else if (startedJob.phase === "succeeded" && !startedJob.restartRequired) {
        setReloading(true);
      }
    },
  });

  function follow() {
    setPollingProgress(true);
    setProgressTick({});
  }

  // An update started before this page loaded, or in another tab, is picked up and followed,
  // so refreshing during an update loses nothing.
  const canManage = Boolean(availability?.canManage);
  useEffect(() => {
    if (!canManage) return;
    let current = true;
    void bestEffort(
      "follow a running BondBot update",
      readProgress().then((running) => {
        if (!current || !running.running) return;
        setJob(running);
        follow();
      }),
    );
    return () => {
      current = false;
    };
  }, [canManage]);

  useTimeout(
    () => {
      void pollJobProgress();
    },
    pollingProgress && progressTick ? PROGRESS_POLL_INTERVAL_MS : null,
    progressTick,
  );

  useTimeout(
    () => {
      window.location.reload();
    },
    reloading ? RELOAD_DELAY_MS : null,
    reloading,
  );

  function readProgress() {
    return queryClient.fetchQuery({
      ...queries.bondbotUpdate.progress.queryOptions(),
      staleTime: 0,
      retry: false,
    });
  }

  async function pollJobProgress() {
    let next: BondbotUpdateJob;
    try {
      next = await readProgress();
    } catch {
      // The API drops while the services swap over. Keep asking until it answers: the update's
      // own record then says whether it finished.
      setReconnecting(true);
      setJob((prev) =>
        prev
          ? {
              ...prev,
              phase: "reconnecting",
              progress: Math.max(prev.progress, 94),
              message: "Waiting for BondBot to come back",
              detail: null,
            }
          : prev,
      );
      setProgressTick({});
      return;
    }
    setReconnecting(false);
    // A restarted updater has no record of the job; the new version then speaks for itself.
    if (next.phase === "idle" && job) {
      setPollingProgress(false);
      setReloading(true);
      return;
    }
    setJob(next);
    if (next.running) {
      setProgressTick({});
      return;
    }
    setPollingProgress(false);
    if (next.phase === "succeeded" && !next.restartRequired) {
      setReloading(true);
    } else {
      await bestEffort("refresh BondBot update status", checkNowInternal(false));
    }
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
    if (!job?.running) setJob(null);
  }

  function reloadApp() {
    window.location.reload();
  }

  return (
    <BondbotUpdateContext.Provider
      value={{
        availability,
        job,
        showUpdate,
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
