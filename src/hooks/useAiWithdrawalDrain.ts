/**
 * Carries out a "no" to the optional Roman and AI box (P0 box 2) that the
 * AI consent ledger has not confirmed yet (Sol B-310-5).
 *
 * The consultation keeps such a withdrawal under a per-user key that
 * outlives its draft (lib/consultation/aiConsent.ts). This hook, mounted by
 * the client app, sends it when the app opens and each time it comes back to
 * the foreground, for the signed-in user only, behind any ledger write
 * already queued. The key is cleared only after a confirmed DELETE; a newer
 * "yes" clears it first, so an older "no" never undoes it. DELETE is
 * idempotent, so withdrawing a grant that never landed is harmless.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { aiConsentApi } from '../api/aiConsentApi';
import { drainAiWithdrawal } from '../lib/consultation/aiConsent';
import { readUserCacheSync } from '../lib/userCache';
import { logger } from '../utils/logger';
import { useCurrentUser } from './useCurrentUser';

export interface AiWithdrawalDrainDeps {
  withdraw: typeof aiConsentApi.withdrawRoman;
  /** The signed-in user right now; every attempt needs the same user. */
  sessionUserId: () => string | null;
}

const defaultDeps: AiWithdrawalDrainDeps = {
  withdraw: aiConsentApi.withdrawRoman,
  sessionUserId: () => readUserCacheSync()?.id ?? null,
};

export function useAiWithdrawalDrain(deps: AiWithdrawalDrainDeps = defaultDeps): void {
  const userId = useCurrentUser()?.id ?? null;
  useEffect(() => {
    if (!userId) return undefined;
    const drain = () => {
      void drainAiWithdrawal(userId, deps.withdraw, () => deps.sessionUserId() === userId)
        .then((result) => {
          if (result === 'failed') {
            logger.warn('AiWithdrawalDrain', 'optional AI withdrawal still not confirmed; kept pending');
          }
        })
        .catch(() => undefined);
    };
    drain();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') drain();
    });
    return () => sub.remove();
  }, [userId, deps]);
}
