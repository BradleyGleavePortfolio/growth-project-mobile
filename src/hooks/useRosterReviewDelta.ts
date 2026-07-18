/**
 * useRosterReviewDelta — the honest, roster-derived progress source for the v0.3
 * extension import review (PR-M3).
 *
 * The mobile contract has NO import-progress read, so this hook NEVER invents
 * completion. It derives the ONLY truthful signal available — how many clients
 * have appeared in the coach's authoritative roster since the import journey
 * started — from the roster mobile already consumes (`coachStore`, backed by
 * GET /coach/clients). Reconstructed clients materialise there; the delta is
 * real product truth, never an extension estimate.
 *
 * Boundaries:
 *   • One source of truth (Rule 20): the roster count in `coachStore`. Baseline
 *     is a snapshot of that count at journey start; delta is derived, never a
 *     second stored copy of progress.
 *   • User-scoped (Rule 15): the baseline is keyed to the authenticated user id
 *     and reset whenever the user changes, so a second coach on the same device
 *     never inherits the first coach's baseline.
 *   • Fail closed: when the import feature flag is OFF the hook touches no
 *     network and reports a flat zero delta.
 *   • Foreground refresh: on app resume it re-loads the authoritative roster and
 *     recomputes the delta — never a client clock, never a poll of the crawl.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useCoachStore } from '../store/coachStore';
import { useCurrentUser } from './useCurrentUser';
import { featureFlags } from '../config/featureFlags';

export interface RosterReviewDelta {
  /** Clients added to the authoritative roster since journey start (floored 0). */
  delta: number;
  /** Re-load the authoritative roster and recompute the delta. */
  refresh: () => void;
}

/**
 * @param enabled defaults to the import kill switch so the hook fails closed
 *   (no network, flat zero delta) whenever the feature is OFF.
 */
export function useRosterReviewDelta(
  enabled: boolean = featureFlags.extensionImport,
): RosterReviewDelta {
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const loadClients = useCoachStore((s) => s.loadClients);

  // User-scoped baseline: { userId, count } snapshotted at journey start. A ref
  // (not state) because it is a fixed anchor, not a rendered value; delta is the
  // single derived, rendered figure.
  const baselineRef = useRef<{ userId: string; count: number } | null>(null);
  const [delta, setDelta] = useState(0);

  // Capture the baseline once per user at journey start: load the authoritative
  // roster first, then snapshot its count so the baseline reflects the true
  // pre-import roster (not a transient empty cache). Reset on user change.
  useEffect(() => {
    if (!enabled || !userId) {
      baselineRef.current = null;
      setDelta(0);
      return;
    }
    if (baselineRef.current?.userId === userId) return;
    baselineRef.current = null;
    setDelta(0);
    let cancelled = false;
    void loadClients(userId).then(() => {
      if (cancelled) return;
      baselineRef.current = { userId, count: useCoachStore.getState().clients.length };
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, loadClients]);

  const refresh = useCallback(() => {
    if (!enabled) return;
    const base = baselineRef.current;
    if (!userId || !base || base.userId !== userId) return;
    void loadClients(userId).then(() => {
      const current = useCoachStore.getState().clients.length;
      setDelta(Math.max(0, current - base.count));
    });
  }, [enabled, userId, loadClients]);

  // Foreground refresh: on resume, re-load the roster and recompute the delta.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { delta, refresh };
}
