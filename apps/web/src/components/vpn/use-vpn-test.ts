import type { VpnTestResult } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { useSave } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";
import { vpnTestMessage } from "./vpn-labels";

/** Tests one VPN, at once when `testNow` is set (a file just uploaded), and says how it went. */
export function useVpnTest(profileId: string, onTested: () => void, testNow = false) {
  const [result, setResult] = useState<VpnTestResult | null>(null);
  const test = useSave({
    save: (id: string, rpc) => rpc.computer.testVpnProfile({ id }),
    onSaved: (tested) => {
      setResult(tested);
      onTested();
    },
  });
  useEffect(() => {
    if (testNow) test.run(profileId);
  }, [testNow, profileId]);
  const message = test.pending
    ? "Testing the connection…"
    : test.error
      ? errorText(test.error, "Could not test this VPN. Try again.")
      : result
        ? vpnTestMessage(result)
        : null;
  return {
    run: () => test.run(profileId),
    pending: test.pending,
    message,
    ok: !test.pending && !test.error && result?.outcome === "connected",
    failed:
      !test.pending && (Boolean(test.error) || (result !== null && result.outcome !== "connected")),
  };
}
