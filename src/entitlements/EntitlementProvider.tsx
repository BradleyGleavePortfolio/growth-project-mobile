import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { entitlementEvents, EntitlementRequiredPayload } from './entitlementEvents';
import { queryClient } from '../services/queryClient';
import { logger } from '../utils/logger';
import { PaywallSheet } from './PaywallSheet';
import { dunningLockoutStore } from './dunning/dunningLockoutStore';

export type EntitlementStatus =
  | 'unknown'
  | 'checking'
  | 'loading'
  | 'active'
  | 'inactive'
  | 'unavailable';

export interface EntitlementContextValue {
  entitlementActive: boolean | null;
  checking: boolean;
  /** Raw status — needed by ProtectedScreen to distinguish first-fetch spinner from fail-closed. */
  status: EntitlementStatus;
  refreshEntitlement: () => Promise<boolean>;
  openPlans: () => void;
  paywallVisible: boolean;
  paywallMessage: string | null;
  dismissPaywall: () => void;
  /** Open the in-app thread with the coach (closes the sheet first). */
  messageCoach: () => void;
}

const EntitlementContext = createContext<EntitlementContextValue>({
  entitlementActive: null,
  checking: false,
  status: 'unknown',
  refreshEntitlement: async () => false,
  openPlans: () => {},
  paywallVisible: false,
  paywallMessage: null,
  dismissPaywall: () => {},
  messageCoach: () => {},
});

export function useEntitlement() {
  return useContext(EntitlementContext);
}

interface EntitlementProviderProps {
  children: React.ReactNode;
  onOpenPlans?: () => void;
  /**
   * Navigate to the client's thread with their coach. Used by the iOS
   * coach-managed gate (audit #304 B1) instead of a package purchase.
   */
  onMessageCoach?: () => void;
}

export function EntitlementProvider({ children, onOpenPlans, onMessageCoach }: EntitlementProviderProps) {
  const user = useCurrentUser();
  const [status, setStatus] = useState<EntitlementStatus>('unknown');
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hasSettledRef = useRef(false);

  const isStudent = user?.role === 'student';
  const [dunningLocked, setDunningLocked] = useState<boolean>(dunningLockoutStore.isLocked());
  useEffect(() => dunningLockoutStore.subscribe((locked) => setDunningLocked(locked)), []);

  const refreshEntitlement = useCallback(async (): Promise<boolean> => {
    if (!isStudent) return true;
    setStatus(hasSettledRef.current ? 'checking' : 'loading');
    const result = await clientPaymentsApi.getEntitlement();
    hasSettledRef.current = true;
    if (!result.ok) {
      // Defense in depth (Option B): transport / config failures must fail
      // closed at the gate. We expose `unavailable` so ProtectedScreen can
      // render the paywall and refuse to leak paid surfaces on network errors.
      if (result.reason === 'error') {
        logger.error('EntitlementProvider', 'refreshEntitlement failed', result.message);
      }
      setStatus('unavailable');
      return false;
    }
    const active = result.data.active === true;
    setStatus(active ? 'active' : 'inactive');
    if (active) {
      setPaywallVisible(false);
      setPaywallMessage(null);
    }
    return active;
  }, [isStudent]);

  const openPlans = useCallback(() => {
    setPaywallVisible(true);
    if (onOpenPlans) onOpenPlans();
  }, [onOpenPlans]);

  const dismissPaywall = useCallback(() => {
    setPaywallVisible(false);
  }, []);

  const messageCoach = useCallback(() => {
    setPaywallVisible(false);
    if (onMessageCoach) onMessageCoach();
  }, [onMessageCoach]);

  // Bootstrap on login
  useEffect(() => {
    if (isStudent) {
      void refreshEntitlement();
    } else {
      setStatus('active');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudent, user?.id]);

  // Re-check on app foreground
  useEffect(() => {
    if (!isStudent) return;
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        void refreshEntitlement();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [isStudent, refreshEntitlement]);

  // Listen for 402 entitlement events
  useEffect(() => {
    const unsub = entitlementEvents.onRequired((payload: EntitlementRequiredPayload) => {
      if (!isStudent) return; // coaches/owners never get paywalled
      setStatus('inactive');
      setPaywallMessage(payload.message);
      setPaywallVisible(true);
      // Invalidate paid query caches
      queryClient.invalidateQueries();
    });
    return unsub;
  }, [isStudent]);

  const entitlementActive = status === 'active' ? true : status === 'inactive' ? false : null;

  const handleSubscribe = useCallback(
    (_packageId?: string) => {
      setPaywallVisible(false);
      if (onOpenPlans) onOpenPlans();
    },
    [onOpenPlans],
  );

  return (
    <EntitlementContext.Provider
      value={{
        entitlementActive,
        checking: status === 'checking' || status === 'loading',
        status,
        refreshEntitlement,
        openPlans,
        paywallVisible,
        paywallMessage,
        dismissPaywall,
        messageCoach,
      }}
    >
      {children}
      <PaywallSheet
        // A payment lockout has its own full-screen state; never stack the
        // plan picker on top of it (S-DUNNING).
        visible={paywallVisible && !dunningLocked}
        message={paywallMessage}
        onClose={dismissPaywall}
        onSubscribe={handleSubscribe}
        onMessageCoach={onMessageCoach ? messageCoach : undefined}
      />
    </EntitlementContext.Provider>
  );
}
