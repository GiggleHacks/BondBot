import { useLingui } from "@lingui/react/macro";
import type {
  BotVpnStatus,
  ComputerVpnOverview,
  VpnProfileInfo,
} from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  cn,
} from "@rakazo/ui-web";
import { AlertTriangle, Check, Globe, Lock, ShieldAlert, ShieldCheck, Unlock } from "lucide-react";
import { useState } from "react";
import { CountryFlag } from "../../components/CountryFlag";
import type { ComputerVpnController } from "./use-computer-vpn";

export type PendingVpnChoice = {
  botId: string;
  botName: string;
  profile: string | null;
  locked: boolean;
  label: string;
};

export function resolveBotVpnDisplay(
  botVpn: BotVpnStatus | undefined,
  overview: ComputerVpnOverview | null,
): {
  countryCode: string;
  countryName: string;
  serverLabel: string | null;
  state: BotVpnStatus["state"];
  locked: boolean;
  exitIp: string | null;
} | null {
  if (!overview?.supported || !botVpn) return null;
  const profile = botVpn.vpnProfile
    ? overview.profiles.find((p) => p.id === botVpn.vpnProfile)
    : undefined;
  const hostCountry = overview.hostCountry ?? "TH";
  const state = botVpn.state;

  if (state === "vpn" && profile) {
    return {
      countryCode: profile.countryCode,
      countryName: profile.countryName,
      serverLabel: profile.serverLabel,
      state,
      locked: botVpn.vpnLocked,
      exitIp: botVpn.exitIp,
    };
  }
  if (state === "blocked") {
    return {
      countryCode: profile?.countryCode ?? hostCountry,
      countryName: profile?.countryName ?? "Blocked",
      serverLabel: profile?.serverLabel ?? null,
      state,
      locked: botVpn.vpnLocked,
      exitIp: null,
    };
  }
  if (state === "stopped" && profile) {
    return {
      countryCode: profile.countryCode,
      countryName: profile.countryName,
      serverLabel: profile.serverLabel,
      state,
      locked: botVpn.vpnLocked,
      exitIp: null,
    };
  }
  if (state === "fallback") {
    return {
      countryCode: botVpn.exitCountry ?? hostCountry,
      countryName: "Thailand (Fallback)",
      serverLabel: profile?.serverLabel ?? null,
      state,
      locked: false,
      exitIp: botVpn.exitIp ?? overview.hostIp,
    };
  }
  const directCode = botVpn.exitCountry ?? hostCountry;
  return {
    countryCode: directCode,
    countryName: directCode === "TH" ? "Thailand (Direct)" : `${directCode} (Direct)`,
    serverLabel: null,
    state,
    locked: false,
    exitIp: botVpn.exitIp ?? overview.hostIp,
  };
}

