import { useLingui } from "@lingui/react/macro";
import type { Bot, Me } from "@rakazo/contracts";
import { connectedModelChoices, modelOptionKey } from "@rakazo/core";
import { computerPreviewPlaceholder } from "@rakazo/i18n/computer-preview";
import { bestEffort } from "@rakazo/logging/best-effort";
import {
  BotAvatar,
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  Hand,
  Maximize2,
  Monitor,
  MonitorOff,
  MoreHorizontal,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AsleepMoon } from "../../../components/computers/AsleepMoon";
import { screenshotFileName } from "../../../components/computers/SaveScreenshotButton";
import { ModelBrandIcon, modelBrandKey } from "../../../components/ModelBrandIcon";
import { ASLEEP_AVATAR_CLASS, isBotAsleep } from "../../../lib/computers/bot-asleep";
import { runsOnUserMachine } from "../../../lib/computers/computer-sandbox";
import { screenFrames, screenIframeSandbox } from "../../../lib/computers/computer-screen";
import { shortModelLabel } from "../../../lib/model-label";
import { decodeArtifactBase64, downloadArtifactBytes } from "../../../lib/pages/artifact-open";
import type { SpaceQueries } from "../../../lib/query/query";
import { useSave, useSpaceQueries } from "../../../lib/query/query";
import type { createSpaceRpc } from "../../../lib/query/rpc";
import { ComputerVpnFlagChip, ComputerVpnPopover } from "../computer-vpn-control";
import { DesktopKindEmptyState, resolveOwnedComputerScreen } from "../computers/computer-view";
import type { ComputerVpnController } from "../use-computer-vpn";
import { MultiviewMiniChat } from "./MultiviewMiniChat";
import type { MultiviewLayout } from "./multiview-state";
import { MULTIVIEW_DEFAULT_CHAT_HEIGHT, resizedChatHeight, wheelPixels } from "./multiview-state";
import { useMultiviewTile } from "./use-multiview-tile";

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

/**
 * One live tile in Multiview: header with bot swap + control + full options menu,
 * live view-only/interactive computer screen, and collapsible mini chat below.
 */
