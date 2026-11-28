import type { Bot } from "@rakazo/contracts";
import { DEFAULT_NEW_BOT_AVATAR_SET, hasLab } from "@rakazo/contracts";
import { chatWoke } from "@rakazo/core";
import { bestEffort } from "@rakazo/logging/best-effort";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import type { Ref } from "react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { BondbotUpdateProvider } from "../components/bondbot-update/BondbotUpdateProvider";
import { IncomingCall } from "../components/call/IncomingCall";
import { ComputerUpdateProgress } from "../components/computers/ComputerUpdateProgress";
import { PageLoading } from "../components/PageLoading";
import { PageViewHost } from "../components/pages/PageViewHost";
import { authClient } from "../lib/auth/auth";
import { PagesProvider, usePagesForChat } from "../lib/pages/pages";
import { desktopBridge } from "../lib/platform/desktop";
import { usePreloadRecoveryState } from "../lib/platform/preload-recovery";
import { botsSidebarDensityPreference } from "../lib/preferences/bots-sidebar-density-pref";
import { chatPreferencesQuery, useChatPreferences } from "../lib/preferences/chat-preferences";
import { multiviewOpenPreference } from "../lib/preferences/multiview-pref";
import { queryClient, spaceQueries } from "../lib/query/query";
import type { RpcClient } from "../lib/query/rpc";
import { createSpaceRpc, selectedSpaceId } from "../lib/query/rpc";
import { SpaceRpcProvider } from "../lib/query/space-rpc";
import { InboundOriginProvider } from "../lib/routines/inbound-url";
import { useBackLayer } from "../lib/use-back-layer";
import { BotUsageLine } from "./shell/bots/bot-usage-line";
import type { CreateBotDialogInput } from "./shell/bots/create-bot-dialog";
import { createBotWithVpn } from "./shell/bots/create-bot-with-vpn";
import { useTeaching } from "./shell/bots/use-teaching";
import { useChatMenu } from "./shell/chat/chat-context-menu";
import { ShellChatArea } from "./shell/chat/shell-chat-area";
import { useChatRead } from "./shell/chat/use-chat-read";
import { useMessageActions } from "./shell/chat/use-message-actions";
import { useMessageJump } from "./shell/chat/use-message-jump";
import { useReadAloud } from "./shell/chat/use-read-aloud";
import { useThreadState } from "./shell/chat/use-thread-state";
import { useThreadSync } from "./shell/chat/use-thread-sync";
import { useTranscriptView } from "./shell/chat/use-transcript-view";
import { useComposerActions } from "./shell/composer/use-composer-actions";
import { useComposerMentions } from "./shell/composer/use-composer-mentions";
import { useComposerModelShortcuts } from "./shell/composer/use-composer-model-shortcuts";
import type { PendingVpnChoice } from "./shell/computer-vpn-control";
import { ComputerOverlay } from "./shell/computers/computer-overlay";
import { ShellComputerPanel } from "./shell/computers/shell-computer-panel";
import { TeamComputerVpnChoice } from "./shell/computers/team-computer-vpn-choice";
import { useComputerControls, useComputerState } from "./shell/computers/use-computer";
import { useShellViewModes } from "./shell/computers/use-shell-view-modes";
import { HostComputerPrompt } from "./shell/host-computer-prompt";
import { KeyboardShortcutsDialog } from "./shell/keyboard-shortcuts-dialog";
import { rightPanelStorageKey } from "./shell/right-panel-state";
import { ShellDialogs, useShellDialogs } from "./shell/shell-dialogs";
import { AppOverlays, SettingsOverlays } from "./shell/shell-overlays";
import { isApplePlatform } from "./shell/shell-shortcuts";
import { ShellSidePanel } from "./shell/side-panel";
import { ArchivedChats } from "./shell/sidebar/archived-chats";
import { ShellSidebar } from "./shell/sidebar/shell-sidebar";
import { BotsSidebarLayout } from "./shell/sidebar/sidebar-layout";
import { SidebarRoster } from "./shell/sidebar/sidebar-roster";
import { SnoozedChats } from "./shell/sidebar/snoozed-chats";
import { useChatSnooze } from "./shell/sidebar/use-chat-snooze";
import { useMobileSidebar } from "./shell/sidebar/use-mobile-sidebar";
import { useSidebarExpansion } from "./shell/sidebar/use-sidebar-expansion";
import { useSidebarScroll } from "./shell/sidebar/use-sidebar-scroll";
import { useSidebarSearch } from "./shell/sidebar/use-sidebar-search";
import { useSidebarView } from "./shell/sidebar/use-sidebar-view";
import { useSnoozeClock } from "./shell/sidebar/use-snooze-clock";
import {
  useRosterDrop,
  useSpaceBootstrap,
  useSpaceRoster,
  useSpaceRosterSeed,
} from "./shell/sidebar/use-space-roster";
import { useSpaceEpoch } from "./shell/space-switch";
import { TimezonePrompt, withSavedTimezone } from "./shell/timezone-prompt";
import { useActiveChat } from "./shell/use-active-chat";
import { useBotCall } from "./shell/use-bot-call";
import { useBrowserNotifications } from "./shell/use-browser-notifications";
import { useComputerVpn } from "./shell/use-computer-vpn";
import { usePaletteActions } from "./shell/use-palette-actions";
import { useReportedUiLocale } from "./shell/use-reported-ui-locale";
import { useRightPanel, useRightPanelRestore } from "./shell/use-right-panel";
import { useRoutineEditor } from "./shell/use-routine-editor";
import { useRoutineList } from "./shell/use-routine-list";
import { useShellNavigation } from "./shell/use-shell-navigation";
import { useShellReadyMarks } from "./shell/use-shell-ready-marks";
import { useShellSettings } from "./shell/use-shell-settings";
import { useShellShortcutActions } from "./shell/use-shell-shortcut-actions";
import { useShellStatus } from "./shell/use-shell-status";
import { useSpaceActions } from "./shell/use-space-actions";
import { useOpenSpaceChat } from "./shell/use-space-switch";