export function ComputerVpnFlagChip({
  botVpn,
  overview,
  compact = false,
}: {
  botVpn: BotVpnStatus | undefined;
  overview: ComputerVpnOverview | null;
  compact?: boolean;
}) {
  const display = resolveBotVpnDisplay(botVpn, overview);
  if (!display) return null;

  const isWarning = display.state === "fallback";
  const isBlocked = display.state === "blocked";
  const isVpn = display.state === "vpn";
  const isStopped = display.state === "stopped";
  const isArmedStopped = isStopped && Boolean(botVpn?.vpnProfile);
  const isDirect = display.state === "direct" || (isStopped && !botVpn?.vpnProfile);

  const ledClass = isBlocked
    ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.95)]"
    : isWarning
      ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.95)] animate-pulse"
      : isVpn
        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.95)]"
        : isArmedStopped
          ? "bg-emerald-400/70 shadow-[0_0_4px_rgba(52,211,153,0.6)]"
          : isStopped
            ? "border border-zinc-500 bg-transparent"
            : "bg-zinc-500/75";

  const NetworkIcon = isBlocked
    ? ShieldAlert
    : isWarning
      ? AlertTriangle
      : display.locked && (isVpn || isArmedStopped)
        ? ShieldCheck
        : Globe;

  const iconTone = isBlocked
    ? "text-red-400"
    : isWarning
      ? "text-amber-400"
      : isVpn || isArmedStopped
        ? "text-emerald-400"
        : "text-muted-foreground";

  const shortStatus = isBlocked
    ? "VPN BLOCKED"
    : isWarning
      ? `FALLBACK · ${display.countryCode}`
      : isVpn
        ? `${display.locked ? "VPN LOCKED" : "VPN ON"} · ${display.countryCode}`
        : isArmedStopped
          ? `${display.locked ? "VPN LOCKED" : "VPN READY"} · ${display.countryCode}`
          : `VPN OFF · ${display.countryCode}`;

  const tooltip = isBlocked
    ? `Kill Switch active — internet blocked`
    : isWarning
      ? `VPN tunnel down — fell back to ${display.countryName}${display.exitIp ? ` (${display.exitIp})` : ""}`
      : isVpn
        ? `VPN ON${display.locked ? " (Locked)" : ""} · ${display.countryName}${display.exitIp ? ` (${display.exitIp})` : ""}`
        : isArmedStopped
          ? `VPN ${display.locked ? "Locked" : "Ready"} · ${display.countryName} (computer asleep — boots on VPN when woken)`
          : `VPN OFF · Direct (${display.countryName}${display.exitIp ? ` · ${display.exitIp}` : ""})`;

  return (
    <span
      title={tooltip}
      className={cn(
        "relative inline-flex items-center rounded-md border transition-colors",
        compact ? "gap-0.5 px-1 py-px" : "gap-1.5 rounded-full px-2 py-0.5",
        isBlocked
          ? "border-red-500/60 bg-red-500/15"
          : isWarning
            ? "border-amber-500/60 bg-amber-500/15"
            : isVpn || isArmedStopped
              ? "border-emerald-500/50 bg-emerald-500/12"
              : "border-border/70 bg-muted/50",
        isStopped && !isArmedStopped && "opacity-75",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(compact ? "size-1" : "size-1.5", "inline-block shrink-0 rounded-full", ledClass)}
      />
      <NetworkIcon className={cn(compact ? "size-2.5" : "size-3", "shrink-0", iconTone)} aria-hidden="true" />
      <CountryFlag
        code={display.countryCode}
        className={cn(
          compact ? "h-2 w-3 rounded-[2px]" : "h-3 w-4 rounded-[2px]",
          "shrink-0 ring-1 ring-white/20",
          (isBlocked || isDirect) && !isVpn && !isArmedStopped && "opacity-90",
          isBlocked && "grayscale opacity-60",
        )}
      />
      {!compact ? (
        <span
          className={cn(
            "text-[11px] font-medium tracking-tight tabular-nums",
            isBlocked
              ? "text-red-300"
              : isWarning
                ? "text-amber-300"
                : isVpn || isArmedStopped
                  ? "text-emerald-300"
                  : "text-muted-foreground",
          )}
        >
          {shortStatus}
        </span>
      ) : null}
    </span>
  );
}