export function MultiviewTile({
  bot,
  bots,
  botsRef,
  archivedBots,
  rpc,
  queries,
  meId,
  streamReplies,
  showToolActivity,
  sandboxProvider,
  vpn,
  maximizedHere,
  isMobile,
  layout = "screens",
  screenClosed = false,
  onToggleScreen,
  chatHeight,
  canRemove,
  onChangeChatHeight,
  onSwapBot,
  onRemoveTile,
  onMaximize,
  onOpenFullChat,
  onOpenBot,
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
  showToolActivity: boolean;
  sandboxProvider: Me["sandboxProvider"] | undefined;
  vpn: ComputerVpnController;
  maximizedHere: boolean;
  isMobile: boolean;
  layout?: MultiviewLayout;
  screenClosed?: boolean;
  /** Absent where the layout shows no screens at all. */
  onToggleScreen?: () => void;
  chatHeight: number | undefined;
  canRemove: boolean;
  onChangeChatHeight: (height: number) => void;
  onSwapBot: (nextBotId: string) => void;
  onRemoveTile: () => void;
  onMaximize: (botId: string) => void;
  onOpenFullChat: (botId: string) => void;
  onOpenBot: (botId: string) => void;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  onBotUpdated: (updated: Bot) => void;
  onUpgrade: () => void;
  onSendError: (message: string) => void;
}) {
  const { t } = useLingui();
  const tile = useMultiviewTile({
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
  });

  const [swapOpen, setSwapOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const [taking, setTaking] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  /** Chat column with the computer as a small window at its top end. */
  const chats = layout === "chats";
  const closed = layout === "text" || screenClosed;
  /** Without a large screen above it, the chat takes the whole tile. */
  const fillChat = layout !== "screens" || closed;

  const owned = resolveOwnedComputerScreen(
    bot.id,
    tile.computer,
    tile.computerControls.embeddedScreenUrl,
    tile.computerState.screenBotId ?? null,
    tile.computerState.heldScreen,
  );
  const computer = owned.computer;
  const embeddedScreenUrl = owned.embeddedScreenUrl;
  const heldScreen = owned.heldScreen;
  const booting = tile.computerState.booting;
  const running = computer?.state === "running";
  const showing =
    !maximizedHere &&
    running &&
    Boolean(embeddedScreenUrl) &&
    !tile.computerControls.computerScreenError;
  const controlling = Boolean(tile.computerControls.hasControl && showing);
  const drawnAsleep = isBotAsleep(bot, computer?.state);
  const asleep =
    !maximizedHere &&
    !showing &&
    !booting &&
    !tile.computerControls.computerBooting &&
    !tile.computerControls.computerScreenError &&
    !runsOnUserMachine(computer) &&
    (!computer || computer.state === "stopped" || computer.state === "suspended");

  useEffect(() => {
    setConfirmTakeover(false);
  }, [bot.id, showing, controlling]);

  const screenshot = useSave({
    save: async (_input: undefined, client) => {
      const { image } = await client.computer.preview({ botId: bot.id });
      const match = image ? DATA_URL.exec(image) : null;
      if (!match?.[1] || !match[2]) throw new Error("The computer returned no screen image");
      return { mimeType: match[1], bytes: decodeArtifactBase64(match[2]) };
    },
    onSaved: ({ mimeType, bytes }) =>
      downloadArtifactBytes(screenshotFileName(mimeType, new Date()), mimeType, bytes),
  });

  async function takeControl() {
    if (taking) return;
    setConfirmTakeover(false);
    setTaking(true);
    try {
      await tile.computerControls.takeDockedControl();
    } finally {
      setTaking(false);
    }
  }

  function requestControl() {
    if (!showing || controlling || taking) return;
    if (computer?.controlHolder === "bot") {
      setConfirmTakeover(true);
      return;
    }
    void takeControl();
  }

  const defaultChatHeight = isMobile ? 124 : MULTIVIEW_DEFAULT_CHAT_HEIGHT;
  const effectiveChatHeight = chatHeight ?? defaultChatHeight;
  function resizeChat(delta: number) {
    const height =
      effectiveChatHeight === 0 ? 0 : drawerRef.current?.offsetHeight || effectiveChatHeight;
    const next = resizedChatHeight(height, delta);
    if (next !== effectiveChatHeight) onChangeChatHeight(next);
  }
  const botVpn = vpn.overview?.supported ? vpn.overview.bots[bot.id] : undefined;
  const liveBots = bots.filter((candidate) => !candidate.archivedAt);

  return (
    <section
      data-testid={`multiview-tile-${bot.id}`}
      className={cn(
        "mv-tile flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/70 shadow-sm",
        controlling
          ? "mv-tile-controlled border-emerald-400/60"
          : "border-border/80 hover:border-border",
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/60 px-2.5 py-1.5">
        <Popover open={swapOpen} onOpenChange={setSwapOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={t`Select computer (${bot.name})`}
                className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-start transition-colors hover:bg-muted/70"
              />
            }
          >
            <BotAvatar
              avatarSet={bot.avatarSet}
              color={bot.color}
              identity={bot.id}
              size={22}
              status={bot.status}
              className={drawnAsleep ? ASLEEP_AVATAR_CLASS : undefined}
            />
            <span className="truncate text-body-sm font-medium text-foreground" dir="auto">
              {bot.name}
            </span>
            {drawnAsleep ? <AsleepMoon /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                controlling
                  ? "bg-emerald-400"
                  : running
                    ? "bg-emerald-500/80"
                    : booting
                      ? "bg-amber-400"
                      : "bg-muted-foreground/40",
              )}
            />
            <ChevronDown size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 gap-0 p-1.5">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t`Choose computer`}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {liveBots.map((candidate) => {
                const selected = candidate.id === bot.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      setSwapOpen(false);
                      if (!selected) onSwapBot(candidate.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-body-sm transition-colors",
                      selected ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    <BotAvatar
                      avatarSet={candidate.avatarSet}
                      color={candidate.color}
                      identity={candidate.id}
                      size={20}
                      status={candidate.status}
                    />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {candidate.name}
                    </span>
                    {candidate.computerMode === "dedicated" ? (
                      <span className="text-[10px] text-muted-foreground">{t`Dedicated`}</span>
                    ) : null}
                    {selected ? <Check size={14} className="shrink-0 text-emerald-400" /> : null}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex shrink-0 items-center gap-1">
          {controlling ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => void tile.computerControls.releaseComputer()}
              className="text-emerald-400"
            >
              <Hand size={12} aria-hidden="true" />
              <span>{t`Hand back`}</span>
            </Button>
          ) : showing && !chats && !closed ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={taking}
              onClick={requestControl}
            >
              <span>{t`Control`}</span>
            </Button>
          ) : null}

          {onToggleScreen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${closed ? "Show" : "Close"} screen of ${bot.name}`}
              title={closed ? "Show screen" : "Close screen"}
              onClick={onToggleScreen}
              className="text-muted-foreground"
            >
              {closed ? (
                <Monitor size={13} strokeWidth={1.85} aria-hidden="true" />
              ) : (
                <MonitorOff size={13} strokeWidth={1.85} aria-hidden="true" />
              )}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t`Maximize ${bot.name}`}
            onClick={() => onMaximize(bot.id)}
            className="text-muted-foreground"
          >
            <Maximize2 size={13} strokeWidth={1.85} aria-hidden="true" />
          </Button>

          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t`More options for ${bot.name}`}
                  className="text-muted-foreground"
                />
              }
            >
              <MoreHorizontal size={14} strokeWidth={1.9} aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 gap-1 p-1.5">
              {!runsOnUserMachine(computer) ? (
                running ? (
                  <MenuRow
                    icon={<PowerOff size={14} aria-hidden="true" />}
                    label={tile.powerOff.pending ? t`Turning off…` : t`Turn off computer`}
                    danger
                    disabled={tile.powerOff.pending}
                    onClick={() => {
                      tile.powerOff.run(undefined);
                      setMoreOpen(false);
                    }}
                  />
                ) : (
                  <MenuRow
                    icon={<Power size={14} aria-hidden="true" />}
                    label={t`Wake computer`}
                    disabled={booting}
                    onClick={() => {
                      tile.wakeComputer();
                      setMoreOpen(false);
                    }}
                  />
                )
              ) : null}

              {running ? (
                <MenuRow
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  label={t`Refresh screen`}
                  onClick={() => {
                    bestEffort(
                      "multiview.refreshScreen",
                      tile.computerControls.refreshDockedComputer(),
                    );
                    setMoreOpen(false);
                  }}
                />
              ) : null}

              {running && !runsOnUserMachine(computer) ? (
                <MenuRow
                  icon={<Camera size={14} aria-hidden="true" />}
                  label={screenshot.pending ? t`Saving screenshot…` : t`Save screenshot`}
                  disabled={screenshot.pending}
                  onClick={() => {
                    screenshot.run(undefined);
                    setMoreOpen(false);
                  }}
                />
              ) : null}

              <MenuRow
                icon={<Maximize2 size={14} aria-hidden="true" />}
                label={t`Open full screen`}
                onClick={() => {
                  setMoreOpen(false);
                  onMaximize(bot.id);
                }}
              />

              <MenuRow
                icon={<ExternalLink size={14} aria-hidden="true" />}
                label={t`Open full chat`}
                onClick={() => {
                  setMoreOpen(false);
                  onOpenFullChat(bot.id);
                }}
              />

              {modelBrandKey(bot.modelProvider, bot.modelId) ? (
                <InlineModelPicker bot={bot} onSwitch={tile.switchModel} />
              ) : null}

              {botVpn && vpn.overview ? (
                <div className="border-t border-border/60 pt-1">
                  <ComputerVpnPopover
                    botId={bot.id}
                    botName={bot.name}
                    vpn={vpn}
                    side="left"
                    align="start"
                    trigger={
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-body-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <span className="flex items-center gap-2">
                          <Globe size={14} className="text-muted-foreground" aria-hidden="true" />
                          <span>{t`VPN`}</span>
                        </span>
                        <ComputerVpnFlagChip botVpn={botVpn} overview={vpn.overview} />
                      </button>
                    }
                  />
                </div>
              ) : null}

              <div className="border-t border-border/60 pt-1">
                {fillChat ? null : (
                  <MenuRow
                    icon={
                      effectiveChatHeight === 0 ? (
                        <ChevronDown size={14} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} className="rotate-180" aria-hidden="true" />
                      )
                    }
                    label={effectiveChatHeight === 0 ? t`Show mini chat` : t`Hide mini chat`}
                    onClick={() => {
                      onChangeChatHeight(
                        effectiveChatHeight === 0 ? MULTIVIEW_DEFAULT_CHAT_HEIGHT : 0,
                      );
                      setMoreOpen(false);
                    }}
                  />
                )}
                {canRemove ? (
                  <MenuRow
                    icon={<Trash2 size={14} aria-hidden="true" />}
                    label={t`Remove from Multiview`}
                    danger
                    onClick={() => {
                      setMoreOpen(false);
                      onRemoveTile();
                    }}
                  />
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* The same elements with a large or a small screen, so switching never reloads its frame.
          A closed screen is removed, so nothing streams to a tile read as text. */}
      {closed ? null : (
        <div className={chats ? "relative z-10 h-0 shrink-0" : "contents"}>
          <div
            data-testid={`multiview-screen-${bot.id}`}
            onWheel={chats || controlling ? undefined : (event) => resizeChat(-wheelPixels(event))}
            className={cn(
              "flex items-center justify-center overflow-hidden",
              chats
                ? "absolute end-2 top-2 aspect-[16/10] w-2/5 max-w-72 min-w-36 rounded-lg border border-border bg-muted shadow-md"
                : "relative min-h-24 flex-1 bg-muted/50",
            )}
          >
            {maximizedHere ? (
              <div className="grid h-full place-items-center px-4 text-center text-body-sm text-muted-foreground">
                <span>{t`Open in full window`}</span>
              </div>
            ) : runsOnUserMachine(computer) ? (
              <DesktopKindEmptyState className="grid h-full place-items-center px-4 text-center text-body-sm text-muted-foreground" />
            ) : showing && embeddedScreenUrl ? (
              <>
                {screenFrames(tile.computerState.screenFrameKey, embeddedScreenUrl, heldScreen).map(
                  (frame) => (
                    <iframe
                      key={frame.key}
                      title={frame.held ? undefined : t`${bot.name} screen`}
                      aria-hidden={frame.held || undefined}
                      tabIndex={controlling && !frame.held ? 0 : -1}
                      ref={frame.held ? undefined : tile.computerState.setScreenFrame}
                      src={frame.url}
                      sandbox={screenIframeSandbox(frame.url)}
                      allow="clipboard-read; clipboard-write"
                      style={{ pointerEvents: controlling && !frame.held ? "auto" : "none" }}
                      className={cn(
                        "h-full w-full border-0 bg-black",
                        frame.held && "absolute inset-0",
                      )}
                    />
                  ),
                )}
                {chats && !controlling ? (
                  <button
                    type="button"
                    aria-label={`Full screen ${bot.name}`}
                    title="Full screen"
                    onClick={() => onMaximize(bot.id)}
                    className="absolute inset-0 rounded-lg outline-none hover:ring-2 hover:ring-foreground/25 hover:ring-inset focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  />
                ) : !controlling ? (
                  confirmTakeover ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-2">
                      <div className="flex max-w-64 flex-col items-center gap-2.5 rounded-xl bg-black/85 px-4 py-3 text-center text-body-sm text-white ring-1 ring-white/15 backdrop-blur-sm">
                        <span>{t`${bot.name} is using the computer.`}</span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            onClick={() => setConfirmTakeover(false)}
                          >
                            {t`Cancel`}
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="xs"
                            disabled={taking}
                            onClick={() => void takeControl()}
                          >
                            {t`Take control`}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={t`Double-click to take control of ${bot.name}`}
                      onDoubleClick={requestControl}
                      className="group absolute inset-0 flex items-end justify-end p-2 focus:outline-none"
                    >
                      <span className="pointer-events-none rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/75 opacity-0 ring-1 ring-white/15 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        {t`Double-click to control`}
                      </span>
                    </button>
                  )
                ) : null}
              </>
            ) : asleep && chats ? (
              <div className="flex flex-col items-center gap-1 px-2 text-center">
                <span className="text-caption text-muted-foreground">{t`Asleep`}</span>
                <Button type="button" variant="secondary" size="xs" onClick={tile.wakeComputer}>
                  {t`Wake`}
                </Button>
              </div>
            ) : asleep ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-3 text-center">
                <span aria-hidden="true" className="relative">
                  <BotAvatar
                    avatarSet={bot.avatarSet}
                    color={bot.color}
                    identity={bot.id}
                    size={32}
                    className="opacity-50 grayscale"
                  />
                  <span className="absolute -end-3 -top-1 text-caption font-medium leading-none text-muted-foreground/70">
                    z<sup>z</sup>
                  </span>
                </span>
                <span className="text-body-sm text-muted-foreground">{t`Asleep`}</span>
                <Button type="button" variant="secondary" size="xs" onClick={tile.wakeComputer}>
                  {t`Wake`}
                </Button>
              </div>
            ) : (
              <div
                className={cn(
                  "grid h-full place-items-center text-center text-muted-foreground",
                  chats ? "overflow-auto px-2 text-caption" : "px-4 text-body-sm",
                )}
              >
                {tile.computerControls.computerScreenError ??
                  tile.computerControls.computerBooting ?? (
                    <div className="flex flex-col items-center gap-2">
                      {booting || computer?.state === "booting" ? (
                        <Spinner aria-label={t`Connecting…`} />
                      ) : null}
                      <span>{computerPreviewPlaceholder(computer?.state, booting)}</span>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {tile.powerOff.error ? (
        <div role="alert" className="bg-destructive/10 px-2.5 py-1 text-caption text-destructive">
          {tile.powerOff.error.message}
        </div>
      ) : screenshot.error ? (
        <div role="alert" className="bg-destructive/10 px-2.5 py-1 text-caption text-destructive">
          {t`Could not save screenshot`}
        </div>
      ) : null}

      <MultiviewMiniChat
        bot={bot}
        rpc={rpc}
        meId={meId}
        showToolActivity={showToolActivity}
        view={tile.view}
        running={tile.running}
        loadingOlder={tile.loadingOlder}
        followRequest={tile.followRequest}
        scrollRef={tile.thread.messageScroll}
        fill={fillChat}
        chatHeight={effectiveChatHeight}
        drawerRef={drawerRef}
        onChangeChatHeight={onChangeChatHeight}
        onResizeChat={resizeChat}
        sending={tile.send.pending}
        sendError={tile.send.error?.message ?? null}
        stopping={tile.stop.pending}
        onSend={(text, onSent) => tile.send.run({ text, onSent })}
        onStop={() => tile.stop.run(undefined)}
        onLoadOlder={tile.loadOlder}
        onAnswer={tile.answerMessage}
        onReact={tile.reactToMessage}
        onRefresh={tile.refreshThread}
        onBotChanged={() => refreshBots()}
        onOpenBot={onOpenBot}
        onOpenFullChat={() => onOpenFullChat(bot.id)}
        onOpenComputer={tile.computerControls.onOpenComputer}
        onReleaseComputer={tile.computerControls.onReleaseComputer}
      />
    </section>
  );
}

function MenuRow({
  icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-body-sm transition-colors disabled:opacity-45",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted",
      )}
    >
      <span className={cn("shrink-0", !danger && "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function InlineModelPicker({
  bot,
  onSwitch,
}: {
  bot: Bot;
  onSwitch: (choice: { provider: string; modelId: string }) => Promise<unknown>;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data;
  const catalog = useQuery(queries.models.list.queryOptions()).data;
  const choices = useMemo(
    () => connectedModelChoices(credentials ?? [], catalog ?? []),
    [credentials, catalog],
  );
  const currentKey =
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "";
  const activeChoice = choices.find((choice) => choice.key === currentKey);
  const label = activeChoice
    ? shortModelLabel(activeChoice.modelId)
    : bot.modelId
      ? shortModelLabel(bot.modelId)
      : t`Model`;

  return (
    <div className="border-t border-border/60 pt-1">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-body-sm text-foreground transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ModelBrandIcon
            modelProvider={bot.modelProvider}
            modelId={bot.modelId}
            className="size-3.5 shrink-0"
          />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          size={13}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto ps-2">
          {choices.map((choice) => {
            const selected = choice.key === currentKey;
            return (
              <button
                key={choice.key}
                type="button"
                disabled={Boolean(pendingKey)}
                onClick={async () => {
                  if (selected) return;
                  setPendingKey(choice.key);
                  try {
                    await onSwitch({ provider: choice.provider, modelId: choice.modelId });
                    setExpanded(false);
                  } finally {
                    setPendingKey(null);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-start text-caption transition-colors",
                  selected ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60",
                )}
              >
                <ModelBrandIcon
                  modelProvider={choice.provider}
                  modelId={choice.modelId}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{shortModelLabel(choice.modelId)}</span>
                {selected ? <Check size={12} className="shrink-0 text-emerald-400" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
