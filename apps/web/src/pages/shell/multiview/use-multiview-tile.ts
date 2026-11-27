import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  ComputerStatus,
  LoginFieldInput,
  Me,
  MessageReaction,
  ProductEvent,
  ThreadMessage,
  ThreadSnapshot,
} from "@rakazo/contracts";
import {
  activeThreadRuns,
  applyThreadSendReceipt,
  createRefreshCoalescer,
  isRunTerminalEvent,
  isRunWorking,
  isThreadSnapshotEvent,
  newClientId,
  reconcileRefreshedThread,
  reduceThreadSnapshot,
  rememberTerminalRun,
  runThreadSubscription,
} from "@rakazo/core";
import { bestEffort } from "@rakazo/logging/best-effort";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { transcriptIsNearEnd } from "../../../lib/chat/transcript-scroll";
import type { SpaceQueries } from "../../../lib/query/query";
import { queryClient, useSave } from "../../../lib/query/query";
import type { createSpaceRpc } from "../../../lib/query/rpc";
import {
  clearActiveThreadRuns,
  isComputerStatusEvent,
  prependThreadMessagePage,
  reduceComputerStatus,
} from "../../../lib/query/thread-events";
import { useThreadState } from "../chat/use-thread-state";
import { useTranscriptView } from "../chat/use-transcript-view";
import { useComputerControls, useComputerState } from "../computers/use-computer";

function applyTileEvent(
  event: ProductEvent,
  commitSnapshot: (next: ThreadSnapshot | null) => void,
  commitComputer: (next: ComputerStatus | null) => void,
  snapshotRef: RefObject<ThreadSnapshot | null>,
  computerRef: RefObject<ComputerStatus | null>,
) {
  if (isThreadSnapshotEvent(event)) {
    commitSnapshot(reduceThreadSnapshot(snapshotRef.current, event));
  }
  if (isComputerStatusEvent(event)) {
    commitComputer(reduceComputerStatus(computerRef.current, event));
  }
}

/**
 * Self-contained live state for one Multiview tile: keeps the bot's thread subscription,
 * computer screen, control lease, power actions, and mini-chat composer synchronized.
 */