export function ShellPage() {
  // Reset the Space's shell while keeping the scroll position of the shared roster.
  const spaceEpoch = useSpaceEpoch();
  const sidebarScrollRef = useSidebarScroll();
  return <SpaceShell key={spaceEpoch} sidebarScrollRef={sidebarScrollRef} />;
}

function SpaceShell({ sidebarScrollRef }: { sidebarScrollRef: Ref<HTMLDivElement> }) {
  const { botId, groupId } = useParams();
  const [shellSpaceId] = useState(selectedSpaceId);
  const [rpc] = useState(() => createSpaceRpc(shellSpaceId));
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  // Held from the first render, so Cmd/Ctrl+N works before the sidebar has data.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const { seed, startChat } = useSpaceRosterSeed(userId ?? null, shellSpaceId, botId, groupId);
  const {
    navigate,
    navigationRevision,
    overlayRevision,
    alive,
    searchParams,
    setSearchParams,
    searchParamsRef,
    redirectKeepingOverlay,
    overlay,
    setOverlay,
  } = useShellNavigation();
  const queries = spaceQueries(userId ?? null, shellSpaceId);
  const roster = useSpaceRoster({ rpc, seed, navigate, redirectKeepingOverlay });
  const {
    groups,
    setGroups,
    groupsRef,
    bots,
    setBots,
    botsRef,
    botSections,
    spaces,
    setSpaces,
    firstBotDue,
    archivedBots,
    archivedGroups,
    initialBotsLoaded,
    initialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    refreshBots,
  } = roster;
  const snoozeNow = useSnoozeClock([
    ...bots,
    ...groups,
    ...spaces.flatMap((space) => [...space.bots, ...space.groups]),
  ]);
  const snooze = useChatSnooze({
    rpc,
    openSpaceId: bootstrapMe?.spaceId,
    setBots,
    setGroups,
    setSpaces,
    refreshBots,
  });
  const { collapsedSidebarSections, toggleSidebarSection } = useSidebarExpansion(userId);
  const search = useSidebarSearch({ rpc, navigate });
  const { data: me } = useQuery({
    ...chatPreferencesQuery(queries, userId),
    placeholderData: bootstrapMe && bootstrapMe.userId === userId ? bootstrapMe : undefined,
  });
  const chatPreferences = useChatPreferences(me?.chatPreferences);
  const thread = useThreadState(chatPreferences.streamReplies);
  const { snapshot } = thread;
  const botsSidebarDensity = botsSidebarDensityPreference.use();
  const rightPanel = useRightPanel({ searchParams, setSearchParams });
  const { panel, setPanel, modelFocusRequest, setModelFocusRequest } = rightPanel;
  const [peerConversation, setPeerConversation] = usePreloadRecoveryState<{
    peerBotId: string;
    peerBotName: string;
  } | null>("peerConversation", null);
  const {
    agentSkills,
    refreshAgentSkills,
    messagingEnabled: messagingSurfaceEnabled,
    messagingProviders,
    memoryProviderConfig,
    voiceStatus,
  } = useShellStatus(queries, Boolean(session.data?.user));
  const { call, openCall } = useBotCall({
    // BondBot: phone calls and dictation are off; voice notes replace them.
    phoneCallsEnabled: false,
    voiceStatus,
    openVoiceSettings: () => openSettings("voice"),
  });
  const { mobileSidebarOpen, setMobileSidebarOpen, swipeHandlers } = useMobileSidebar();
  const isMobileSidebar = useIsMobile();
  const [panelCoversChat, setPanelCoversChat] = useState(false);
  const [panelOverlays, setPanelOverlays] = useState(false);
  const pages = usePagesForChat();
  const sidebar = useSidebarView({
    userId,
    isMobile: isMobileSidebar,
    bootstrapMe,
    spaces,
    bots,
    groups,
    botSections,
    searchQuery: search.query,
    now: snoozeNow,
  });
  const { inGroup, routeChat, active, activeGroup, activeBotId, activeGroupId, userBubble } =
    useActiveChat({ botId, groupId, startChat, bots, groups, now: snoozeNow });
  const { multiviewOpen, toggleMultiview, screenDockActive, openBot, selectBot } =
    useShellViewModes({ inGroup, hasActiveBot: Boolean(active), navigate, setMobileSidebarOpen });
  const computerState = useComputerState({
    rpc,
    panel,
    activeId: active?.id,
    activeBotId,
    docked: screenDockActive,
  });
  const { computerOpen, setComputerOpen, commitComputer } = computerState;
  const vpn = useComputerVpn({
    rpc,
    spaceId: bootstrapMe?.spaceId ?? selectedSpaceId() ?? undefined,
    refreshBots,
    openVpnSettings: () => openSettings("vpn"),
  });
  const [teamVpnChoice, setTeamVpnChoice] = useState<PendingVpnChoice | null>(null);
  const botNames = useMemo(() => new Map(bots.map((bot) => [bot.id, bot.name])), [bots]);
  // On a phone, the Back gesture closes the newest open layer instead of leaving the app.
  useBackLayer(multiviewOpen, () => multiviewOpenPreference.set(false), isMobileSidebar);
  useBackLayer(mobileSidebarOpen, () => setMobileSidebarOpen(false), isMobileSidebar);
  useBackLayer(Boolean(panel), () => setPanel(null), isMobileSidebar);
  useBackLayer(computerOpen, () => setComputerOpen(false), isMobileSidebar);
  useReportedUiLocale(rpc, bootstrapMe?.locale);
  const dialogs = useShellDialogs();
  const openSpaceChatRef = useRef<(spaceId: string, path: string) => void>(() => {});
  const rosterSignals = useSpaceBootstrap({
    roster,
    thread,
    commitComputer,
    userId,
    shellSpaceId,
    seed,
    startChat,
    botId,
    groupId,
    chat: groupId ? { groupId } : active ? { botId: active.id } : undefined,
    navigate,
    redirectKeepingOverlay,
    openSpaceChat: openSpaceChatRef,
  });
  const { notifyBrowserForEvent, flushPendingBrowserNotifications } = useBrowserNotifications(
    bots,
    botsRef,
    {
      rpc,
      activeBotId,
      activeGroupId,
      notificationSounds: me?.chatPreferences?.notificationSounds,
      openChat: (alert) => {
        setMobileSidebarOpen(false);
        navigate(alert.groupId ? `/app/g/${alert.groupId}` : `/app/${alert.botId}`);
      },
      meId: userId,
      groupsRef,
      roster: rosterSignals,
    },
  );
  const { speakingMessageId, speakMessage, callHoldsSpeaker } = useReadAloud({
    active,
    snapshot,
    callBotId: call?.botId,
    activeBotId,
    openVoiceSettings: () => openSettings("voice"),
  });
  const read = useChatRead({ rpc, active, groupId, activeGroup, setBots, setGroups });
  // A chat that wakes while it is open is already seen: read it, which ends the snooze.
  const openChatWoke = active
    ? chatWoke(active, snoozeNow)
    : activeGroup
      ? chatWoke(activeGroup, snoozeNow)
      : false;
  useEffect(() => {
    if (!openChatWoke) return;
    if (groupId) read.markGroupReadOnReply(groupId);
    else if (active) read.markBotReadIfVisible(active.id);
  }, [openChatWoke]);
  const {
    refreshThread,
    refreshGroupThread,
    refreshThreadRef,
    refreshGroupThreadRef,
    refreshActiveThread,
    loadOlder,
    loadingOlder,
    terminalRunReceipts,
  } = useThreadSync({
    rpc,
    queries,
    thread,
    computerState,
    seed,
    active,
    inGroup,
    groupId,
    activeGroup,
    activeBotId,
    activeGroupId,
    botsRef,
    searchParamsRef,
    refreshBots,
    notifyBrowserForEvent,
    markBotReadIfVisible: read.markBotReadIfVisible,
    markGroupReadOnReply: read.markGroupReadOnReply,
    meId: userId,
  });
  const {
    editorProps: routineEditorProps,
    deleteDialogProps: deleteRoutineDialogProps,
    editingRoutine,
    restoreRoutine,
    editRoutine,
    startRoutine,
    resetRoutineTarget,
    leaveRoutine,
    addSkillRoutine,
  } = useRoutineEditor({
    rpc,
    active,
    activeBotId,
    timezone: bootstrapMe?.timezone,
    inboundOrigin: bootstrapMe?.inboundOrigin,
    setBots,
    refreshThread,
    openGroup: (id) => navigate(`/app/g/${id}`),
    setPanel,
    messageProviders: messagingProviders,
  });
  // Until this visit's read lands, a bot shows the skills it had last time.
  const activeTaughtSkills = !active
    ? []
    : thread.taughtSkillsBotId === active.id
      ? thread.taughtSkills
      : (queryClient.getQueryData(queries.skills.list.queryKey({ input: { botId: active.id } })) ??
        []);
  const recordingSkill = activeTaughtSkills.find((skill) => skill.status === "recording") ?? null;
  const modelShortcuts = useComposerModelShortcuts({
    botId: inGroup ? undefined : active?.id,
    enabled: chatPreferences.composerModelPicker && !recordingSkill,
  });
  const {
    chatPanelOpen,
    toggleChatPanel,
    focusComposer,
    registerQuoteShortcut,
    shortcutsOpen,
    setShortcutsOpen,
    findOpen,
    setFindOpen,
    findInputRef,
  } = useShellShortcutActions({
    botId,
    groupId,
    active,
    activeGroup,
    bots,
    botSections,
    snoozeNow,
    navigate,
    selectBot,
    setCommandPaletteOpen: dialogs.setCommandPaletteOpen,
    setCreateMenuOpen,
    setOverlay,
    panel,
    setPanel,
    panelOverlays,
    computerOpen,
    isMobileSidebar,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    sidebarCollapsed: sidebar.collapsed,
    setSidebarCollapsed: sidebar.setCollapsedPref,
    openSidebarSearch: () => search.setSearchOpen(true),
    modelShortcuts,
    refreshThread,
  });
  const {
    settingsSpaceId,
    settingsSpace,
    openSettings,
    openSpaceSettings,
    openImportSetup,
    openAgentImport,
  } = useShellSettings({
    overlay,
    setOverlay,
    searchParams,
    setSearchParams,
    spaces,
    currentSpaceId: selectedSpaceId() ?? bootstrapMe?.spaceId ?? null,
    initialBotsLoaded,
    refreshActiveThread,
  });

  const openSpaceChat = useOpenSpaceChat({
    bootstrapSpaceId: bootstrapMe?.spaceId,
    userId,
    navigate,
    navigationRevision,
    overlayRevision,
    closeMobileSidebar: () => setMobileSidebarOpen(false),
    beginSpaceSwitch: roster.beginSpaceSwitch,
  });
  useLayoutEffect(() => {
    openSpaceChatRef.current = openSpaceChat;
  }, [openSpaceChat]);

  const view = useTranscriptView({
    snapshot,
    inGroup,
    groupId,
    active,
    activeGroup,
    bots,
    archivedBots,
    meId: userId,
  });
  const { activeSnapshot, transcript, composerRunning } = view;
  const { composerMentionTargets } = useComposerMentions({
    rpc,
    queries,
    bots,
    groups,
    inGroup,
    groupId,
    integrationsOpen:
      overlay?.kind === "integrations" ||
      (overlay?.kind === "settings" && overlay.section === "integrations"),
    initialBotsLoaded,
  });
  // Not while the shell is leaving: a roster with nothing anywhere is on its way to onboarding,
  // and a reopened group chat is on its way to that group.
  const showNewBotPrompt =
    initialBotsLoaded &&
    bots.length === 0 &&
    !activeGroup &&
    !routeChat?.groupId &&
    (groups.length > 0 ||
      archivedBots.length > 0 ||
      archivedGroups.length > 0 ||
      spaces.some((space) => space.hasContent) ||
      // Someone who has chatted before, in a new organization: nothing is on its way to them.
      !firstBotDue);
  const shellReady =
    initialBotsLoaded &&
    (inGroup
      ? Boolean(activeGroup && activeSnapshot)
      : bots.length === 0 || Boolean(active && activeSnapshot));

  useShellReadyMarks({
    botsLoaded: initialBotsLoaded,
    active,
    snapshotBotId: snapshot?.botId,
    ready: shellReady,
  });

  const { scrollRequest, clearScrollRequest, jumpToReplyMessage } = useMessageJump({
    rpc,
    queries,
    thread,
    commitComputer,
    transcript,
    active,
    inGroup,
    groupId,
    activeBotId,
    activeGroupId,
    searchParams,
    setSearchParams,
    setPanel,
    setPanelState: rightPanel.setPanelState,
    editRoutine,
    resetRoutineTarget,
  });
  const computerControls = useComputerControls({
    rpc,
    state: computerState,
    panel,
    active,
    docked: screenDockActive,
    bots,
    botsRef,
    activeBotId,
    activeGroupId,
    runStatus: snapshot?.run?.status,
    sandboxProvider: bootstrapMe?.sandboxProvider,
    refreshThread,
    refreshGroupThread: (id) => refreshGroupThreadRef.current(id),
    onUpgrade: () => openSettings("billing"),
    onSendError: (message) => composer.setSendError(message),
  });
  const { computerBot, openComputer } = computerControls;
  const composer = useComposerActions({
    rpc,
    pageSession: pages.session,
    activeId: active?.id,
    inGroup,
    groupId,
    activeBotId,
    activeGroupId,
    botsRef,
    bootstrapMe,
    activeSnapshot,
    navigate,
    refreshBots,
    refreshThreadRef,
    refreshGroupThreadRef,
    updateSnapshot: thread.updateSnapshot,
    terminalRunReceipts,
    computerRef: computerState.computerRef,
    commitComputer,
    clearReadBoundary: read.clearReadBoundary,
    flushPendingBrowserNotifications,
  });
  const { sending, sendError, stopRun } = composer;
  const routineList = useRoutineList({
    rpc,
    queries,
    thread,
    active,
    inGroup,
    activeBotId,
    refreshThread,
    startRoutine,
    stopRun,
    setSendError: composer.setSendError,
  });
  function openChatSettings(kind: "bot" | "group", id: string) {
    const destKey =
      userId && bootstrapMe?.spaceId
        ? rightPanelStorageKey(userId, bootstrapMe.spaceId, kind, id)
        : null;
    rightPanel.openPanelInChat(destKey, kind === "bot" ? "settings" : "group-settings", () =>
      navigate(kind === "bot" ? `/app/${id}` : `/app/g/${id}`),
    );
  }

  useRightPanelRestore({
    rightPanel,
    userId,
    spaceId: bootstrapMe?.spaceId,
    inGroup,
    panelTarget: inGroup ? activeGroup?.id : active?.id,
    activeId: active?.id,
    routines: thread.routines,
    routinesBotId: thread.routinesBotId,
    searchParams,
    editingRoutineId: editingRoutine?.id,
    restoreRoutine,
    leaveRoutine,
  });
  const rosterDrop = useRosterDrop({
    rpc,
    bots,
    reorderRosterBot: roster.reorderRosterBot,
    refreshBots,
    refreshGroupThread: (id) => refreshGroupThreadRef.current(id),
    activeGroupId,
    setSendError: composer.setSendError,
  });

  const { replyToMessage, quoteMessage, markMessageUnread } = useMessageActions({
    activeId: active?.id,
    groupId,
    setReplyTarget: composer.setReplyTarget,
    setReplyQuote: composer.setReplyQuote,
    focusComposer,
    quoteBlocked: computerOpen || mobileSidebarOpen || Boolean(isMobileSidebar && panel),
    markBotUnread: read.markBotUnread,
    markGroupUnreadFrom: read.markGroupUnreadFrom,
  });
  const openPeerMessages = useCallback(
    (peer: { peerBotId: string; peerBotName: string }) => {
      setPeerConversation(peer);
    },
    [setPeerConversation],
  );
  const { teachBusy, stopTeaching, refreshActiveTeaching } = useTeaching({
    rpc,
    queries,
    thread,
    activeBotId,
    refreshThreadRef,
    closeComputer: () => setComputerOpen(false),
  });

  const paletteActions = usePaletteActions({
    me: bootstrapMe,
    messagingEnabled: messagingSurfaceEnabled,
    onNewBot: () => dialogs.setCreateBotOpen(true),
    onNewGroup: () => setPanel("create-group"),
    onNewSpace: () => dialogs.setNewSpaceOpen(true),
    onShortcuts: () => setShortcutsOpen(true),
    setOverlay,
    openSettings,
  });
  const { renameSpace, removeSpace, leftSpace } = useSpaceActions({
    rpc,
    alive,
    setSpaces,
    refreshBots,
    bootstrapMe,
    closePanel: () => setPanel(null),
  });

  function openCreatedBot(bot: Bot) {
    roster.addCreatedBot(bot);
    navigate(`/app/${bot.id}`);
    setPanel(null);
  }

  async function createBot(input: CreateBotDialogInput, client: RpcClient) {
    const isFirstBot = botsRef.current.length === 0;
    const bot = await createBotWithVpn(client, input, vpn.refreshVpn);
    openCreatedBot(bot);
    dialogs.setCreateBotOpen(false);
    await composer.startFocusPrompt(bot.id, isFirstBot);
    await bestEffort("refresh bots after creating one", refreshBots());
  }

  const chatMenu = useChatMenu({
    bots,
    groups,
    rpc,
    sections: botSections,
    spaceId: bootstrapMe?.spaceId,
    refreshBots,
    read,
    snooze,
    dialogs,
    openChatSettings,
    navigate,
    vpn,
    onTeamVpnConfirm: setTeamVpnChoice,
  });
  const shell = (
    <BotsSidebarLayout
      userId={userId}
      collapsed={sidebar.collapsed}
      onCollapsedChange={sidebar.setCollapsedPref}
      onPreviewCollapsedChange={sidebar.setCollapsed}
      computerOpen={computerOpen}
      data-testid="shell-root"
      data-ready={shellReady}
      className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground/90 [&[data-resizing-sidebar]_*[data-slot=sidebar-gap]]:transition-none [&[data-resizing-sidebar]_*[data-slot=sidebar-container]]:transition-none"
      {...swipeHandlers}
    >
      <ComputerUpdateProgress
        onCompleted={() => {
          if (active) void refreshThread(active.id);
        }}
      />
      {bootstrapMe !== undefined ? (
        <HostComputerPrompt initialMe={bootstrapMe ?? undefined} onMeUpdated={setBootstrapMe} />
      ) : null}
      {userId && bootstrapMe ? (
        <TimezonePrompt
          key={userId}
          userId={userId}
          timezone={bootstrapMe.timezone}
          onSaved={(me, adopted) => setBootstrapMe((prev) => withSavedTimezone(prev, me, adopted))}
        />
      ) : null}
      <ShellSidebar
        scrollRef={sidebarScrollRef}
        isMobile={isMobileSidebar}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
        density={botsSidebarDensity}
        collapsed={sidebar.collapsed}
        mini={sidebar.mini}
        setCollapsedPref={sidebar.setCollapsedPref}
        createMenuOpen={createMenuOpen}
        setCreateMenuOpen={setCreateMenuOpen}
        search={search}
        bots={bots}
        groups={groups}
        collapsedSidebarSections={collapsedSidebarSections}
        toggleSidebarSection={toggleSidebarSection}
        setPanel={setPanel}
        navigate={navigate}
        setNewSpaceOpen={dialogs.setNewSpaceOpen}
        setCreateBotOpen={dialogs.setCreateBotOpen}
        chatMenu={chatMenu}
        roster={
          <SidebarRoster
            mini={sidebar.mini}
            sidebarGroups={sidebar.sidebarGroups}
            collapsedSidebarSections={collapsedSidebarSections}
            bootstrapMe={bootstrapMe}
            botSections={botSections}
            spaces={spaces}
            rosterDropKey={rosterDrop.rosterDropKey}
            setRosterDropKey={rosterDrop.setRosterDropKey}
            rosterDropAction={rosterDrop.rosterDropAction}
            applyRosterDrop={rosterDrop.applyRosterDrop}
            openSpaceChat={openSpaceChat}
            openSpaceSettings={openSpaceSettings}
            setRenameSectionTarget={dialogs.setRenameSectionTarget}
            setDeleteSectionTarget={dialogs.setDeleteSectionTarget}
            toggleSidebarSection={toggleSidebarSection}
            inGroup={inGroup}
            active={active}
            activeGroup={activeGroup}
            botsSidebarDensity={botsSidebarDensity}
            dismissedRunErrorIds={composer.dismissedRunErrorIds}
            displayedRunError={composer.displayedRunError}
            draggedBotId={rosterDrop.draggedBotId}
            setDraggedBotId={rosterDrop.setDraggedBotId}
            chatMenu={chatMenu}
            reorderRosterBot={roster.reorderRosterBot}
            activeSnapshot={activeSnapshot}
            vpn={vpn}
          />
        }
        archived={
          <>
            <SnoozedChats
              snoozed={sidebar.snoozed}
              showSpaceSearch={search.showSpaceSearch}
              now={snoozeNow}
              snooze={snooze}
              openSpaceChat={openSpaceChat}
            />
            <ArchivedChats
              archivedBots={archivedBots}
              archivedGroups={archivedGroups}
              showSpaceSearch={search.showSpaceSearch}
              rpc={rpc}
              refreshBots={refreshBots}
              setDeleteTarget={dialogs.setDeleteTarget}
              setDeleteGroupTarget={dialogs.setDeleteGroupTarget}
            />
          </>
        }
        user={session.data?.user}
        boardEnabled={hasLab(bootstrapMe?.labs, "board")}
        navLinks={desktopBridge() ? [] : (bootstrapMe?.navLinks ?? [])}
        openSettings={openSettings}
        openSkills={() => setOverlay({ kind: "skills" })}
        openAgentImport={() => setOverlay({ kind: "import" })}
        openSpaceChat={(targetSpaceId, path) => {
          multiviewOpenPreference.set(false);
          openSpaceChat(targetSpaceId, path);
        }}
        multiviewOpen={multiviewOpen}
        onToggleMultiview={toggleMultiview}
      />

      <ShellChatArea
        rpc={rpc}
        queries={queries}
        userId={userId}
        shellSpaceId={shellSpaceId}
        chatPreferences={chatPreferences}
        userBubble={userBubble}
        active={active}
        activeGroup={activeGroup}
        inGroup={inGroup}
        groupId={groupId}
        view={view}
        composer={composer}
        vpn={vpn}
        computerState={computerState}
        computerControls={computerControls}
        thread={thread}
        scrollRequest={scrollRequest}
        clearScrollRequest={clearScrollRequest}
        jumpToReplyMessage={jumpToReplyMessage}
        read={read}
        loadOlder={loadOlder}
        loadingOlder={loadingOlder}
        refreshActiveThread={refreshActiveThread}
        replyToMessage={replyToMessage}
        quoteMessage={quoteMessage}
        markMessageUnread={markMessageUnread}
        registerQuoteShortcut={registerQuoteShortcut}
        openBot={openBot}
        openPeerMessages={openPeerMessages}
        addSkillRoutine={addSkillRoutine}
        speakingMessageId={speakingMessageId}
        speakMessage={speakMessage}
        callHoldsSpeaker={callHoldsSpeaker}
        openImportSetup={openImportSetup}
        openAgentImport={openAgentImport}
        recordingSkill={recordingSkill}
        composerMentionTargets={composerMentionTargets}
        agentSkills={agentSkills}
        refreshAgentSkills={refreshAgentSkills}
        modelShortcuts={modelShortcuts}
        openSettings={openSettings}
        openChatSettings={openChatSettings}
        setPanel={setPanel}
        setModelFocusRequest={setModelFocusRequest}
        dialogs={dialogs}
        isMobileSidebar={isMobileSidebar}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        panelCoversChat={panelCoversChat}
        chatPanelOpen={chatPanelOpen}
        toggleChatPanel={toggleChatPanel}
        findOpen={findOpen}
        setFindOpen={setFindOpen}
        findInputRef={findInputRef}
        focusComposer={focusComposer}
        call={call}
        openCall={openCall}
        toggleMultiview={toggleMultiview}
        screenDockActive={screenDockActive}
        showNewBotPrompt={showNewBotPrompt}
        roster={roster}
      />

      <PageViewHost />
      <IncomingCall
        bots={[]}
        transcribe={false}
        onAnswered={(botId) => navigate(`/app/${botId}`)}
      />

      <TeamComputerVpnChoice
        vpn={vpn}
        choice={teamVpnChoice}
        onClose={() => setTeamVpnChoice(null)}
      />

      <ShellSidePanel
        rpc={rpc}
        panel={panel}
        setPanel={setPanel}
        active={active}
        activeGroup={activeGroup}
        bots={bots}
        groups={groups}
        setBots={setBots}
        setGroups={setGroups}
        navigate={navigate}
        refreshBots={refreshBots}
        refreshGroupThread={refreshGroupThread}
        discardChatAttachments={composer.discardThreadAttachments}
        onCoversChat={setPanelCoversChat}
        onOverlays={setPanelOverlays}
        computerOpen={computerOpen}
        vpn={vpn}
        computerUsage={
          active ? (
            <BotUsageLine key={active.id} botId={active.id} computer={computerState.computer} />
          ) : null
        }
        computerPanel={
          active ? (
            <ShellComputerPanel
              active={active}
              computerControls={computerControls}
              screenBotId={computerState.screenBotId ?? null}
              shownAbove={screenDockActive && !isMobileSidebar}
              bootstrapMe={bootstrapMe}
              setBootstrapMe={setBootstrapMe}
              openSettings={openSettings}
            />
          ) : null
        }
        routineList={routineList}
        routineEditorProps={routineEditorProps}
        openBot={openBot}
        modelFocusRequest={modelFocusRequest}
        onClearBot={(bot) => dialogs.setClearTarget({ kind: "bot", chat: bot })}
      />

      <Suspense fallback={null}>
        <ShellDialogs
          dialogs={dialogs}
          rpc={rpc}
          bots={bots}
          activeId={active?.id}
          activeGroupId={activeGroup?.id}
          alive={alive}
          navigate={navigate}
          setPanel={setPanel}
          refreshBots={refreshBots}
          closeMobileSidebar={() => setMobileSidebarOpen(false)}
          createBot={createBot}
          botAvatarSet={bootstrapMe?.botAvatarSet ?? DEFAULT_NEW_BOT_AVATAR_SET}
          vpn={vpn.overview?.supported ? vpn : undefined}
          discardChatAttachments={composer.discardThreadAttachments}
          clearOpenThread={thread.clearOpenThread}
          deleteRoutineDialogProps={deleteRoutineDialogProps}
          paletteActions={paletteActions}
        />
        <AppOverlays
          overlay={overlay}
          setOverlay={setOverlay}
          activeBotId={activeBotId.current}
          stdioEnabled={bootstrapMe?.mcpStdioEnabled === true}
          messagingEnabled={messagingSurfaceEnabled}
          onOpenBot={(bot) => {
            openCreatedBot(bot);
            void bestEffort("refresh bots after opening one", refreshBots());
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsOverlays
          rpc={rpc}
          queries={queries}
          overlay={overlay}
          setOverlay={setOverlay}
          settingsSpace={settingsSpace}
          showSettings={settingsSpaceId === null || Boolean(settingsSpace)}
          spaces={spaces}
          renameSpace={renameSpace}
          removeSpace={removeSpace}
          leftSpace={leftSpace}
          refreshSpaces={() => refreshBots()}
          alive={alive}
          user={session.data?.user}
          refetchSession={() => session.refetch({ query: { disableCookieCache: true } })}
          bootstrapMe={bootstrapMe}
          setBootstrapMe={setBootstrapMe}
          messagingEnabled={messagingSurfaceEnabled}
          memoryConfig={memoryProviderConfig}
          peerConversation={peerConversation}
          setPeerConversation={setPeerConversation}
          active={active}
          peerBot={view.resolveBot}
          openNewSpace={() => dialogs.setNewSpaceOpen(true)}
          vpn={vpn}
          botNames={botNames}
        />
      </Suspense>

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        host={{ desktop: Boolean(desktopBridge()), apple: isApplePlatform() }}
        dictation={false}
        modelPicker={chatPreferences.composerModelPicker}
      />

      {computerOpen && computerBot ? (
        <ComputerOverlay
          {...computerControls.screenProps}
          screenBotId={computerState.screenBotId ?? null}
          bot={computerBot}
          computerViewport={computerState.computerViewport}
          recordingSkill={recordingSkill}
          teachBusy={teachBusy}
          hasControl={computerControls.hasControl}
          composerRunning={composerRunning}
          sending={sending}
          sendError={sendError}
          onStopTeaching={stopTeaching}
          onStopRun={() => void stopRun()}
          onRelease={computerControls.releaseComputer}
          onTakeControl={() => void openComputer(computerBot.id, true)}
          onStart={() => void openComputer(computerBot.id)}
          onRefreshTeaching={refreshActiveTeaching}
          onClose={() => setComputerOpen(false)}
        />
      ) : null}
    </BotsSidebarLayout>
  );

  // Render nothing until the first bot list lands so the chat chrome does not flash a bot-less state.
  return (
    <SpaceRpcProvider spaceId={shellSpaceId}>
      {initialBotsLoaded || initialLoadFailed ? (
        <BondbotUpdateProvider>
          <InboundOriginProvider value={bootstrapMe?.inboundOrigin}>
            <PagesProvider value={pages}>{shell}</PagesProvider>
          </InboundOriginProvider>
        </BondbotUpdateProvider>
      ) : (
        <PageLoading />
      )}
    </SpaceRpcProvider>
  );
}
