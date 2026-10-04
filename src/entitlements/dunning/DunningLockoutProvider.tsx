import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View, type AppStateStatus } from 'react-native';
import { queryClient } from '../../services/queryClient';
import { captureError } from '../../services/sentry';
import { dunningApi, type CancelPlanResponse, type ClientDunningStatus } from './dunningApi';
import { describeDunningError, localDunningError, type DunningErrorCopy } from './dunningErrorCopy';
import { dunningLockoutStore } from './dunningLockoutStore';
import { DunningLockoutScreen } from './DunningLockoutScreen';

/**
 * Screens a locked client can still use (the backend allow-list mirrors
 * this: data export, account deletion, the coach thread, and the native
 * card update with its three billing routes). The lockout state steps aside
 * while one of these is focused and returns when the client navigates away.
 */
export const REACHABLE_WHILE_LOCKED: ReadonlySet<string> = new Set([
  'DataExport',
  'DeleteAccount',
  'Messages',
  'UpdateCard',
]);

export type EndPlanResult =
  | { ok: true; response: CancelPlanResponse }
  | { ok: false; error: DunningErrorCopy }
  /**
   * The provider (or the account) that started the request is gone; the
   * answer belongs to nobody on screen, so nothing is shown or refreshed.
   */
  | { ok: false; retired: true; error: null };

export interface DunningContextValue {
  status: ClientDunningStatus | null;
  locked: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Open the native Update card screen and start the card form. */
  updateCard: (surface: string) => void;
  /** End the plan in dunning (2A): void the unpaid invoice, access ends now. */
  endPlan: (surface: string) => Promise<EndPlanResult>;
  messageCoach: () => void;
}

const DunningContext = createContext<DunningContextValue | null>(null);

/** Null outside the provider (coaches, signed-out screens): render nothing. */
export function useDunning(): DunningContextValue | null {
  return useContext(DunningContext);
}

export interface DunningLockoutProviderProps {
  children: React.ReactNode;
  /** Only clients are ever dunned; for anyone else the provider is inert. */
  enabled: boolean;
  onMessageCoach: () => void;
  onOpenDataExport: () => void;
  onOpenDeleteAccount: () => void;
  onSignOut: () => void;
  /** Navigate to the native Update card screen (`UpdateCard`). */
  onOpenUpdateCard: (params: { autostart: boolean; surface: string }) => void;
  /** Current focused route name, and a subscription to route changes. */
  getCurrentRouteName: () => string | undefined;
  subscribeToRouteChanges: (listener: () => void) => () => void;
}

