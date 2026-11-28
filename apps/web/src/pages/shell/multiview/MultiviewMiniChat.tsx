import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  ComputerReleaseReason,
  LoginFieldInput,
  MessageReaction,
  ThreadMessage,
} from "@rakazo/contracts";
import { chatUserBubbleColors } from "@rakazo/core";
import { Button, cn } from "@rakazo/ui-web";
import { ArrowUp, ChevronDown, ChevronUp, ExternalLink, Square } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useRef, useState } from "react";
import type { createSpaceRpc } from "../../../lib/query/rpc";
import { Transcript } from "../chat/transcript";
import type { useTranscriptView } from "../chat/use-transcript-view";
import {
  MULTIVIEW_DEFAULT_CHAT_HEIGHT,
  MULTIVIEW_MAX_CHAT_HEIGHT,
  MULTIVIEW_MIN_CHAT_HEIGHT,
  wheelPixels,
} from "./multiview-state";

/** How far one arrow key press moves the divider. */
const KEY_STEP = 24;

/**
 * A Multiview tile's chat. Under a screen it is a drawer with a divider that drags, scrolls or
 * takes arrow keys; with `fill` it is the tile's whole chat column.
 * Reuses `Transcript` so live streaming, tool steps, and inline cards stay identical.
 */
export function MultiviewMiniChat({
  bot,
  rpc,
  meId,
  showToolActivity,
  view,
  running,
  loadingOlder,
  followRequest,
  scrollRef,
  fill = false,
  chatHeight,
  drawerRef,
  onChangeChatHeight,
  onResizeChat,
  sending,
  sendError,
  stopping,
  onSend,
  onStop,
  onLoadOlder,
  onAnswer,
  onReact,
  onRefresh,
  onBotChanged,
  onOpenBot,
  onOpenFullChat,
  onOpenComputer,
  onReleaseComputer,
}: {
  bot: Bot;
  rpc: ReturnType<typeof createSpaceRpc>;
  meId: string | undefined;
  showToolActivity: boolean;
  view: ReturnType<typeof useTranscriptView>;
  running: boolean;
  loadingOlder: boolean;
  followRequest: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  fill?: boolean;
  chatHeight: number;
  drawerRef: RefObject<HTMLDivElement | null>;
  onChangeChatHeight: (height: number) => void;
  /** Grows the drawer by this many pixels; negative shrinks it. */
  onResizeChat: (delta: number) => void;
  sending: boolean;
  sendError: string | null;
  stopping: boolean;
  onSend: (text: string, onSent: () => void) => void;
  onStop: () => void;
  onLoadOlder: () => Promise<void>;
  onAnswer: (
    message: ThreadMessage,
    text: string,
    fields?: LoginFieldInput[],
    dismiss?: boolean,
    remember?: false,
  ) => Promise<void>;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  onRefresh: () => Promise<void>;
  onBotChanged: () => Promise<void>;
  onOpenBot: (botId: string) => void;
  onOpenFullChat: () => void;
  onOpenComputer: (botId?: string, takeControl?: boolean) => void;
  onReleaseComputer: (
    botId: string,
    runId: string | undefined,
    reason: ComputerReleaseReason,
  ) => Promise<void>;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  const [scrollRequest, setScrollRequest] = useState<{
    messageId: string;
    nonce: number;
  } | null>(null);
  const lastOpenHeightRef = useRef(chatHeight > 0 ? chatHeight : MULTIVIEW_DEFAULT_CHAT_HEIGHT);
  if (chatHeight > 0) lastOpenHeightRef.current = chatHeight;

  const dragRef = useRef<number | null>(null);
  // Set by the show and hide button, so only that animates.
  const [animate, setAnimate] = useState(false);

  const collapsed = !fill && chatHeight === 0;
  const trimmed = draft.trim();

  function submit() {
    if (!trimmed || sending) return;
    onSend(trimmed, () => setDraft(""));
  }

  function resize(delta: number) {
    setAnimate(false);
    onResizeChat(delta);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (collapsed || (event.target as Element).closest("button")) return;
    event.preventDefault();
    // Captured, so the drag keeps following over the screen's frame.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = event.clientY;
  }

  function drag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current === null) return;
    const delta = dragRef.current - event.clientY;
    dragRef.current = event.clientY;
    if (delta) resize(delta);
  }

  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-background/95",
        fill ? "flex-1" : "border-t border-border/70",
      )}
    >
      {fill ? null : (
        <div
          data-testid={`multiview-divider-${bot.id}`}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(event) => resize(-wheelPixels(event))}
          className={cn(
            "group/divider flex shrink-0 touch-none items-center justify-between gap-2 px-2.5 py-1 text-caption text-muted-foreground select-none",
            !collapsed && "cursor-ns-resize",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setAnimate(true);
              onChangeChatHeight(collapsed ? lastOpenHeightRef.current : 0);
            }}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t`Show chat for ${bot.name}` : t`Hide chat for ${bot.name}`}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <ChevronUp size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            )}
            <span>{collapsed ? t`Show chat` : t`Chat`}</span>
            {running ? (
              <span className="ms-1 inline-block size-1.5 rounded-full bg-emerald-400" />
            ) : null}
          </button>
          {/* biome-ignore lint/a11y/useSemanticElements: a draggable divider is a custom separator. */}
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={`Resize chat for ${bot.name}`}
            aria-valuemin={MULTIVIEW_MIN_CHAT_HEIGHT}
            aria-valuemax={MULTIVIEW_MAX_CHAT_HEIGHT}
            aria-valuenow={chatHeight}
            title="Drag or scroll to resize"
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              resize(event.key === "ArrowUp" ? KEY_STEP : -KEY_STEP);
            }}
            className="flex h-4 flex-1 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="h-1 w-12 rounded-full bg-border transition-colors group-hover/divider:bg-foreground/40" />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t`Open full chat for ${bot.name}`}
            onClick={onOpenFullChat}
            className="text-muted-foreground"
          >
            <ExternalLink size={12} strokeWidth={1.9} aria-hidden="true" />
          </Button>
        </div>
      )}

      <div
        ref={drawerRef}
        data-animate={animate || undefined}
        className={cn("mv-chat-drawer flex min-h-0 flex-col overflow-hidden", fill && "flex-1")}
        style={fill ? undefined : { height: collapsed ? 0 : chatHeight }}
        aria-hidden={collapsed || undefined}
        inert={collapsed || undefined}
      >
        <div
          className={cn(
            "relative flex min-h-0 flex-1 flex-col [&_.rk-scroll]:px-2.5 [&_.rk-scroll]:pt-2 [&_.rk-scroll]:pb-2",
            fill ? "text-body" : "text-body-sm",
          )}
        >
          {(view.activeSnapshot?.messages.length ?? 0) === 0 && !running ? (
            <div className="grid flex-1 place-items-center px-3 text-center text-caption text-muted-foreground">
              <span>{t`Send a message to ${bot.name}`}</span>
            </div>
          ) : (
            <Transcript
              key={view.activeSnapshot?.threadId ?? bot.id}
              meId={meId}
              scrollRef={scrollRef}
              scrollRequest={scrollRequest}
              onScrollRequestHandled={() => setScrollRequest(null)}
              followRequest={followRequest}
              {...view.transcriptProps}
              showToolActivity={showToolActivity}
              unreadAfterSeq={null}
              loadingOlder={loadingOlder}
              userBubble={chatUserBubbleColors(bot.color, bot.id)}
              speakingMessageId={null}
              onLoadOlder={onLoadOlder}
              onOpenBot={onOpenBot}
              onAnswer={onAnswer}
              onReply={() => onOpenFullChat()}
              onMarkUnread={() => {}}
              onQuote={() => onOpenFullChat()}
              onReact={onReact}
              onJumpToMessage={(messageId) =>
                setScrollRequest((prev) => ({ messageId, nonce: (prev?.nonce ?? 0) + 1 }))
              }
              onOpenPeerMessages={() => onOpenFullChat()}
              onRefresh={onRefresh}
              onBotChanged={onBotChanged}
              onAddRoutine={() => onOpenFullChat()}
              voiceReady={false}
              callHoldsSpeaker={false}
              onSpeak={() => {}}
              onOpenComputer={onOpenComputer}
              onReleaseComputer={onReleaseComputer}
              rpc={rpc}
            />
          )}
        </div>

        {sendError ? (
          <div role="alert" className="px-2.5 pb-1 text-caption text-destructive">
            {sendError}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex items-end gap-1.5 border-t border-border/50 px-2 py-1.5"
        >
          <textarea
            rows={fill ? 2 : 1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={t`Message ${bot.name}`}
            aria-label={t`Message ${bot.name}`}
            className={cn(
              "min-h-7 flex-1 resize-none rounded-lg bg-muted/60 px-2.5 py-1 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
              fill ? "max-h-40 field-sizing-content text-body" : "max-h-20 text-body-sm",
            )}
          />
          {running && !trimmed ? (
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              aria-label={t`Stop ${bot.name}`}
              disabled={stopping}
              onClick={onStop}
            >
              <Square size={11} className="fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="default"
              size="icon-xs"
              aria-label={t`Send to ${bot.name}`}
              disabled={!trimmed || sending}
            >
              <ArrowUp size={13} strokeWidth={2.2} aria-hidden="true" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
