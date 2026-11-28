import type { AddVpnProfilesResult, VpnProfileInfo } from "@rakazo/contracts";
import { Button, cn, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@rakazo/ui-web";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSave } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";
import type { ComputerVpnController } from "../../pages/shell/use-computer-vpn";
import { ConfirmDialog } from "../ConfirmDialog";
import { CountryFlag } from "../CountryFlag";
import { Notice } from "../Notice";
import { SettingsGroup } from "../settings/SettingsRows";
import { useVpnTest } from "./use-vpn-test";
import { vpnProfileLabel } from "./vpn-labels";
import { botsByVpnProfile, sortVpnProfiles } from "./vpn-upload";
import { VpnFileHelp, VpnUploadButton, VpnUploadSummary } from "./vpn-upload-controls";

/** Settings › VPN: the Space's WireGuard files, uploaded in bulk and tested one by one. */
export function VpnSettingsPanel({
  vpn,
  botNames,
}: {
  vpn: ComputerVpnController;
  botNames: ReadonlyMap<string, string>;
}) {
  const [lastUpload, setLastUpload] = useState<AddVpnProfilesResult | null>(null);
  const overview = vpn.overview;
  const profiles = useMemo(() => sortVpnProfiles(overview?.profiles ?? []), [overview?.profiles]);
  const users = useMemo(
    () => botsByVpnProfile(overview?.bots ?? {}, botNames),
    [overview?.bots, botNames],
  );
  const justAdded = useMemo(
    () => new Set(lastUpload?.added.map((profile) => profile.id) ?? []),
    [lastUpload],
  );

  if (!overview) return null;
  if (!overview.supported) {
    return (
      <Notice tone="warning">
        VPNs need this server's VPN manager. Its setup guide is docs/bondbot/VPN.md in the BondBot
        repository.
      </Notice>
    );
  }

  const upload = (
    <VpnUploadButton
      label="Upload files"
      onUploaded={(result) => {
        setLastUpload(result);
        void vpn.refreshVpn();
      }}
    />
  );

  return (
    <div className="space-y-4" data-testid="vpn-settings">
      <SettingsGroup title="WireGuard files" action={upload}>
        {profiles.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyTitle>No VPN files yet</EmptyTitle>
              <EmptyDescription>
                Upload your WireGuard file to connect bots through a VPN. You can pick several files
                at once.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          profiles.map((profile) => (
            <VpnProfileRow
              key={profile.id}
              profile={profile}
              usedBy={users.get(profile.id) ?? []}
              testNow={justAdded.has(profile.id)}
              onChanged={() => void vpn.refreshVpn()}
            />
          ))
        )}
      </SettingsGroup>
      {lastUpload ? <VpnUploadSummary result={lastUpload} /> : null}
      <div className="px-4">
        <VpnFileHelp defaultOpen={profiles.length === 0} />
      </div>
    </div>
  );
}

function VpnProfileRow({
  profile,
  usedBy,
  testNow,
  onChanged,
}: {
  profile: VpnProfileInfo;
  usedBy: string[];
  testNow: boolean;
  onChanged: () => void;
}) {
  const test = useVpnTest(profile.id, onChanged, testNow);
  const [confirming, setConfirming] = useState(false);
  const remove = useSave({
    save: (id: string, rpc) => rpc.computer.removeVpnProfile({ id }),
    onSaved: () => {
      setConfirming(false);
      onChanged();
    },
  });
  const label = vpnProfileLabel(profile);
  const status =
    test.message ?? (profile.up ? "Connected" : "Not tested yet. Press Test to check it.");

  return (
    <div className="px-4 py-3" data-testid="vpn-profile-row">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <CountryFlag code={profile.countryCode} />
          <div className="min-w-0">
            <p className="truncate text-body text-foreground">{label}</p>
            <p className="flex min-w-0 flex-wrap gap-x-3 text-body-sm text-muted-foreground">
              {profile.name !== label ? <span className="truncate">{profile.name}</span> : null}
              <span className="truncate">
                {usedBy.length ? `Used by ${usedBy.join(", ")}` : "Not used by any bot"}
              </span>
              {profile.shared ? <span>Added on the server</span> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={test.pending} onClick={test.run}>
            Test
          </Button>
          {profile.shared ? null : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label}`}
              title="Remove"
              className="text-muted-foreground hover:text-destructive active:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <p
        role="status"
        className={cn(
          "mt-1 text-body-sm",
          test.ok ? "text-success" : test.failed ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status}
      </p>
      {confirming ? (
        <ConfirmDialog
          onCancel={() => {
            setConfirming(false);
            remove.reset();
          }}
          title={`Remove ${label}?`}
          description={
            usedBy.length
              ? `${usedBy.join(", ")} must get another VPN first.`
              : "Its WireGuard file is deleted from this server."
          }
          error={remove.error ? errorText(remove.error, "Could not remove it. Try again.") : null}
          confirmLabel="Remove"
          busy={remove.pending}
          onConfirm={() => remove.run(profile.id)}
        />
      ) : null}
    </div>
  );
}
