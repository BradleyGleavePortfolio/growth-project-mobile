/**
 * useLeanOnboardingReconcile — fires once per app session to retry the
 * lean → backend sync if a previous attempt bailed offline.
 *
 * Triggers a `finalizeLeanOnboarding()` call when:
 *   - `lean_onboarding_done` flag is set (user finished the lean flow), AND
 *   - `lean_onboarding_synced` is NOT set (we've never confirmed a 200 from
 *     PUT /profile for this user)
 *
 * No-ops in every other case. Failure is silent — `finalizeLeanOnboarding`
 * leaves the flags intact, so the next app open will try again.
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeLeanOnboarding } from '../lib/finalizeLeanOnboarding';

export function useLeanOnboardingReconcile(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const done = await AsyncStorage.getItem('lean_onboarding_done');
        if (done !== 'true') return;
        const synced = await AsyncStorage.getItem('lean_onboarding_synced');
        if (synced === 'true') return;
        if (cancelled) return;
        await finalizeLeanOnboarding();
      } catch {
        // Best-effort; never throw from a passive reconcile.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
