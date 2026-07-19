/**
 * useRosterReviewDelta — honest, roster-derived progress for the v0.3 extension
 * import review (PR-M3). The mobile contract has no import-progress read, so this
 * hook never invents completion: it reports only how many clients have appeared
 * in the coach's authoritative roster (coachStore) since the journey started.
 * Baseline is user-scoped (Rule 15), captured only from a successful load
 * (Rule 18); the delta is derived, never a second stored copy (Rule 20).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useCoachStore } from '../store/coachStore';
import { useCurrentUser } from './useCurrentUser';
import { featureFlags } from '../config/featureFlags';

export interface RosterReviewDelta {
  delta: number;
  refresh: () => void;
}

/**
 * @param enabled defaults to the import kill switch so the hook fails closed —
 *   no network, no lifecycle listener, flat zero delta — whenever it is OFF.
 */
export function useRosterReviewDelta(
  enabled: boolean = featureFlags.extensionImport,
): RosterReviewDelta {
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const loadClients = useCoachStore((s) => s.loadClients);

  const baselineRef = useRef<{ userId: string; count: number } | null>(null);
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const [delta, setDelta] = useState(0);

  // Load the authoritative roster, then commit only when the load demonstrably
  // succeeded (Rule 18: a failed load must never anchor a baseline nor move the
  // delta) AND the user has not changed under us (never mix one tenant's counts
  // into another). Re-reads baseline at resolution so a reset can't be raced.
  const sync = useCallback(() => {
    if (!enabled || !userId) return;
    void loadClients(userId).then(() => {
      if (!mountedRef.current || userIdRef.current !== userId) return;
      const state = useCoachStore.getState();
      if (state.loadError !== null) return;
      const count = state.clients.length;
      const base = baselineRef.current;
      if (!base || base.userId !== userId) {
        baselineRef.current = { userId, count };
        setDelta(0);
      } else {
        setDelta(Math.max(0, count - base.count));
      }
    });
  }, [enabled, userId, loadClients]);

  // Capture the baseline once per user at journey start; reset on user change /
  // sign-out so a second coach never inherits the first coach's baseline.
  useEffect(() => {
    if (!enabled || !userId) {
      baselineRef.current = null;
      setDelta(0);
      return;
    }
    if (baselineRef.current?.userId === userId) return;
    baselineRef.current = null;
    setDelta(0);
    sync();
  }, [enabled, userId, sync]);

  // Foreground refresh: recompute on resume, or re-capture if a prior baseline
  // load failed. The listener is registered once per enabled-change (calling the
  // latest sync via a ref) so flag-off touches no listener and re-renders never
  // churn subscriptions.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') syncRef.current();
    });
    return () => subscription.remove();
  }, [enabled]);

  return { delta, refresh: sync };
}