export function useMultiviewTile({
  bot,
  bots,
  botsRef,
  archivedBots,
  rpc,
  queries,
  meId,
  streamReplies,
  sandboxProvider,
  refreshBots,
  onBotUpdated,
  onUpgrade,
  onSendError,
}: {
  bot: Bot;
  bots: Bot[];
  botsRef: RefObject<Bot[]>;
  archivedBots: Bot[];
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  meId: string | undefined;
  streamReplies: boolean;
  sandboxProvider: Me["sandboxProvider"] | undefined;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  onBotUpdated: (updated: Bot) => void;
  onUpgrade: () => void;
  onSendError: (message: string) => void;
}) {
  const { t } = useLingui();
  const botIdRef = useRef<string | undefined>(bot.id);
  botIdRef.current = bot.id;
  const emptyGroupIdRef = useRef<string | undefined>(undefined);

  const thread = useThreadState(streamReplies);
  const { snapshot, snapshotRef, commitSnapshot, updateSnapshot, messageScroll, resetHistory } =
    thread;

  const computerState = useComputerState({
    rpc,
    panel: "settings",
    activeId: bot.id,
    activeBotId: botIdRef,
    docked: true,
  });
  const {
    computer,
    computerRef,
    commitComputer,
    cacheComputerFor,
    showCachedComputer,
    refreshComputerScreen,
    isOwnControlEvent,
    isOwnAnswer,
  } = computerState;

  const terminalRunReceipts = useRef(new Set<string>());
  const refreshEpoch = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [followRequest, setFollowRequest] = useState(0);

  const snapToEnd = useCallback(() => {
    const el = messageScroll.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const current = messageScroll.current;
      if (current) current.scrollTop = current.scrollHeight;
    });
  }, [messageScroll]);

  const refreshThread = useCallback(
    async (
      id: string,
      signal?: AbortSignal,
      { readScreen = true }: { readScreen?: boolean } = {},
    ) => {
      const scroller = messageScroll.current;
      const stickToEnd = !scroller || transcriptIsNearEnd(scroller);
      const request = ++refreshEpoch.current;
      const snap = await rpc.threads.get({ botId: id }, signal ? { signal } : undefined);
      if (botIdRef.current !== id || request !== refreshEpoch.current) return snap;
      const reconciled = reconcileRefreshedThread(
        snapshotRef.current,
        snap,
        computerRef.current,
        false,
      );
      const nextComputer =
        reconciled.computer?.botId && reconciled.computer.botId !== id ? null : reconciled.computer;
      commitSnapshot(reconciled.snapshot);
      commitComputer(nextComputer);
      cacheComputerFor(id, { computer: nextComputer });
      if (stickToEnd) snapToEnd();
      if (readScreen) bestEffort("multiview.readScreen", refreshComputerScreen(id));
      return snap;
    },
    [
      cacheComputerFor,
      commitComputer,
      commitSnapshot,
      computerRef,
      messageScroll,
      refreshComputerScreen,
      rpc,
      snapToEnd,
      snapshotRef,
    ],
  );

  const refreshGroupThread = useCallback((groupId: string) => rpc.threads.get({ groupId }), [rpc]);

  useEffect(() => {
    showCachedComputer(bot.id);
    const cached = queryClient.getQueryData(
      queries.threads.get.queryKey({ input: { botId: bot.id } }),
    );
    if (cached && snapshotRef.current?.botId !== bot.id) {
      commitSnapshot(cached);
    }
    const sidebarRefresh = createRefreshCoalescer(() => refreshBots());
    const snapshotRefresh = createRefreshCoalescer(() => refreshThread(bot.id));
    const abort = new AbortController();

    void runThreadSubscription({
      signal: abort.signal,
      loadInitial: () => refreshThread(bot.id, abort.signal),
      loadHead: () => rpc.threads.head({ botId: bot.id }, { signal: abort.signal }),
      refresh: () => refreshThread(bot.id, abort.signal),
      currentSnapshot: () => snapshotRef.current,
      subscribe: (cursor, signal) => rpc.threads.subscribe({ botId: bot.id, cursor }, { signal }),
      beforeEvent: (event) => rememberTerminalRun(terminalRunReceipts.current, event),
      applyEvent: (event) =>
        applyTileEvent(event, commitSnapshot, commitComputer, snapshotRef, computerRef),
      onEvent: (event) => {
        if (event.type === "thread.cleared") resetHistory();
        if (event.type === "bot.archived") {
          bestEffort("multiview.refreshArchived", refreshBots(true));
        } else if (
          event.type === "bot.updated" ||
          event.type === "run.started" ||
          isRunTerminalEvent(event) ||
          event.type === "thread.cleared"
        ) {
          bestEffort("multiview.refreshSidebar", sidebarRefresh.invalidate());
        }
        if (
          isRunTerminalEvent(event) ||
          event.type === "run.waiting_input" ||
          event.type === "skill.teaching.stopped"
        ) {
          bestEffort("multiview.refreshSnapshot", snapshotRefresh.invalidate());
        } else if (isComputerStatusEvent(event)) {
          const own =
            event.payload.answered === true
              ? isOwnAnswer(bot.id)
              : isOwnControlEvent(bot.id, event.type, event.payload.leaseId);
          if (!own) bestEffort("multiview.controlScreen", refreshComputerScreen(bot.id));
          if (event.type === "computer.takeover.granted" && computerRef.current?.shared) {
            bestEffort("multiview.sharedControlSync", snapshotRefresh.invalidate());
          }
        }
        if (event.type === "thread.message.created") {
          const el = messageScroll.current;
          if (!el || transcriptIsNearEnd(el)) snapToEnd();
        }
      },
    });

    return () => {
      abort.abort();
      sidebarRefresh.dispose();
      snapshotRefresh.dispose();
    };
  }, [bot.id]);

  const view = useTranscriptView({
    snapshot,
    inGroup: false,
    groupId: undefined,
    active: bot,
    activeGroup: undefined,
    bots,
    archivedBots,
    meId,
  });

  const activeRuns = activeThreadRuns(view.activeSnapshot);
  const workingRun = activeRuns.find((run) => isRunWorking(run.status));
  const running = Boolean(workingRun);

  const computerControls = useComputerControls({
    rpc,
    state: computerState,
    panel: "settings",
    active: bot,
    docked: true,
    bots,
    botsRef,
    activeBotId: botIdRef,
    activeGroupId: emptyGroupIdRef,
    runStatus: workingRun?.status,
    sandboxProvider,
    refreshThread,
    refreshGroupThread,
    onUpgrade,
    onSendError,
  });

  const loadOlder = useCallback(async () => {
    const before = view.activeSnapshot?.olderCursor;
    if (before == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await rpc.threads.messages({ botId: bot.id, before });
      if (botIdRef.current !== bot.id) return;
      updateSnapshot((prev) => prependThreadMessagePage(prev, page));
    } finally {
      setLoadingOlder(false);
    }
  }, [bot.id, loadingOlder, rpc, updateSnapshot, view.activeSnapshot?.olderCursor]);

  const powerOff = useSave({
    save: async (_input: undefined, client) => client.computer.stop({ botId: bot.id }),
    onSaved: (status) => {
      if (botIdRef.current !== bot.id) return;
      commitComputer(status);
      cacheComputerFor(bot.id, { computer: status, screenUrl: null });
      computerState.setScreenUrl(null, bot.id);
      bestEffort(
        "multiview.refreshAfterStop",
        refreshThread(bot.id, undefined, { readScreen: false }),
      );
    },
  });

  const send = useSave({
    save: async ({ text }: { text: string; onSent?: () => void }, client) => {
      const clientNonce = newClientId();
      return client.threads.send({
        botId: bot.id,
        clientNonce,
        imageHandling: "confirm",
        text,
      });
    },
    onSaved: (sent, input) => {
      input.onSent?.();
      if (botIdRef.current !== bot.id) return;
      if (sent) {
        updateSnapshot((current) =>
          applyThreadSendReceipt(
            current,
            { botId: bot.id, runId: sent.runId, taskId: sent.taskId },
            terminalRunReceipts.current,
          ),
        );
      }
      setFollowRequest((n) => n + 1);
      bestEffort("multiview.refreshAfterSend", refreshThread(bot.id));
      bestEffort("multiview.refreshBotsAfterSend", refreshBots());
    },
  });

  const stop = useSave({
    save: async (_input: undefined, client) => client.threads.stop({ botId: bot.id }),
    onSaved: () => {
      if (botIdRef.current !== bot.id) return;
      updateSnapshot((current) => (current ? clearActiveThreadRuns(current) : current));
      bestEffort("multiview.refreshAfterStopRun", refreshThread(bot.id));
    },
  });

  const answerMessage = useCallback(
    async (
      message: ThreadMessage,
      text: string,
      fields?: LoginFieldInput[],
      dismiss?: boolean,
      remember?: false,
    ) => {
      await rpc.threads.answer({
        botId: bot.id,
        runId: message.runId ?? "",
        messageId: message.id,
        answer: text,
        ...(fields ? { fields } : {}),
        ...(remember === false ? { remember } : {}),
        ...(dismiss ? { dismiss: true as const } : {}),
      });
      bestEffort("multiview.refreshAfterAnswer", refreshThread(bot.id));
    },
    [bot.id, refreshThread, rpc],
  );

  const reactToMessage = useCallback(
    async (message: ThreadMessage, reaction: MessageReaction) => {
      try {
        await rpc.threads.react({
          botId: bot.id,
          messageId: message.id,
          reaction,
          clientNonce: newClientId(),
        });
        bestEffort("multiview.refreshAfterReact", refreshThread(bot.id));
      } catch (error) {
        onSendError(error instanceof Error ? error.message : t`Could not update reaction`);
      }
    },
    [bot.id, onSendError, refreshThread, rpc, t],
  );

  const switchModel = useCallback(
    async (choice: { provider: string; modelId: string }) => {
      const updated = await rpc.bots.update({
        botId: bot.id,
        modelProvider: choice.provider,
        modelId: choice.modelId,
      });
      onBotUpdated(updated);
      bestEffort("multiview.refreshBotsAfterModel", refreshBots());
      return {
        provider: updated.modelProvider ?? choice.provider,
        modelId: updated.modelId ?? choice.modelId,
      };
    },
    [bot.id, onBotUpdated, refreshBots, rpc],
  );

  const wakeComputer = useCallback(
    () => void computerControls.openComputer(bot.id, false, true),
    [bot.id, computerControls],
  );

  return {
    thread,
    view,
    running,
    loadingOlder,
    followRequest,
    loadOlder,
    computerState,
    computerControls,
    computer,
    wakeComputer,
    powerOff,
    send,
    stop,
    answerMessage,
    reactToMessage,
    switchModel,
    refreshThread: async () => {
      await refreshThread(bot.id);
    },
  };
}
