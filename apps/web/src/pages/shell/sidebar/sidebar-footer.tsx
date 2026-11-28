import { Trans, useLingui } from "@lingui/react/macro";
import type { NavLink } from "@rakazo/contracts";
import { Button, buttonVariants, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import {
  BookOpen,
  Building2,
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  Gauge,
  Link2,
  LogOut,
  MonitorDown,
  Plus,
  ScrollText,
  Settings,
  SquareKanban,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useSidebarUpdate } from "../../../components/DesktopUpdates";
import { IconTooltip } from "../../../components/IconTooltip";
import { desktopBridge } from "../../../lib/platform/desktop";
import { useDesktopBuilds } from "../../../lib/platform/desktop-download";
import type { Organization } from "../../../lib/spaces/organizations";

type Props = {
  mini?: boolean;
  name: string;
  initials: string | null;
  image?: string | null;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkills: () => void;
  onBoard?: () => void;
  links?: NavLink[];
  onLink?: (link: NavLink) => void;
  onArtifacts: () => void;
  onSharedPages?: () => void;
  onSettings: () => void;
  /** How much of the member's allowance is used; the Usage row shows only with one. */
  usage?: string | null;
  onUsage?: () => void;
  onInvite?: () => void;
  onLogOut: () => void;
  signingOut: boolean;
  logOutError: string | null;
  organizations?: Organization[];
  activeOrganizationId?: string | null;
  onSwitchOrganization?: (organization: Organization) => void;
  onCreateOrganization?: () => void;
};

function DesktopDownloadLinks() {
  return useDesktopBuilds().map(({ platform, href, fileName }) => (
    <a
      key={platform}
      className={`${buttonVariants({ variant: "ghost", size: "lg" })} w-full justify-start gap-2.5 font-normal`}
      href={href}
      download={fileName}
      data-testid={`download-${platform}-app-link`}
    >
      <MonitorDown className="text-muted-foreground" strokeWidth={1.75} />
      <span>{platform === "mac" ? "Download macOS app" : "Download Windows app"}</span>
    </a>
  ));
}

export function SidebarFooter({
  mini = false,
  name,
  initials,
  image,
  email,
  open,
  onOpenChange,
  onSkills,
  onBoard,
  links = [],
  onLink,
  onArtifacts,
  onSharedPages,
  onSettings,
  usage,
  onUsage,
  onInvite,
  onLogOut,
  signingOut,
  logOutError,
  organizations = [],
  activeOrganizationId,
  onSwitchOrganization,
  onCreateOrganization,
}: Props) {
  const { t } = useLingui();
  const update = useSidebarUpdate();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return (
    <div
      data-testid="sidebar-footer"
      className={`flex shrink-0 items-center bg-transparent ${mini ? "flex-col gap-2 px-1 py-2" : "gap-3 ps-5 pe-2.5 py-3"}`}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          data-testid="user-menu-trigger"
          aria-label={t`Account menu for ${name}`}
          className="grid size-9.5 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-body font-semibold text-secondary-foreground outline-none hover:ring-2 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {image && failedImage !== image ? (
            <img
              src={image}
              alt=""
              className="size-full object-cover"
              onError={() => setFailedImage(image)}
            />
          ) : initials ? (
            initials
          ) : (
            <UserRound size={18} aria-hidden="true" />
          )}
        </PopoverTrigger>
        {open ? (
          <PopoverContent
            side="top"
            sideOffset={8}
            align="start"
            className="max-h-(--available-height) w-[295px] max-w-[calc(100vw-69px)] gap-0 overflow-y-auto p-1 *:shrink-0 data-closed:animate-none"
          >
            <button
              type="button"
              data-testid="account-menu-header"
              aria-label={`Edit profile for ${name}`}
              onClick={onSettings}
              className="mb-1 flex w-full min-w-0 items-center gap-2.5 rounded-md border-b border-border px-2.5 py-2.5 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-body font-semibold text-secondary-foreground">
                {image && failedImage !== image ? (
                  <img src={image} alt="" className="size-full object-cover" />
                ) : initials ? (
                  initials
                ) : (
                  <UserRound size={16} aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body font-medium">{name}</span>
                {email && email !== name ? (
                  <span className="block truncate text-label text-muted-foreground">{email}</span>
                ) : null}
              </span>
            </button>
            <OrganizationRow
              organizations={organizations}
              activeOrganizationId={activeOrganizationId}
              onSwitch={onSwitchOrganization}
              onCreate={onCreateOrganization}
            />
            {usage ? (
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal"
                onClick={onUsage}
              >
                <Gauge className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Usage</Trans>
                <span className="ms-auto text-body-sm tabular-nums text-muted-foreground">
                  {usage}
                </span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 font-normal"
              aria-label={t`Settings`}
              onClick={onSettings}
            >
              <Settings className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Settings</Trans>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 font-normal"
              onClick={onSkills}
            >
              <ScrollText className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Skills</Trans>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 font-normal"
              onClick={onArtifacts}
            >
              <FolderOpen className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Artifacts</Trans>
            </Button>
            {onSharedPages ? (
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal"
                onClick={onSharedPages}
              >
                <BookOpen className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Pages shared with you</Trans>
              </Button>
            ) : null}
            {/* From md up the rail opens the Board, so only the phone drawer lists it here. */}
            {onBoard ? (
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal md:hidden"
                onClick={onBoard}
              >
                <SquareKanban className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Board</Trans>
              </Button>
            ) : null}
            {links.map((link) => (
              <Button
                key={link.id}
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal"
                onClick={() => onLink?.(link)}
              >
                <Link2 className="text-muted-foreground" strokeWidth={1.75} />
                {link.label}
              </Button>
            ))}
            <div className="my-1 border-t border-border" />
            {!desktopBridge() ? <DesktopDownloadLinks /> : null}
            {onInvite ? (
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal"
                onClick={onInvite}
              >
                <UserPlus className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Invite friends</Trans>
              </Button>
            ) : null}
            <a
              className={`${buttonVariants({ variant: "ghost", size: "lg" })} w-full justify-start gap-2.5 font-normal`}
              href="https://github.com/elie222/rakazo/blob/main/docs/self-host.md"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Docs</Trans>
            </a>
            <div className="my-1 border-t border-border" />
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 font-normal"
              disabled={signingOut}
              onClick={onLogOut}
            >
              <LogOut className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Log out</Trans>
            </Button>
            {logOutError ? (
              <p role="alert" className="px-2.5 pt-1 pb-2 text-body-sm text-destructive">
                {logOutError}
              </p>
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
      {update.available ? (
        <IconTooltip label={t`Install update`}>
          <Button
            size="icon-lg"
            className={mini ? "rounded-full" : "ms-auto rounded-full"}
            aria-label={t`Install update`}
            disabled={update.busy}
            onClick={update.install}
          >
            <Download aria-hidden="true" />
          </Button>
        </IconTooltip>
      ) : null}
    </div>
  );
}

/** The organization in use; its submenu switches to another or starts a new one. */
function OrganizationRow({
  organizations,
  activeOrganizationId,
  onSwitch,
  onCreate,
}: {
  organizations: Organization[];
  activeOrganizationId?: string | null;
  onSwitch?: (organization: Organization) => void;
  onCreate?: () => void;
}) {
  const active = organizations.find((organization) => organization.id === activeOrganizationId);
  if (!active) return null;
  return (
    <>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          data-testid="organization-menu-trigger"
          render={
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 font-normal"
            />
          }
        >
          <Building2 className="text-muted-foreground" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{active.name}</span>
          <ChevronRight className="ms-auto text-muted-foreground" strokeWidth={1.75} />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={4}
          className="max-h-(--available-height) w-60 gap-0 overflow-y-auto p-1 *:shrink-0"
        >
          {organizations.map((organization) => {
            const current = organization.id === active.id;
            return (
              <Button
                key={organization.id}
                variant="ghost"
                aria-current={current ? "true" : undefined}
                size="lg"
                className="w-full justify-between gap-2.5 font-normal"
                onClick={() => onSwitch?.(organization)}
              >
                <span className="min-w-0 truncate">{organization.name}</span>
                {current ? <Check aria-hidden="true" strokeWidth={1.75} /> : null}
              </Button>
            );
          })}
          {onCreate ? (
            <>
              <div className="my-1 border-t border-border" />
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2.5 font-normal"
                onClick={onCreate}
              >
                <Plus className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>New organization</Trans>
              </Button>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
      <div className="my-1 border-t border-border" />
    </>
  );
}
