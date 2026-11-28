import { Trans } from "@lingui/react/macro";
import { bestEffort } from "@rakazo/logging/best-effort";
import { Button } from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { ModelEdgeGlow } from "../../../components/ModelEdgeGlow";
import { toolActivityPreference } from "../../../lib/chat/tool-activity-preference";
import { composerEnterToSendPreference } from "../../../lib/composer/composer-enter-to-send-pref";
import type { useChatPreferences } from "../../../lib/preferences/chat-preferences";
import { multiviewOpenPreference } from "../../../lib/preferences/multiview-pref";
import type { spaceQueries } from "../../../lib/query/query";
import type { createSpaceRpc, selectedSpaceId } from "../../../lib/query/rpc";
import { screenDockPreference } from "../../../lib/screen-dock";
import { ChatComposerArea } from "../composer/chat-composer-area";
import type { useComposerActions } from "../composer/use-composer-actions";
import type { useComposerModelShortcuts } from "../composer/use-composer-model-shortcuts";
import type { useComputerState } from "../computers/use-computer";
import type { useComputerControls } from "../computers/use-computer-controls";
import { DockedScreen } from "../DockedScreen";
import type { MultiviewWorkspace as MultiviewWorkspaceType } from "../multiview/MultiviewWorkspace";
import type { useShellDialogs } from "../shell-dialogs";
import type { useMobileSidebar } from "../sidebar/use-mobile-sidebar";
import type { useSpaceRoster } from "../sidebar/use-space-roster";
import type { useActiveChat } from "../use-active-chat";
import type { useBotCall } from "../use-bot-call";
import type { ComputerVpnController } from "../use-computer-vpn";
import type { useShellSettings } from "../use-shell-settings";
import { ChatColumn } from "./chat-column";
import { ChatHeader } from "./chat-header";
import { Transcript } from "./transcript";
import type { useChatRead } from "./use-chat-read";
import type { useMessageActions } from "./use-message-actions";
import type { useMessageJump } from "./use-message-jump";
import type { useThreadState } from "./use-thread-state";
import type { useThreadSync } from "./use-thread-sync";
import type { useTranscriptView } from "./use-transcript-view";

const MultiviewWorkspace = lazy(() =>
  import("../multiview/MultiviewWorkspace").then((module) => ({
    default: module.MultiviewWorkspace,
  })),
);

type Roster = ReturnType<typeof useSpaceRoster>;
type View = ReturnType<typeof useTranscriptView>;
type Jump = ReturnType<typeof useMessageJump>;
type Sync = ReturnType<typeof useThreadSync>;
type Actions = ReturnType<typeof useMessageActions>;
type Composer = ComponentProps<typeof ChatComposerArea>;
type TranscriptProps = ComponentProps<typeof Transcript>;
type Multiview = ComponentProps<typeof MultiviewWorkspaceType>;