export function ComputerVpnPopover({
  botId,
  botName,
  vpn,
  trigger,
  align = "start",
  side = "bottom",
}: {
  botId: string;
  botName: string;
  vpn: ComputerVpnController;
  trigger: React.ReactElement;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [teamConfirm, setTeamConfirm] = useState<PendingVpnChoice | null>(null);
  const overview = vpn.overview;
  const botVpn = overview?.bots[botId];
  const display = resolveBotVpnDisplay(botVpn, overview);

  if (!overview?.supported || !botVpn || !display) return null;

  const busy = vpn.pendingBotId === botId;
  const isTeam = botVpn.computerMode === "team";
  const selectedProfile = botVpn.vpnProfile;
  const locked = botVpn.vpnLocked;

  const applySelection = async (
    nextProfile: string | null,
    nextLocked: boolean,
    label: string,
    switchToDedicated?: boolean,
  ) => {
    if (isTeam && switchToDedicated === undefined && nextProfile !== null) {
      setTeamConfirm({
        botId,
        botName,
        profile: nextProfile,
        locked: nextLocked,
        label,
      });
      return;
    }
    setTeamConfirm(null);
    await vpn.setBotVpn({
      botId,
      profile: nextProfile,
      locked: nextLocked,
      switchToDedicated,
    });
  };

  const toggleLock = async (nextLocked: boolean) => {
    if (!selectedProfile) return;
    if (isTeam && nextLocked) {
      const prof = overview.profiles.find((p) => p.id === selectedProfile);
      setTeamConfirm({
        botId,
        botName,
        profile: selectedProfile,
        locked: true,
        label: prof ? `${prof.countryName} (${prof.serverLabel})` : selectedProfile,
      });
      return;
    }
    await vpn.setBotVpn({
      botId,
      profile: selectedProfile,
      locked: nextLocked,
    });
  };

  const statusTone =
    display.state === "vpn"
      ? "text-emerald-400"
      : display.state === "blocked"
        ? "text-destructive"
        : display.state === "fallback"
          ? "text-amber-400"
          : "text-muted-foreground";

  const statusText =
    display.state === "vpn"
      ? t`Protected via Proton VPN`
      : display.state === "blocked"
        ? t`Kill Switch active — internet blocked`
        : display.state === "fallback"
          ? t`Tunnel down — fell back to Direct`
          : display.state === "stopped"
            ? t`Computer stopped`
            : t`Direct connection (No VPN)`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTeamConfirm(null);
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} side={side} className="w-80 gap-3 p-3">
        <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-body-sm font-semibold text-foreground">
              <CountryFlag code={display.countryCode} />
              <span className="truncate">{botName}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {isTeam ? t`Team computer` : t`Own computer`}
              </span>
            </div>
            <div className={cn("mt-1 flex items-center gap-1 text-label font-medium", statusTone)}>
              {display.state === "vpn" ? (
                <ShieldCheck className="size-3.5 shrink-0" />
              ) : display.state === "blocked" ? (
                <ShieldAlert className="size-3.5 shrink-0" />
              ) : null}
              <span>{statusText}</span>
            </div>
            <div className="mt-0.5 text-label text-muted-foreground tabular-nums">
              {display.exitIp
                ? t`Exit IP: ${display.exitIp} (${display.countryCode})`
                : display.state === "stopped"
                  ? t`Starts on ${selectedProfile ? display.countryName : "Direct"}`
                  : t`No outbound internet`}
            </div>
          </div>
        </div>

        {teamConfirm ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <p className="text-label text-foreground">
              {t`${botName} currently shares the Team Computer. Separate it or update everyone on it?`}
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void applySelection(
                  teamConfirm.profile,
                  teamConfirm.locked,
                  teamConfirm.label,
                  true,
                )
              }
            >
              {t`Switch ${botName} to Own computer (${teamConfirm.label})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void applySelection(
                  teamConfirm.profile,
                  teamConfirm.locked,
                  teamConfirm.label,
                  false,
                )
              }
            >
              {t`Apply to whole Team Computer`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setTeamConfirm(null)}
            >
              {t`Cancel`}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={busy || locked}
                onClick={() => void applySelection(null, false, "Direct")}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-body-sm transition-colors",
                  selectedProfile === null
                    ? "bg-accent text-foreground font-medium"
                    : "hover:bg-accent/60 text-foreground/90",
                  locked && "cursor-not-allowed opacity-50",
                )}
              >
                <CountryFlag code={overview.hostCountry ?? "TH"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t`Direct (Thailand)`}</div>
                  <div className="text-label text-muted-foreground">
                    {locked ? t`Unlock Kill Switch to switch to Direct` : t`Your host IP`}
                  </div>
                </div>
                {selectedProfile === null ? <Check className="size-4 shrink-0" /> : null}
              </button>

              {overview.profiles.map((prof: VpnProfileInfo) => {
                const active = selectedProfile === prof.id;
                return (
                  <button
                    key={prof.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void applySelection(
                        prof.id,
                        locked,
                        `${prof.countryName} (${prof.serverLabel})`,
                      )
                    }
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-body-sm transition-colors",
                      active
                        ? "bg-accent text-foreground font-medium"
                        : "hover:bg-accent/60 text-foreground/90",
                    )}
                  >
                    <CountryFlag code={prof.countryCode} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{prof.countryName}</span>
                        <span className="text-label text-muted-foreground">{prof.serverLabel}</span>
                      </div>
                      <div className="flex items-center gap-1 text-label text-muted-foreground">
                        <span
                          className={cn(
                            "inline-block size-1.5 rounded-full",
                            prof.up ? "bg-emerald-500" : "bg-destructive",
                          )}
                        />
                        <span>{prof.up ? t`Tunnel ready` : t`Tunnel down`}</span>
                      </div>
                    </div>
                    {active ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-body-sm font-medium text-foreground">
                  {locked ? <Lock className="size-3.5 text-emerald-400" /> : <Unlock className="size-3.5 text-muted-foreground" />}
                  <span>{t`Lock to VPN (Kill Switch)`}</span>
                </div>
                <p className="text-label text-muted-foreground">
                  {selectedProfile
                    ? t`Never fall back to Direct if tunnel drops`
                    : t`Select a VPN country to enable lock`}
                </p>
              </div>
              <Switch
                aria-label={t`Lock to VPN (Kill Switch)`}
                checked={locked}
                disabled={busy || !selectedProfile}
                className="data-checked:bg-emerald-500"
                onCheckedChange={(checked) => void toggleLock(checked)}
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TeamComputerVpnDialog({
  choice,
  busy,
  onClose,
  onConfirm,
}: {
  choice: PendingVpnChoice | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (switchToDedicated: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={Boolean(choice)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t`Separate computer for ${choice?.botName ?? ""}?`}</DialogTitle>
          <DialogDescription>
            {t`${choice?.botName ?? "This bot"} currently shares the Team Computer with your other bots. To give only this bot ${choice?.label ?? "a VPN"}, switch it to Own computer.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={busy} onClick={() => onConfirm(true)}>
            {t`Switch ${choice?.botName ?? ""} to Own computer & use ${choice?.label ?? ""}`}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onConfirm(false)}>
            {t`Apply ${choice?.label ?? ""} to whole Team Computer`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t`Cancel`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
