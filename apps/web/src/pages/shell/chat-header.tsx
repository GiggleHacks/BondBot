import { useLingui } from "@lingui/react/macro";
import type { Bot, Group, ThreadSnapshot } from "@rakazo/contracts";
import { BotAvatar, Button, GroupAvatar } from "@rakazo/ui-web";
import { Gift, Menu, Monitor, Phone } from "lucide-react";
import { useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { InviteDialog } from "../../components/InviteDialog";
import { useBilling } from "../../components/SubscriptionGate";
import { desktopBridge, windowChromeKind } from "../../lib/desktop";
import { WindowChrome } from "../WindowChrome";
import { ModelBrandIcon, modelBrandKey } from "../../components/ModelBrandIcon";
import { ConnectionBars } from "../../components/ConnectionBars";
import { ModelSwitcher } from "../../components/ModelSwitcher";
import { ComputerVpnFlagChip, ComputerVpnPopover } from "./computer-vpn-control";
import type { ComputerVpnController } from "./use-computer-vpn";

/** The floating header over the transcript: navigation, the chat's name, call and invite. */
export function ChatHeader({
  inGroup,
  active,
  activeGroup,
  activeSnapshot,
  phoneCallsEnabled,
  voiceReady,
  inCall,
  panelOpen,
  onOpenNavigation,
  onTogglePanel,
  onCall,
  vpn,
  screenDocked = false,
  onToggleScreenDock,
  onSwitchModel,
}: {
  inGroup: boolean;
  active: Bot | undefined;
  activeGroup: Group | undefined;
  activeSnapshot: ThreadSnapshot | null;
  phoneCallsEnabled: boolean;
  /** False while the voice status loads or no voice is connected; the button then opens voice settings. */
  voiceReady: boolean;
  inCall: boolean;
  panelOpen: boolean;
  onOpenNavigation: () => void;
  onTogglePanel: () => void;
  onCall: (bot: Bot) => void;
  vpn?: ComputerVpnController;
  /** The phone's docked screen is showing. */
  screenDocked?: boolean;
  /** Shows or hides the docked screen; left out where there is nothing to dock. */
  onToggleScreenDock?: () => void;
  /** Saves a model switch for the chat's bot; resolves only once it is saved. */
  onSwitchModel?: (choice: {
    provider: string;
    modelId: string;
  }) => Promise<{ provider: string; modelId: string } | undefined>;
}) {
  const { t } = useLingui();
  const referral = useBilling().status?.referral;
  const [inviteOpen, setInviteOpen] = useState(false);
  const macChrome = windowChromeKind(desktopBridge()) === "darwin";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-3 py-[13px] md:px-[22px] [&_button]:pointer-events-auto">
      <div className="flex items-center">
        {macChrome ? <WindowChrome className="md:hidden" /> : null}
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Open navigation`}
          onClick={onOpenNavigation}
          className="app-no-drag md:hidden"
        >
          <Menu strokeWidth={1.7} className="size-[19px]" />
        </Button>
      </div>
      <div className="flex min-w-0 items-center justify-self-center gap-1.5">
        {!inGroup && active && vpn?.overview?.supported && vpn.overview.bots[active.id] ? (
          <ComputerVpnPopover
            botId={active.id}
            botName={active.name}
            vpn={vpn}
            side="bottom"
            align="center"
            trigger={
              <Button
                variant="floating"
                size="sm"
                aria-label={`VPN settings for ${active.name}`}
                className="app-no-drag h-[34px] rounded-full px-1.5"
              >
                <ComputerVpnFlagChip
                  botVpn={vpn.overview.bots[active.id]}
                  overview={vpn.overview}
                  iconsOnly
                />
              </Button>
            }
          />
        ) : null}
        {!inGroup && active && modelBrandKey(active.modelProvider, active.modelId) ? (
          onSwitchModel ? (
            <ModelSwitcher bot={active} onSwitch={onSwitchModel} />
          ) : (
            <Button
              variant="floating"
              size="icon-sm"
              data-testid="header-model-chip"
              aria-label={`Model: ${active.modelId ?? ""}`}
              onClick={onTogglePanel}
              className="app-no-drag size-[34px] shrink-0 rounded-full p-0"
            >
              <ModelBrandIcon
                modelProvider={active.modelProvider}
                modelId={active.modelId}
                className="size-[18px]"
              />
            </Button>
          )
        ) : null}
        <Button
          variant="floating"
          data-testid="bot-settings-trigger"
          aria-expanded={panelOpen}
          onClick={onTogglePanel}
          className="app-no-drag h-auto min-w-0 gap-2 py-1 ps-1 pe-3.5"
        >
          {inGroup ? (
            <GroupAvatar members={activeSnapshot?.members ?? activeGroup?.members ?? []} size={26} />
          ) : active ? (
            <BotAvatar
              avatarSet={active.avatarSet}
              color={active.color}
              identity={active.id}
              size={26}
              status={active.status}
            />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-body-lg font-medium text-foreground" dir="auto">
              {inGroup
                ? (activeGroup?.name ?? activeSnapshot?.groupName ?? t`Group`)
                : (active?.name ?? t`Select a bot`)}
            </span>
          </span>
        </Button>
      </div>
      <div className="flex items-center justify-self-end gap-2">
        <ConnectionBars />
        {onToggleScreenDock && !inGroup && active ? (
          <Button
            variant="floating"
            size="icon-lg"
            data-testid="screen-dock-toggle"
            aria-label={screenDocked ? "Hide screen" : "Show screen"}
            aria-pressed={screenDocked}
            onClick={onToggleScreenDock}
            className={`app-no-drag md:hidden ${screenDocked ? "text-emerald-300 ring-1 ring-emerald-400/60" : ""}`}
          >
            <Monitor strokeWidth={1.7} className="size-[18px]" />
          </Button>
        ) : null}
        {phoneCallsEnabled && !inGroup && active ? (
          <IconTooltip label={inCall ? t`Open call` : t`Call`}>
            <Button
              variant="floating"
              size="icon-lg"
              data-testid="call-button"
              aria-label={inCall ? t`Open call` : t`Call`}
              onClick={() => onCall(active)}
              data-active={inCall ? "" : undefined}
              data-voice-ready={voiceReady ? "" : undefined}
              className="app-no-drag"
            >
              <Phone strokeWidth={1.6} className="size-[17px]" />
            </Button>
          </IconTooltip>
        ) : null}
        {referral && !inGroup && active ? (
          <IconTooltip label={t`Invite a friend`}>
            <Button
              variant="floating"
              size="icon-lg"
              aria-label={t`Invite a friend`}
              onClick={() => setInviteOpen(true)}
              className="app-no-drag"
            >
              <Gift strokeWidth={1.6} className="size-[17px]" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>
      {referral ? (
        <InviteDialog referral={referral} open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}
    </div>
  );
}
