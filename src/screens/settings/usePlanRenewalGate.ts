/**
 * LO-908R2 B1 (STORE-B2): both notification screens show the plan renewal offers switch only once the plan read
 * (EntitlementProvider) carries `renewal`. After a launch with no signal that read failed (status 'unavailable', no
 * `renewal`) and only an app foreground read it again, so the switch stayed missing. Each screen now reads it again
 * when it opens and on its Try again, and says when it is still failing; the switch still never shows a yes before
 * the server sends one.
 */
import { useCallback, useRef } from 'react';
import { useEntitlement } from '../../entitlements/EntitlementProvider';

export function usePlanRenewalGate(eligible: boolean): {
  /** The plan read carries `renewal` (renewal is on for this person). */
  renewalOn: boolean;
  /** The last plan read failed and nothing says yet whether renewal is on; the screen tells it, with Try again. */
  gateFailed: boolean;
  /** Reads the plan again when its last read failed; resolves once it has answered, never rejects. */
  rereadIfFailed: () => Promise<void>;
} {
  const { renewal, status, refreshEntitlement } = useEntitlement();
  const gateFailed = eligible && renewal === undefined && status === 'unavailable';
  const latest = useRef({ gateFailed, refreshEntitlement });
  latest.current = { gateFailed, refreshEntitlement };
  const rereadIfFailed = useCallback(async () => {
    const { gateFailed: failed, refreshEntitlement: refresh } = latest.current;
    if (!failed || !refresh) return;
    try {
      await refresh();
    } catch {
      // Still failing: the provider keeps 'unavailable' and the screen keeps its notice.
    }
  }, []);
  return { renewalOn: renewal !== undefined, gateFailed, rereadIfFailed };
}