/** The middle of the shell: the open chat, or Multiview in its place. */
export function ShellChatArea({
  rpc,
  queries,
  userId,
  shellSpaceId,
  chatPreferences,
  userBubble,
  active,
  activeGroup,
  inGroup,
  groupId,
  view,
  composer,
  vpn,
  computerState,
  computerControls,
  thread,
  scrollRequest,
  clearScrollRequest,
  jumpToReplyMessage,
  read,
  loadOlder,
  loadingOlder,
  refreshActiveThread,
  replyToMessage,
  quoteMessage,
  markMessageUnread,
  registerQuoteShortcut,
  openBot,
  openPeerMessages,
  addSkillRoutine,
  speakingMessageId,
  speakMessage,
  callHoldsSpeaker,
  openImportSetup,
  openAgentImport,
  recordingSkill,
  composerMentionTargets,
  agentSkills,
  refreshAgentSkills,
  modelShortcuts,
  openSettings,
  openChatSettings,
  setPanel,
  setModelFocusRequest,
  dialogs,
  isMobileSidebar,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  panelCoversChat,
  chatPanelOpen,
  toggleChatPanel,
  findOpen,
  setFindOpen,
  findInputRef,
  focusComposer,
  call,
  openCall,
  toggleMultiview,
  screenDockActive,
  showNewBotPrompt,
  roster,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: ReturnType<typeof spaceQueries>;
  userId: Multiview["meId"];
  shellSpaceId: ReturnType<typeof selectedSpaceId>;
  chatPreferences: ReturnType<typeof useChatPreferences>;
  userBubble: ReturnType<typeof useActiveChat>["userBubble"];
  active: ReturnType<typeof useActiveChat>["active"];
  activeGroup: ReturnType<typeof useActiveChat>["activeGroup"];
  inGroup: boolean;
  groupId: string | undefined;
  view: View;
  composer: ReturnType<typeof useComposerActions>;
  vpn: ComputerVpnController;
  computerState: ReturnType<typeof useComputerState>;
  computerControls: ReturnType<typeof useComputerControls>;
  thread: ReturnType<typeof useThreadState>;
  scrollRequest: Jump["scrollRequest"];
  clearScrollRequest: Jump["clearScrollRequest"];
  jumpToReplyMessage: Jump["jumpToReplyMessage"];
  read: ReturnType<typeof useChatRead>;
  loadOlder: Sync["loadOlder"];
  loadingOlder: Sync["loadingOlder"];
  refreshActiveThread: Sync["refreshActiveThread"];
  replyToMessage: Actions["replyToMessage"];
  quoteMessage: Actions["quoteMessage"];
  markMessageUnread: Actions["markMessageUnread"];
  registerQuoteShortcut: TranscriptProps["onQuoteShortcutChange"];
  openBot: (id: string) => void;
  openPeerMessages: TranscriptProps["onOpenPeerMessages"];
  addSkillRoutine: TranscriptProps["onAddRoutine"];
  speakingMessageId: TranscriptProps["speakingMessageId"];
  speakMessage: TranscriptProps["onSpeak"];
  callHoldsSpeaker: TranscriptProps["callHoldsSpeaker"];
  openImportSetup: TranscriptProps["onOpenImportSetup"];
  openAgentImport: TranscriptProps["onOpenAgentImport"];
  recordingSkill: unknown;
  composerMentionTargets: Composer["mentionTargets"];
  agentSkills: Composer["agentSkills"];
  refreshAgentSkills: Composer["onSlashOpen"];
  modelShortcuts: ReturnType<typeof useComposerModelShortcuts>;
  openSettings: ReturnType<typeof useShellSettings>["openSettings"];
  openChatSettings: Composer["openChatSettings"];
  setPanel: Composer["setPanel"];
  setModelFocusRequest: Composer["setModelFocusRequest"];
  dialogs: ReturnType<typeof useShellDialogs>;
  isMobileSidebar: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: ReturnType<typeof useMobileSidebar>["setMobileSidebarOpen"];
  panelCoversChat: boolean;
  chatPanelOpen: boolean;
  toggleChatPanel: () => void;
  findOpen: boolean;
  setFindOpen: (open: boolean) => void;
  findInputRef: ComponentProps<typeof ChatColumn>["findInputRef"];
  focusComposer: () => void;
  call: ReturnType<typeof useBotCall>["call"];
  openCall: ReturnType<typeof useBotCall>["openCall"];
  toggleMultiview: () => void;
  screenDockActive: boolean;
  showNewBotPrompt: boolean;
  roster: Roster;
}) {
  const { bootstrapMe, bots, botsRef, archivedBots, setBots, refreshBots } = roster;
  const { computerBot, openComputer } = computerControls;
  const { computerOpen } = computerState;
  const { activeSnapshot, composerRunning } = view;
  const multiviewOpen = multiviewOpenPreference.use();
  const screenDockOn = screenDockPreference.use();
  const showToolActivity = toolActivityPreference.use();
  const enterToSend = composerEnterToSendPreference.use();
  return (
    <>
      {multiviewOpen ? (
        <Suspense fallback={null}>
          <MultiviewWorkspace
            spaceId={bootstrapMe?.spaceId ?? shellSpaceId ?? "default"}
            isMobile={isMobileSidebar}
            drawerOpen={mobileSidebarOpen}
            covered={panelCoversChat}
            bots={bots}
            botsRef={botsRef}
            archivedBots={archivedBots}
            activeBotId={active?.id}
            rpc={rpc}
            queries={queries}
            meId={userId}
            streamReplies={chatPreferences.streamReplies}
            showToolActivity={showToolActivity}
            sandboxProvider={bootstrapMe?.sandboxProvider}
            vpn={vpn}
            maximizedBotId={computerOpen ? (computerBot?.id ?? null) : null}
            onOpenNavigation={() => setMobileSidebarOpen(true)}
            onMaximize={(targetBotId) => void openComputer(targetBotId)}
            onOpenFullChat={openBot}
            onOpenBot={openBot}
            onCreateBot={() => dialogs.setCreateBotOpen(true)}
            onExit={() => multiviewOpenPreference.set(false)}
            refreshBots={refreshBots}
            onBotUpdated={(updated) =>
              setBots((current) => current.map((bot) => (bot.id === updated.id ? updated : bot)))
            }
            onUpgrade={() => openSettings("billing")}
            onSendError={(message) => composer.setSendError(message)}
          />
        </Suspense>
      ) : (
        <ChatColumn
          drawerOpen={mobileSidebarOpen}
          covered={panelCoversChat}
          findOpen={findOpen}
          findInputRef={findInputRef}
          onCloseFind={() => {
            setFindOpen(false);
            focusComposer();
          }}
          header={
            <>
              {active && !inGroup ? (
                <ModelEdgeGlow provider={active.modelProvider} modelId={active.modelId} />
              ) : null}
              <ChatHeader
                inGroup={inGroup}
                active={active}
                activeGroup={activeGroup}
                activeSnapshot={activeSnapshot}
                phoneCallsEnabled={false}
                meetingsEnabled={Boolean(bootstrapMe?.meetingsEnabled)}
                voiceReady={false}
                inCall={Boolean(active) && call?.botId === active?.id}
                panelOpen={chatPanelOpen}
                onOpenNavigation={() => setMobileSidebarOpen(true)}
                onTogglePanel={toggleChatPanel}
                onCall={openCall}
                vpn={vpn}
                screenDocked={screenDockActive}
                onToggleScreenDock={() => screenDockPreference.set(!screenDockOn)}
                multiviewOpen={multiviewOpen}
                onToggleMultiview={toggleMultiview}
                onSwitchModel={async (choice) => {
                  if (!active) return undefined;
                  // Resolves only once the server has saved the switch; a failure throws.
                  const updated = await rpc.bots.update({
                    botId: active.id,
                    modelProvider: choice.provider,
                    modelId: choice.modelId,
                  });
                  setBots((current) =>
                    current.map((bot) => (bot.id === updated.id ? updated : bot)),
                  );
                  void bestEffort("refresh bots after a model switch", refreshBots());
                  return {
                    provider: updated.modelProvider ?? choice.provider,
                    modelId: updated.modelId ?? choice.modelId,
                  };
                }}
              />
              {screenDockActive && active && !computerOpen ? (
                <DockedScreen
                  bot={active}
                  computer={computerState.computer}
                  embeddedScreenUrl={computerControls.embeddedScreenUrl}
                  screenBotId={computerState.screenBotId ?? null}
                  screenFrameKey={computerState.screenFrameKey}
                  heldScreen={computerState.heldScreen}
                  screenFrameRef={
                    chatPanelOpen && isMobileSidebar ? undefined : computerState.setScreenFrame
                  }
                  computerScreenError={computerControls.computerScreenError}
                  computerBooting={computerControls.computerBooting}
                  booting={computerState.booting}
                  onWake={() => void openComputer(undefined, false, true)}
                  onRefresh={computerControls.refreshDockedComputer}
                  hasControl={computerControls.hasControl}
                  onTakeControl={computerControls.takeDockedControl}
                  onRelease={() => computerControls.releaseComputer()}
                  onOpenFullWindow={() => void openComputer(active.id)}
                  onClose={() => screenDockPreference.set(false)}
                />
              ) : null}
            </>
          }
          composer={
            <ChatComposerArea
              composer={composer}
              inGroup={inGroup}
              groupId={groupId}
              active={active}
              activeGroup={activeGroup}
              activeSnapshot={activeSnapshot}
              meId={userId}
              memberName={view.resolveMemberName}
              recordingSkill={Boolean(recordingSkill)}
              running={composerRunning}
              enterToSend={enterToSend}
              sendColors={userBubble}
              modelPicker={chatPreferences.composerModelPicker ? modelShortcuts.pickerProps : null}
              onBotSaved={(updated) =>
                setBots((current) => current.map((bot) => (bot.id === updated.id ? updated : bot)))
              }
              phoneCallsEnabled={false}
              dictationTranscribe={false}
              artifactTarget={view.artifactTarget}
              mentionTargets={composerMentionTargets}
              agentSkills={agentSkills}
              onSlashOpen={refreshAgentSkills}
              openSettings={openSettings}
              openChatSettings={openChatSettings}
              setPanel={setPanel}
              setModelFocusRequest={setModelFocusRequest}
            />
          }
        >
          {showNewBotPrompt ? (
            <div className="grid flex-1 place-items-center">
              <Button onClick={() => dialogs.setCreateBotOpen(true)}>
                <Plus size={16} aria-hidden="true" />
                <Trans>New bot</Trans>
              </Button>
            </div>
          ) : (
            <div className={`flex min-h-0 flex-1 flex-col ${screenDockActive ? "-mt-20" : ""}`}>
              <Transcript
                key={activeSnapshot?.threadId}
                meId={userId}
                scrollRef={thread.messageScroll}
                scrollRequest={scrollRequest}
                onScrollRequestHandled={clearScrollRequest}
                {...view.transcriptProps}
                {...composer.transcriptProps}
                markedUnreadMessageId={read.markedUnreadMessageId}
                showToolActivity={showToolActivity}
                unreadAfterSeq={read.unreadAfterSeq}
                loadingOlder={loadingOlder}
                userBubble={userBubble}
                onCallBack={undefined}
                onLoadOlder={loadOlder}
                onOpenBot={openBot}
                onAnswer={composer.answerMessage}
                onReply={replyToMessage}
                onMarkUnread={markMessageUnread}
                onQuote={quoteMessage}
                onQuoteShortcutChange={registerQuoteShortcut}
                onReact={composer.reactToMessage}
                onJumpToMessage={jumpToReplyMessage}
                onOpenPeerMessages={openPeerMessages}
                onRefresh={refreshActiveThread}
                onBotChanged={refreshBots}
                onAddRoutine={addSkillRoutine}
                voiceReady={false}
                speakingMessageId={speakingMessageId}
                callHoldsSpeaker={callHoldsSpeaker}
                onSpeak={speakMessage}
                onOpenComputer={computerControls.onOpenComputer}
                onReleaseComputer={computerControls.onReleaseComputer}
                onOpenImportSetup={openImportSetup}
                onOpenAgentImport={openAgentImport}
                onConnectModel={() => openSettings("models")}
                rpc={rpc}
              />
            </div>
          )}
        </ChatColumn>
      )}
    </>
  );
}
