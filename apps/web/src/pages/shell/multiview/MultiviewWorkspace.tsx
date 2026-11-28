import { useLingui } from "@lingui/react/macro";
import type { Bot, Me } from "@rakazo/contracts";
import { Button, cn } from "@rakazo/ui-web";
import {
  Columns3,
  LayoutGrid,
  Menu,
  PanelLeft,
  PanelTop,
  PictureInPicture2,
  Plus,
  X,
} from "lucide-react";
import type { TouchEvent as ReactTouchEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionBars } from "../../../components/ConnectionBars";
import { WindowChrome } from "../../../components/WindowChrome";
import { desktopBridge, windowChromeKind } from "../../../lib/platform/desktop";
import type { SpaceQueries } from "../../../lib/query/query";
import type { createSpaceRpc } from "../../../lib/query/rpc";
import type { ComputerVpnController } from "../use-computer-vpn";
import { MultiviewTile } from "./MultiviewTile";
import type { MultiviewCount, MultiviewSpaceConfig } from "./multiview-state";
import {
  MULTIVIEW_MAX_TILES,
  mobileMultiviewPageCount,
  readMultiviewConfig,
  removeMultiviewTile,
  resizeMultiviewTiles,
  resolveMultiviewTileIds,
  swapMultiviewTile,
  visibleMobileTileIds,
  writeMultiviewConfig,
} from "./multiview-state";
import "./multiview.css";

/**
 * Workspace mode showing 2-4 bot computers simultaneously on desktop (and max 2 at once on mobile)
 * with live screens, per-tile controls, and compact mini chats underneath.
 */
