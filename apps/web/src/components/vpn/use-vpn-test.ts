import type { VpnTestResult } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { useSave } from "../../lib/query/query";

/**
 * Tests one VPN: at once when `testNow` is set (a file just uploaded), and again each time
 * `round` goes up (Test all).
 */
export function useVpnTest(
  profileId: string,
  onTested: () => void,
  { testNow = false, round = 0 }: { testNow?: boolean; round?: number } = {},
) {
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
  useEffect(() => {
    if (round > 0) test.run(profileId);
  }, [round, profileId]);
  return {
    run: () => test.run(profileId),
    pending: test.pending,
    errored: Boolean(test.error),
    result,
  };
}
