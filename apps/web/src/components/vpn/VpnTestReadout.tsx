import type { VpnTestOutcome, VpnTestResult } from "@rakazo/contracts";
import { cn } from "@rakazo/ui-web";

const FAILURES: Record<Exclude<VpnTestOutcome, "connected">, string> = {
  no_handshake: "No response",
  no_internet: "No internet",
  not_private: "Not going through VPN",
};

export interface VpnTestState {
  pending: boolean;
  /** The test itself could not be run. */
  errored: boolean;
  result: VpnTestResult | null;
}

/** A test in a glance: ping and IP address, or what failed in a few words. */
export function VpnTestReadout({ test, className }: { test: VpnTestState; className?: string }) {
  const { pending, errored, result } = test;
  if (!pending && !errored && !result) return null;
  return (
    <p role="status" className={cn("flex flex-wrap gap-x-3 text-body-sm tabular-nums", className)}>
      {pending ? (
        <span className="text-muted-foreground">Testing…</span>
      ) : errored || !result ? (
        <span className="text-destructive">Test failed</span>
      ) : result.outcome !== "connected" ? (
        <span className="text-destructive">{FAILURES[result.outcome]}</span>
      ) : (
        <>
          <span className="text-success">
            {result.latencyMs === null ? "Working" : `${result.latencyMs} ms`}
          </span>
          {result.exitIp ? <span className="text-muted-foreground">{result.exitIp}</span> : null}
        </>
      )}
    </p>
  );
}
