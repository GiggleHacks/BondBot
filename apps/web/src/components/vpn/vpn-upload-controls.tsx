import type { AddVpnProfilesResult } from "@rakazo/contracts";
import { Button, Disclosure } from "@rakazo/ui-web";
import { Upload } from "lucide-react";
import { useRef } from "react";
import { useSave } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";
import { Notice } from "../Notice";
import { uploadVpnFiles } from "./vpn-upload";

/** Step by step, for someone who has never made a WireGuard file. */
export function VpnFileHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Disclosure
      defaultOpen={defaultOpen}
      summary={
        <span className="text-body-sm text-muted-foreground">How do I get a WireGuard file?</span>
      }
      contentClassName="pt-2"
    >
      <ol className="list-decimal space-y-1.5 ps-5 text-body-sm text-muted-foreground">
        <li>
          Sign in to your VPN account on its website and open its WireGuard downloads. In Proton
          VPN, go to account.protonvpn.com, then Downloads, then WireGuard configuration.
        </li>
        <li>
          Type any device name, choose a platform such as GNU/Linux, then press Create next to a
          server in the country you want.
        </li>
        <li>Press Download, then upload the .conf file here.</li>
      </ol>
      <p className="mt-2 text-body-sm text-muted-foreground">
        Each file is one connection, and your VPN plan limits how many can run at once. Upload
        several files to give bots different countries.
      </p>
    </Disclosure>
  );
}

/** Picks one or more WireGuard files and uploads them; the result goes to `onUploaded`. */
export function VpnUploadButton({
  label,
  iconOnly = false,
  variant = "secondary",
  onUploaded,
}: {
  label: string;
  iconOnly?: boolean;
  variant?: "secondary" | "default";
  onUploaded: (result: AddVpnProfilesResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useSave({
    save: (files: File[], rpc) => uploadVpnFiles(files, rpc),
    onSaved: (result) => onUploaded(result),
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) upload.run(files);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? "icon" : "sm"}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={upload.pending}
        onClick={() => input.current?.click()}
      >
        <Upload data-icon="inline-start" />
        {iconOnly ? null : upload.pending ? "Uploading…" : label}
      </Button>
      {upload.error ? (
        <Notice tone="error" className="basis-full">
          {errorText(upload.error, "Could not upload. Try again.")}
        </Notice>
      ) : null}
    </>
  );
}

/** What happened to each file of an upload, shown until the next one. */
export function VpnUploadSummary({ result }: { result: AddVpnProfilesResult }) {
  return (
    <div className="space-y-2">
      {result.added.length ? (
        <Notice tone="success">
          {result.added.length === 1 ? "Added 1 file" : `Added ${result.added.length} files`}
        </Notice>
      ) : null}
      {result.failed.length ? (
        <Notice tone="error">
          <ul className="space-y-1">
            {result.failed.map((failure, index) => (
              <li key={`${failure.name}-${index}`}>
                <span className="font-medium">{failure.name}</span>: {failure.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}
