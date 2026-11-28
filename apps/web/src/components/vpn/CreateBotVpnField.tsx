import type { AddVpnProfilesResult } from "@rakazo/contracts";
import { Checkbox, Disclosure, Field, FieldLabel, OptionSelect } from "@rakazo/ui-web";
import { useId, useMemo, useState } from "react";
import type { ComputerVpnController } from "../../pages/shell/use-computer-vpn";
import { useVpnTest } from "./use-vpn-test";
import { VpnTestReadout } from "./VpnTestReadout";
import { vpnProfileLabel } from "./vpn-labels";
import { sortVpnProfiles } from "./vpn-upload";
import { VpnFileHelp, VpnUploadButton, VpnUploadSummary } from "./vpn-upload-controls";

export interface NewBotVpnChoice {
  profile: string | null;
  /** Kill Switch: the bot's computer never goes online without the VPN. */
  locked: boolean;
}

const NO_VPN = "none";

/** The New bot dialog's VPN choice, with an upload for someone who has no file yet. */
export function CreateBotVpnField({
  vpn,
  value,
  onChange,
}: {
  vpn: ComputerVpnController;
  value: NewBotVpnChoice;
  onChange: (next: NewBotVpnChoice) => void;
}) {
  const selectId = useId();
  const lockId = useId();
  const [lastUpload, setLastUpload] = useState<AddVpnProfilesResult | null>(null);
  const overview = vpn.overview;
  const profiles = useMemo(() => sortVpnProfiles(overview?.profiles ?? []), [overview?.profiles]);
  if (!overview?.supported) return null;

  const onUploaded = (result: AddVpnProfilesResult) => {
    setLastUpload(result);
    const first = result.added[0];
    if (first) onChange({ profile: first.id, locked: overview.killSwitchAvailable });
    void vpn.refreshVpn();
  };
  const uploadedNow = new Set(lastUpload?.added.map((profile) => profile.id) ?? []);

  if (profiles.length === 0) {
    return (
      <Disclosure
        summary={<span className="text-body-sm text-muted-foreground">Connect through a VPN</span>}
        contentClassName="space-y-3 pt-2"
      >
        <p className="text-body-sm text-foreground">
          Upload your WireGuard file to connect this bot through a VPN.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <VpnUploadButton label="Upload WireGuard file" onUploaded={onUploaded} />
        </div>
        {lastUpload ? <VpnUploadSummary result={lastUpload} /> : null}
        <VpnFileHelp defaultOpen />
      </Disclosure>
    );
  }

  const options = [
    { value: NO_VPN, label: "No VPN" },
    ...profiles.map((profile) => ({ value: profile.id, label: vpnProfileLabel(profile) })),
  ];
  const selected =
    value.profile && profiles.some((p) => p.id === value.profile) ? value.profile : null;

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={selectId}>VPN</FieldLabel>
        <div className="flex items-center gap-2">
          <OptionSelect
            id={selectId}
            value={selected ?? NO_VPN}
            options={options}
            onValueChange={(next) =>
              onChange(
                next === NO_VPN
                  ? { profile: null, locked: false }
                  : {
                      profile: next,
                      locked: value.profile ? value.locked : overview.killSwitchAvailable,
                    },
              )
            }
          />
          <VpnUploadButton label="Upload WireGuard files" iconOnly onUploaded={onUploaded} />
        </div>
        {selected ? (
          <SelectedVpnStatus
            key={selected}
            profileId={selected}
            testNow={uploadedNow.has(selected)}
            onTested={() => void vpn.refreshVpn()}
          />
        ) : null}
      </Field>
      {selected && overview.killSwitchAvailable ? (
        <Field orientation="horizontal">
          <Checkbox
            id={lockId}
            checked={value.locked}
            onCheckedChange={(checked) => onChange({ profile: selected, locked: checked === true })}
          />
          <FieldLabel htmlFor={lockId} className="font-normal">
            Block the internet if the VPN stops working
          </FieldLabel>
        </Field>
      ) : null}
      {lastUpload?.failed.length ? (
        <VpnUploadSummary result={{ added: [], failed: lastUpload.failed }} />
      ) : null}
    </div>
  );
}

function SelectedVpnStatus({
  profileId,
  testNow,
  onTested,
}: {
  profileId: string;
  testNow: boolean;
  onTested: () => void;
}) {
  const test = useVpnTest(profileId, onTested, { testNow });
  return <VpnTestReadout test={test} />;
}
