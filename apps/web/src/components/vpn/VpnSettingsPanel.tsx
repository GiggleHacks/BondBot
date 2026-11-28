import type { AddVpnProfilesResult, VpnProfileInfo } from "@rakazo/contracts";
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@rakazo/ui-web";
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
import { VpnTestReadout } from "./VpnTestReadout";
import { vpnProfileLabel } from "./vpn-labels";
import { botsByVpnProfile, sortVpnProfiles } from "./vpn-upload";
import { VpnFileHelp, VpnUploadButton, VpnUploadSummary } from "./vpn-upload-controls";

/** Settings › VPN: the Space's WireGuard files, uploaded in bulk and tested singly or all at once. */
export function VpnSettingsPanel({
  vpn,
  botNames,
}: {
  vpn: ComputerVpnController;
  botNames: ReadonlyMap<string, string>;
}) {
  const [lastUpload, setLastUpload] = useState<AddVpnProfilesResult | null>(null);
  // Each press of Test all; every row tests itself when it goes up.
  const [testRound, setTestRound] = useState(0);
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

  const actions = (
    <div className="flex flex-wrap justify-end gap-2">
      {profiles.length > 1 ? (
        <Button variant="secondary" size="sm" onClick={() => setTestRound((round) => round + 1)}>
          Test all
        </Button>
      ) : null}
      <VpnUploadButton
        label="Upload files"
        onUploaded={(result) => {
          setLastUpload(result);
          void vpn.refreshVpn();
        }}
      />
    </div>
  );

  return (
    <div className="space-y-4" data-testid="vpn-settings">
      <SettingsGroup title="WireGuard files" action={actions}>
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
              testRound={testRound}
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
  testRound,
  onChanged,
}: {
  profile: VpnProfileInfo;
  usedBy: string[];
  testNow: boolean;
  testRound: number;
  onChanged: () => void;
}) {
  const test = useVpnTest(profile.id, onChanged, { testNow, round: testRound });
  const [confirming, setConfirming] = useState(false);
  const remove = useSave({
    save: (id: string, rpc) => rpc.computer.removeVpnProfile({ id }),
    onSaved: () => {
      setConfirming(false);
      onChanged();
    },
  });
  const label = vpnProfileLabel(profile);

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
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          <VpnTestReadout test={test} className="justify-end" />
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
