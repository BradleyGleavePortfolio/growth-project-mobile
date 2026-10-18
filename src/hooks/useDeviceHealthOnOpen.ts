/**
 * useDeviceHealthOnOpen — reads Apple Health or Health Connect on this phone into the server when Home
 * first opens (once the client's connections are known) and each time the app returns to the foreground,
 * whichever tab is open. Phone health data reaches the server only when the app reads it, as Health does
 * on open (WearablesShell), so last night's sleep reaches Home's Sleep dial without opening Health.
 * Quiet (Health shows a failed read), one read at a time; new samples refetch the wearable reads, except
 * after a sign-out or account switch (C-317-a).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useInvalidateWearableConnections } from './useWearableConnections';
import { deviceSourceForPlatform, refreshOnDevice, type RemoteConnectionView } from '../services/health/onDeviceSync';
import { currentAuthGeneration } from '../services/health/sessionFence';
import { logger } from '../utils/logger';

export function useDeviceHealthOnOpen(connections: readonly RemoteConnectionView[] | undefined): void {
  const invalidateWearables = useInvalidateWearableConnections();
  const state = useRef<'idle' | 'busy' | 'done'>('idle');
  const read = useRef<() => void>(() => undefined);
  read.current = () => {
    const source = deviceSourceForPlatform();
    if (!source || !connections || state.current === 'busy') return;
    state.current = 'busy';
    const generation = currentAuthGeneration();
    refreshOnDevice(source, connections)
      .then((outcome) => {
        if (outcome.kind === 'imported' && outcome.postedCount > 0 && currentAuthGeneration() === generation) invalidateWearables();
      })
      .catch(() => logger.warn('[home] on-device refresh failed')) // the fixed line alone, never what the error carries (C-317-b)
      .finally(() => { state.current = 'done'; });
  };
  useEffect(() => {
    if (state.current === 'idle') read.current();
  }, [connections]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') read.current(); });
    return () => sub.remove();
  }, []);
}
