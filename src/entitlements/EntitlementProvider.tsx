import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { entitlementEvents, EntitlementRequiredPayload } from './entitlementEvents';
import { queryClient } from '../services/queryClient';
import { logger } from '../utils/logger';

type EntitlementStatus = 'unknown' | 'checking' | 'active' | 'inactive' | 'unavailable';

interface EntitlementContextValue {
  entitlementActive: boolean | null;
  checking: boolean;
  refreshEntitlement: () => Promise<boolean>;
  openPlans: () => void;
  paywallVisible: boolean;
  paywallMessage: string | null;
  dismissPaywall: () => void;
}

const EntitlementContext = createContext<EntitlementContextValue>({
  entitlementActive: null,
  checking: false,
  refreshEntitlement: async () => false,
  openPlans: () => {},
  paywallVisible: false,
  paywallMessage: null,
  dismissPaywall: () => {},
});

export function useEntitlement() {
  return useContext(EntitlementContext);
}

interface EntitlementProviderProps {
  children: React.ReactNode;
  onOpenPlans?: () => void;
}

export function EntitlementProvider({ children, onOpenPlans }: EntitlementProviderProps) {
  const user = useCurrentUser();
  const [status, setStatus] = useState<EntitlementStatus>('unknown');
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const isStudent = user?.role === 'student';

  const refreshEntitlement = useCallback(async (): Promise<boolean> => {
    if (!isStudent) return true;
    try {
      setStatus('checking');
      const result = await clientPaymentsApi.getEntitlement();
      const active = result?.active === true;
      setStatus(active ? 'active' : 'inactive');
      if (active) {
        setPaywallVisible(false);
        setPaywallMessage(null);
      }
      return active;
    } catch (err) {
      logger.error('EntitlementProvider', 'refreshEntitlement failed', err);
      setStatus('unavailable');
      return false;
    }
  }, [isStudent]);

  const openPlans = useCallback(() => {
    setPaywallVisible(true);
    if (onOpenPlans) onOpenPlans();
  }, [onOpenPlans]);

  const dismissPaywall = useCallback(() => {
    setPaywallVisible(false);
  }, []);

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
      setStatus('inactive');
      setPaywallMessage(payload.message);
      setPaywallVisible(true);
      // Invalidate paid query caches
      queryClient.invalidateQueries();
    });
    return unsub;
  }, []);

  const entitlementActive = status === 'active' ? true : status === 'inactive' ? false : null;

  return (
    <EntitlementContext.Provider
      value={{
        entitlementActive,
        checking: status === 'checking',
        refreshEntitlement,
        openPlans,
        paywallVisible,
        paywallMessage,
        dismissPaywall,
      }}
    >
      {children}
    </EntitlementContext.Provider>
  );
}
