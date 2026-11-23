import { useLingui } from "@lingui/react/macro";
import type { Bot, BotSection } from "@rakazo/contracts";
import type { SnoozePreset } from "@rakazo/core";
import { SNOOZE_PRESETS, snoozePresetTime } from "@rakazo/core";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@rakazo/ui-web";
import {
  Archive,
  Bell,
  BellDot,
  Check,
  Clock,
  Copy,
  Eraser,
  Folder,
  FolderPlus,
  Globe,
  Lock,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { CountryFlag } from "../components/CountryFlag";

type ChatMenuTarget = Pick<Bot, "name" | "pinned" | "sectionId" | "unread">;

const PRESET_DAYS: ReadonlySet<SnoozePreset> = new Set(["tomorrow", "nextWeek"]);

/** A roster row's context menu content; `onClose` serves the lazy-load error fallback. */
export function BotContextMenu({
  bot,
  onTogglePinned,
  sections,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  snoozed,
  onSnooze,
  onEdit,
  onDuplicate,
  onClear,
  onArchive,
  onDelete,
  vpnMenu,
}: {
  bot: ChatMenuTarget;
  onClose: () => void;
  onTogglePinned: () => void;
  sections: BotSection[];
  onMoveToSection: (sectionId: string | null) => void;
  onCreateSection: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread: () => void;
  /** Snoozed until a time still ahead. */
  snoozed: boolean;
  /** An ISO wake time, or null to unsnooze. */
  onSnooze: (until: string | null) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
  vpnMenu?: {
    currentCode: string;
    currentProfile: string | null;
    locked: boolean;
    hostCountry: string | null;
    profiles: Array<{ id: string; countryCode: string; countryName: string; serverLabel: string; up: boolean }>;
    onSelectProfile: (profile: string | null, label: string) => void;
    onToggleLock: (locked: boolean) => void;
  };
}) {
  const { t, i18n } = useLingui();
  const presetLabels: Record<SnoozePreset, string> = {
    hour: t`1 hour`,
    threeHours: t`3 hours`,
    tomorrow: t`Tomorrow`,
    nextWeek: t`Next week`,
  };
  const now = new Date();

  return (
    <ContextMenuContent
      aria-label={t`Actions for ${bot.name}`}
      className="max-h-[min(420px,calc(100vh-16px))] w-[264px] overflow-y-auto"
    >
      <ContextMenuItem onClick={onTogglePinned}>
        <Pin />
        {bot.pinned ? t`Unpin` : t`Pin`}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Folder />
          {t`Move to`}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-[min(420px,calc(100vh-16px))] min-w-[180px] overflow-y-auto">
          {sections.map((section) => (
            <ContextMenuItem key={section.id} onClick={() => onMoveToSection(section.id)}>
              <Folder />
              <span dir="auto">{section.name}</span>
              {bot.sectionId === section.id ? <Check className="ms-auto" /> : null}
            </ContextMenuItem>
          ))}
          <ContextMenuItem onClick={() => onMoveToSection(null)}>
            <Folder />
            {t`Unassigned`}
            {bot.sectionId === null ? <Check className="ms-auto" /> : null}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCreateSection}>
            <FolderPlus />
            {t`New section`}
          </ContextMenuItem>
          {bot.sectionId && onRenameSection ? (
            <ContextMenuItem onClick={() => onRenameSection(bot.sectionId!)}>
              <Pencil />
              {t`Rename section`}
            </ContextMenuItem>
          ) : null}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onClick={onToggleUnread}>
        {bot.unread ? <BellDot /> : <Bell />}
        {bot.unread ? t`Mark as Read` : t`Mark as Unread`}
      </ContextMenuItem>
      {snoozed ? (
        <ContextMenuItem onClick={() => onSnooze(null)}>
          <Clock />
          {t`Unsnooze`}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Clock />
            {t`Snooze`}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[200px]">
            {SNOOZE_PRESETS.map((preset) => {
              const wake = snoozePresetTime(preset, now);
              return (
                <ContextMenuItem
                  key={preset}
                  // From the click, so a menu left open still snoozes from now.
                  onClick={() => onSnooze(snoozePresetTime(preset, new Date()).toISOString())}
                >
                  {presetLabels[preset]}
                  {PRESET_DAYS.has(preset) ? (
                    <span className="ms-auto text-label text-muted-foreground">
                      {i18n.date(wake, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    </span>
                  ) : null}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      {vpnMenu ? (
        <>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Globe />
              <span>VPN</span>
              <span className="ms-auto flex items-center gap-1">
                <CountryFlag code={vpnMenu.currentCode} className="h-2.5 w-3.5 rounded-[2px] ring-1 ring-white/15" />
                {vpnMenu.locked ? <Lock className="size-3 text-emerald-400" /> : null}
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[220px]">
              <ContextMenuItem
                disabled={vpnMenu.locked}
                onClick={() => vpnMenu.onSelectProfile(null, "Direct")}
              >
                <CountryFlag code={vpnMenu.hostCountry ?? "TH"} className="h-2.5 w-3.5 rounded-[2px] ring-1 ring-white/15" />
                <span>Direct (Thailand)</span>
                {vpnMenu.currentProfile === null ? <Check className="ms-auto" /> : null}
              </ContextMenuItem>
              {vpnMenu.profiles.map((prof) => (
                <ContextMenuItem
                  key={prof.id}
                  onClick={() =>
                    vpnMenu.onSelectProfile(prof.id, `${prof.countryName} (${prof.serverLabel})`)
                  }
                >
                  <CountryFlag code={prof.countryCode} className="h-2.5 w-3.5 rounded-[2px] ring-1 ring-white/15" />
                  <span>{prof.countryName}</span>
                  <span className="text-label text-muted-foreground">{prof.serverLabel}</span>
                  {vpnMenu.currentProfile === prof.id ? <Check className="ms-auto" /> : null}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={!vpnMenu.currentProfile}
                onClick={() => vpnMenu.onToggleLock(!vpnMenu.locked)}
              >
                <Lock />
                <span>
                  {vpnMenu.locked ? "Unlock Kill Switch" : "Lock to VPN (Kill Switch)"}
                </span>
                {vpnMenu.locked ? <Check className="ms-auto" /> : null}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onClick={onEdit}>
        <Pencil />
        {t`Edit Profile`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onDuplicate}>
        <Copy />
        {t`Duplicate`}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onClear}>
        <Eraser />
        {t`Clear conversation`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchive}>
        <Archive />
        {t`Archive`}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        {t`Delete`}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