export function DunningLockoutProvider({
  children,
  enabled,
  onMessageCoach,
  onOpenDataExport,
  onOpenDeleteAccount,
  onSignOut,
  onOpenUpdateCard,
  getCurrentRouteName,
  subscribeToRouteChanges,
}: DunningLockoutProviderProps) {
  const [status, setStatus] = useState<ClientDunningStatus | null>(null);
  // B-353-1: not seeded during render; the subscription effect syncs the
  // store, which every identity boundary retires (sign-out, sign-in, this
  // provider unmounting), so a previous account's lock never paints.
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<DunningErrorCopy | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(getCurrentRouteName());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const wasLockedRef = useRef(locked);
  // B-353-1 (Sol): every status read is owned by this provider's lifetime,
  // the auth generation it started under, and its sequence number; only the
  // newest read of a live provider in the same generation may write state.
  const aliveRef = useRef(true);
  const seqRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    const generation = dunningLockoutStore.currentGeneration();
    const owns = () =>
      aliveRef.current &&
      enabledRef.current &&
      seq === seqRef.current &&
      generation === dunningLockoutStore.currentGeneration();
    setRefreshing(true);
    try {
      // A malformed answer throws (strict normaliser), so the last known
      // state stays: a bad body never clears a lockout or a banner (B-322-5).
      const next = await dunningApi.getStatus();
      if (!owns()) return;
      setStatus(next);
      setLoadError(null);
      // Lock only on what the server decided: an enabled cycle in its locked
      // state, not waived. Flag off ({ enabled: false }) is never a lock.
      if (next.enabled && next.state === 'locked' && !next.lock_waived) {
        dunningLockoutStore.reportLocked({ requestId: null, requestUrl: '/v1/checkout/dunning', generation });
      } else {
        dunningLockoutStore.clear(generation);
      }
    } catch (err) {
      if (!owns()) return;
      const copy = describeDunningError(err, 'load_status');
      setLoadError(copy);
      if (copy.report) {
        captureError(err, { surface: 'dunning_status', dunning_error_code: copy.code, request_id: copy.reference });
      }
    } finally {
      if (aliveRef.current && seq === seqRef.current) setRefreshing(false);
    }
  }, [enabled]);

  // Unmount is an identity boundary: the client tree goes away on sign-out
  // and on an account switch, so this provider's generation is retired and
  // nothing it started can lock the next account.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      dunningLockoutStore.retire();
    };
  }, []);

  // Bootstrap + store subscription (403 LOCKED_DUNNING from any request).
  useEffect(() => {
    if (!enabled) {
      // Any read in flight is now stale.
      seqRef.current += 1;
      dunningLockoutStore.clear();
      setStatus(null);
      setLocked(false);
      setRefreshing(false);
      return undefined;
    }
    const unsubscribe = dunningLockoutStore.subscribe((isLocked) => {
      setLocked(isLocked);
    });
    // A 403 from this generation may already have landed before mount.
    setLocked(dunningLockoutStore.isLocked());
    void refresh();
    return unsubscribe;
  }, [enabled, refresh]);

  // When a 403 flips us into the locked state, load the amount and dates.
  // When the lock lifts (payment cleared), refetch every paid query.
  useEffect(() => {
    if (locked && !wasLockedRef.current && status?.state !== 'locked') void refresh();
    if (!locked && wasLockedRef.current) void queryClient.invalidateQueries();
    wasLockedRef.current = locked;
  }, [locked, refresh, status?.state]);

  // Re-check on app foreground (the client may have paid on another device).
  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') void refresh();
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [enabled, refresh]);

  useEffect(
    () => subscribeToRouteChanges(() => setRouteName(getCurrentRouteName())),
    [getCurrentRouteName, subscribeToRouteChanges],
  );

  const showLockout = enabled && locked && !(routeName && REACHABLE_WHILE_LOCKED.has(routeName));

  // Android back must not reveal the locked screen underneath.
  useEffect(() => {
    if (!showLockout) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [showLockout]);

  const updateCard = useCallback(
    (surface: string) => {
      onOpenUpdateCard({ autostart: true, surface });
    },
    [onOpenUpdateCard],
  );

  const endPlan = useCallback(
    async (surface: string): Promise<EndPlanResult> => {
      const purchaseId = status?.purchase_id;
      if (!purchaseId) return { ok: false, error: localDunningError('PLAN_NOT_LOADED') };
      const generation = dunningLockoutStore.currentGeneration();
      const owns = () => aliveRef.current && generation === dunningLockoutStore.currentGeneration();
      try {
        const response = await dunningApi.cancelPlan(purchaseId);
        // B-353-1: a late answer for a retired provider or account is not shown.
        if (!owns()) return { ok: false, retired: true, error: null };
        await refresh();
        if (!owns()) return { ok: false, retired: true, error: null };
        return { ok: true, response };
      } catch (err) {
        const error = describeDunningError(err, 'cancel_plan');
        if (error.report) {
          captureError(err, { surface, dunning_error_code: error.code, request_id: error.reference });
        }
        if (!owns()) return { ok: false, retired: true, error: null };
        // A lost answer may still have ended the plan: show the truth.
        await refresh();
        if (!owns()) return { ok: false, retired: true, error: null };
        return { ok: false, error };
      }
    },
    [status?.purchase_id, refresh],
  );

  const value = useMemo<DunningContextValue>(
    () => ({ status, locked, refreshing, refresh, updateCard, endPlan, messageCoach: onMessageCoach }),
    [status, locked, refreshing, refresh, updateCard, endPlan, onMessageCoach],
  );

  // B-353-4: while the lockout shows, the app underneath is hidden from
  // screen readers (iOS: accessibilityViewIsModal on the overlay and
  // accessibilityElementsHidden on the app; Android: no-hide-descendants).
  // The app is always wrapped in the same View so it never remounts.
  return (
    <DunningContext.Provider value={value}>
      <View
        style={styles.app}
        testID="dunning-app-content"
        accessibilityElementsHidden={showLockout}
        importantForAccessibility={showLockout ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {showLockout ? (
        <View style={StyleSheet.absoluteFill} testID="dunning-lockout-overlay" accessibilityViewIsModal>
          <DunningLockoutScreen
            status={status}
            loadError={loadError}
            refreshing={refreshing}
            onRefresh={refresh}
            onUpdateCard={updateCard}
            onEndPlan={endPlan}
            onMessageCoach={onMessageCoach}
            onOpenDataExport={onOpenDataExport}
            onOpenDeleteAccount={onOpenDeleteAccount}
            onSignOut={onSignOut}
            supportReference={dunningLockoutStore.lastSignal()?.requestId ?? null}
          />
        </View>
      ) : null}
    </DunningContext.Provider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
});