export function MultiviewWorkspace({
  spaceId,
  isMobile,
  drawerOpen,
  covered,
  bots,
  botsRef,
  archivedBots,
  activeBotId,
  rpc,
  queries,
  meId,
  streamReplies,
  showToolActivity,
  sandboxProvider,
  vpn,
  maximizedBotId,
  onOpenNavigation,
  onMaximize,
  onOpenFullChat,
  onOpenBot,
  onCreateBot,
  onExit,
  refreshBots,
  onBotUpdated,
  onUpgrade,
  onSendError,
}: {
  spaceId: string;
  isMobile: boolean;
  drawerOpen: boolean;
  covered: boolean;
  bots: Bot[];
  botsRef: RefObject<Bot[]>;
  archivedBots: Bot[];
  activeBotId: string | undefined;
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  meId: string | undefined;
  streamReplies: boolean;
  showToolActivity: boolean;
  sandboxProvider: Me["sandboxProvider"] | undefined;
  vpn: ComputerVpnController;
  maximizedBotId: string | null;
  onOpenNavigation: () => void;
  onMaximize: (botId: string) => void;
  onOpenFullChat: (botId: string) => void;
  onOpenBot: (botId: string) => void;
  onCreateBot: () => void;
  onExit: () => void;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  onBotUpdated: (updated: Bot) => void;
  onUpgrade: () => void;
  onSendError: (message: string) => void;
}) {
  const { t } = useLingui();
  const [config, setConfig] = useState<MultiviewSpaceConfig>(() => readMultiviewConfig(spaceId));
  const [mobilePage, setMobilePage] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setConfig(readMultiviewConfig(spaceId));
    setMobilePage(0);
  }, [spaceId]);

  const tileIds = useMemo(
    () => resolveMultiviewTileIds(config.tileBotIds, bots, activeBotId),
    [config.tileBotIds, bots, activeBotId],
  );

  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const liveBotCount = useMemo(() => bots.filter((bot) => !bot.archivedAt).length, [bots]);

  function updateConfig(updater: (prev: MultiviewSpaceConfig) => MultiviewSpaceConfig) {
    setConfig((prev) => {
      const next = updater(prev);
      writeMultiviewConfig(spaceId, next);
      return next;
    });
  }

  const mobilePages = mobileMultiviewPageCount(tileIds.length);
  const clampedMobilePage = mobilePage >= mobilePages ? 0 : mobilePage;
  const visibleIds = isMobile ? visibleMobileTileIds(tileIds, clampedMobilePage) : tileIds;
  const visibleBots = visibleIds
    .map((id) => botsById.get(id))
    .filter((bot): bot is Bot => Boolean(bot));

  const macChrome = windowChromeKind(desktopBridge()) === "darwin";

  function onTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (!isMobile || mobilePages <= 1) return;
    const touch = event.touches[0];
    if (touch) swipeStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !isMobile || mobilePages <= 1) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    setMobilePage((page) => (dx < 0 ? Math.min(mobilePages - 1, page + 1) : Math.max(0, page - 1)));
  }

  const chats = config.layout === "chats";
  const desktopGridClass = chats
    ? visibleBots.length >= 4
      ? "md:grid-cols-2 md:grid-rows-2 xl:grid-cols-4 xl:grid-rows-1"
      : visibleBots.length === 3
        ? "md:grid-cols-3"
        : visibleBots.length === 2
          ? "md:grid-cols-2"
          : "md:grid-cols-1"
    : visibleBots.length <= 1
      ? "md:grid-cols-1"
      : visibleBots.length === 2
        ? "md:grid-cols-2"
        : visibleBots.length === 3
          ? config.threeLayout === "featured"
            ? "md:grid-cols-2 md:grid-rows-2"
            : "md:grid-cols-3"
          : "md:grid-cols-2 md:grid-rows-2";

  return (
    <main
      data-testid="multiview-workspace"
      aria-hidden={drawerOpen || undefined}
      inert={drawerOpen || covered}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <header className="app-drag flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {macChrome ? <WindowChrome className="md:hidden" /> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t`Open navigation`}
            onClick={onOpenNavigation}
            className="app-no-drag md:hidden"
          >
            <Menu size={17} strokeWidth={1.8} />
          </Button>
          <span className="inline-flex items-center gap-1.5 text-body font-semibold text-foreground">
            <LayoutGrid size={16} strokeWidth={1.9} aria-hidden="true" />
            <span>{t`Multiview`}</span>
          </span>
        </div>

        <div className="app-no-drag flex items-center gap-1.5">
          {!isMobile && liveBotCount >= 2 ? (
            <fieldset
              aria-label={t`Computers shown`}
              className="m-0 inline-flex items-center gap-0.5 rounded-full border-0 bg-muted/70 p-0.5"
            >
              {([2, 3, 4] as const satisfies readonly MultiviewCount[]).map((count) => {
                if (liveBotCount < count) return null;
                const activeCount = tileIds.length === count;
                return (
                  <Button
                    key={count}
                    type="button"
                    variant={activeCount ? "secondary" : "ghost"}
                    size="xs"
                    aria-pressed={activeCount}
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        tileBotIds: resizeMultiviewTiles(tileIds, count, bots, activeBotId),
                      }))
                    }
                    className="rounded-full"
                  >
                    {count}
                  </Button>
                );
              })}
              {tileIds.length === 3 && !chats ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    config.threeLayout === "columns"
                      ? t`Switch to 1 featured + 2 layout`
                      : t`Switch to 3 columns`
                  }
                  onClick={() =>
                    updateConfig((prev) => ({
                      ...prev,
                      threeLayout: prev.threeLayout === "columns" ? "featured" : "columns",
                    }))
                  }
                  className="rounded-full text-muted-foreground"
                >
                  {config.threeLayout === "columns" ? (
                    <PanelLeft size={13} aria-hidden="true" />
                  ) : (
                    <Columns3 size={13} aria-hidden="true" />
                  )}
                </Button>
              ) : null}
            </fieldset>
          ) : null}

          {isMobile && mobilePages > 1 ? (
            <fieldset
              aria-label={t`Screen page`}
              className="m-0 inline-flex items-center gap-0.5 rounded-full border-0 bg-muted/70 p-0.5"
            >
              <Button
                type="button"
                variant={clampedMobilePage === 0 ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={clampedMobilePage === 0}
                onClick={() => setMobilePage(0)}
                className="rounded-full"
              >
                {t`1, 2`}
              </Button>
              <Button
                type="button"
                variant={clampedMobilePage === 1 ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={clampedMobilePage === 1}
                onClick={() => setMobilePage(1)}
                className="rounded-full"
              >
                {tileIds.length === 3 ? t`3` : t`3, 4`}
              </Button>
            </fieldset>
          ) : null}
        </div>

        <div className="app-no-drag flex items-center gap-1.5">
          <fieldset
            aria-label="Layout"
            className="m-0 inline-flex items-center gap-0.5 rounded-full border-0 bg-muted/70 p-0.5"
          >
            {(
              [
                ["screens", "Large screens", PanelTop],
                ["chats", "Large chats", PictureInPicture2],
              ] as const
            ).map(([layout, label, Icon]) => (
              <Button
                key={layout}
                type="button"
                variant={config.layout === layout ? "secondary" : "ghost"}
                size="icon-xs"
                aria-label={label}
                title={label}
                aria-pressed={config.layout === layout}
                onClick={() => updateConfig((prev) => ({ ...prev, layout }))}
                className="rounded-full"
              >
                <Icon size={13} aria-hidden="true" />
              </Button>
            ))}
          </fieldset>
          <ConnectionBars />
          {!isMobile && tileIds.length < MULTIVIEW_MAX_TILES && liveBotCount > tileIds.length ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t`Add computer tile`}
              onClick={() =>
                updateConfig((prev) => ({
                  ...prev,
                  tileBotIds: resizeMultiviewTiles(
                    tileIds,
                    Math.min(MULTIVIEW_MAX_TILES, tileIds.length + 1) as MultiviewCount,
                    bots,
                    activeBotId,
                  ),
                }))
              }
            >
              <Plus size={16} strokeWidth={1.9} aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="exit-multiview"
            aria-label={t`Exit Multiview`}
            onClick={onExit}
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <X size={15} strokeWidth={1.9} aria-hidden="true" />
            <span className="hidden sm:inline">{t`Exit`}</span>
          </Button>
        </div>
      </header>

      {visibleBots.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <p className="text-body text-muted-foreground">{t`Create a bot to open its computer here.`}</p>
            <Button type="button" onClick={onCreateBot}>
              <Plus size={16} aria-hidden="true" />
              <span>{t`New bot`}</span>
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden p-2.5 md:gap-3 md:p-3",
            visibleBots.length === 2 && isMobile && "grid-rows-2",
            desktopGridClass,
          )}
        >
          {visibleBots.map((bot, visibleIndex) => {
            const slotIndex = isMobile ? clampedMobilePage * 2 + visibleIndex : visibleIndex;
            const featured =
              !isMobile &&
              visibleBots.length === 3 &&
              config.threeLayout === "featured" &&
              visibleIndex === 0;
            return (
              <div
                key={bot.id}
                className={cn("flex min-h-0 min-w-0 flex-col", featured && "md:row-span-2")}
              >
                <MultiviewTile
                  bot={bot}
                  bots={bots}
                  botsRef={botsRef}
                  archivedBots={archivedBots}
                  rpc={rpc}
                  queries={queries}
                  meId={meId}
                  streamReplies={streamReplies}
                  showToolActivity={showToolActivity}
                  sandboxProvider={sandboxProvider}
                  vpn={vpn}
                  maximizedHere={maximizedBotId === bot.id}
                  isMobile={isMobile}
                  layout={config.layout}
                  chatHeight={config.chatHeights[bot.id]}
                  canRemove={tileIds.length > 2}
                  onChangeChatHeight={(height) =>
                    updateConfig((prev) => ({
                      ...prev,
                      chatHeights: { ...prev.chatHeights, [bot.id]: height },
                    }))
                  }
                  onSwapBot={(nextBotId) =>
                    updateConfig((prev) => ({
                      ...prev,
                      tileBotIds: swapMultiviewTile(tileIds, slotIndex, nextBotId),
                    }))
                  }
                  onRemoveTile={() =>
                    updateConfig((prev) => ({
                      ...prev,
                      tileBotIds: removeMultiviewTile(tileIds, bot.id),
                    }))
                  }
                  onMaximize={onMaximize}
                  onOpenFullChat={onOpenFullChat}
                  onOpenBot={onOpenBot}
                  refreshBots={refreshBots}
                  onBotUpdated={onBotUpdated}
                  onUpgrade={onUpgrade}
                  onSendError={onSendError}
                />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
