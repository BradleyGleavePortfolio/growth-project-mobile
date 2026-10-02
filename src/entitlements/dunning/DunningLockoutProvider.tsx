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
  | { ok: false; error: DunningErrorCopy };

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
  const [locked, setLocked] = useState<boolean>(dunningLockoutStore.isLocked());
  const [loadError, setLoadError] = useState<DunningErrorCopy | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(getCurrentRouteName());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const wasLockedRef = useRef(locked);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setRefreshing(true);
    try {
      const next = await dunningApi.getStatus();
      setStatus(next);
      setLoadError(null);
      if (next.state === 'locked') {
        dunningLockoutStore.reportLocked({ requestId: null, requestUrl: '/v1/checkout/dunning' });
      } else {
        dunningLockoutStore.clear();
      }
    } catch (err) {
      const copy = describeDunningError(err, 'load_status');
      setLoadError(copy);
      if (copy.report) {
        captureError(err, { surface: 'dunning_status', dunning_error_code: copy.code, request_id: copy.reference });
      }
    } finally {
      setRefreshing(false);
    }
  }, [enabled]);

  // Bootstrap + store subscription (403 LOCKED_DUNNING from any request).
  useEffect(() => {
    if (!enabled) {
      dunningLockoutStore.clear();
      setStatus(null);
      return undefined;
    }
    void refresh();
    return dunningLockoutStore.subscribe((isLocked) => {
      setLocked(isLocked);
    });
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
      try {
        const response = await dunningApi.cancelPlan(purchaseId);
        await refresh();
        return { ok: true, response };
      } catch (err) {
        const error = describeDunningError(err, 'cancel_plan');
        if (error.report) {
          captureError(err, { surface, dunning_error_code: error.code, request_id: error.reference });
        }
        // A lost answer may still have ended the plan: show the truth.
        await refresh();
        return { ok: false, error };
      }
    },
    [status?.purchase_id, refresh],
  );

  const value = useMemo<DunningContextValue>(
    () => ({ status, locked, refreshing, refresh, updateCard, endPlan, messageCoach: onMessageCoach }),
    [status, locked, refreshing, refresh, updateCard, endPlan, onMessageCoach],
  );

  return (
    <DunningContext.Provider value={value}>
      {children}
      {showLockout ? (
        <View style={StyleSheet.absoluteFill} testID="dunning-lockout-overlay">
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
