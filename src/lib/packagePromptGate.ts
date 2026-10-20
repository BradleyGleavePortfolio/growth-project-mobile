/**
 * When the client is shown the UNSOLICITED PackageSelectionSheet (Day1Win, or
 * the RootNavigator `package_prompt` state at sign-in or cold start).
 *
 *  - Owner #161-5 op 1 (10-19): on iPhone too. The sheet lists only the
 *    client's own coach's packages (GET /v1/clients/me/coach/packages, the
 *    list ClientPackages shows; every client package is 1:1 coaching, see
 *    src/screens/client/README.md "Catalog evidence") and on iOS carries the
 *    ClientPackages label, oneToOneCoachingLabel(). That is the
 *    person-to-person rule (config/purchaseSurfaces.ts, App Review 3.1.3(d));
 *    nonP2PPurchasesHidden() hides one-to-many products only, so it no longer
 *    suppresses this sheet.
 *  - Only a coached client whose entitlement read says, explicitly, no active
 *    plan (`{ ok: true, data: { active: false } }`, `entitlement_active` not
 *    true). No coach, an active plan, an unknown answer or a failed read:
 *    never (fail closed, fix round #304 Sol B1). Coach codes (backend
 *    B-PACKAGE-135): a free or prepaid code grants its package at join, so
 *    that client is active; a paid code attaches the client only once paid
 *    (JoinPackageScreen), so until then there is no coach here.
 *  - Not while a payment is failing or a plan is paused (fix round 1 of #836,
 *    Opus C1): any dunning state other than 'none' (past due, the Day-10
 *    lock, a dispute or refund pause) keeps the sheet away, because the
 *    dunning banner and lockout screens own that moment and a second plan
 *    must not start beside an unpaid one. Read only when the entitlement is
 *    already inactive; a failed read fails closed.
 *  - Once per 24 h (packagePromptDueAtStart): a day after the sheet was last
 *    shown or skipped. The unsolicited sheet saves the time in the same key
 *    the moment it opens (PackageSelectionSheet `recordShown`, #836 Sol B1),
 *    so closing the app, going back or an empty list never brings it back
 *    sooner. iPhone also asks on first Home, because the consultation skips
 *    the Day 1 sheet, and when it does not offer the sheet it saves the time,
 *    so the entitlement read runs at most once a day. Android asks only after
 *    a skip, as before. Never while Roman's tour is unfinished or about to
 *    start, also after a restart (tourAtStart, #836 Opus C4, Sol B2): the
 *    tour comes first, nothing is saved, and a later start offers the sheet.
 */
import { Platform } from 'react-native';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { consultationApi } from '../api/consultationApi';
import { featureFlags } from '../config/featureFlags';
import { dunningApi } from '../entitlements/dunning/dunningApi';
import { useTutorialStore } from '../tutorial/tutorialStore';
import { loadTutorial } from '../tutorial/tutorialStorage';
import type { TutorialStatus } from '../tutorial/types';
import { prefsStorage } from '../storage/mmkv';
import { readUserCache } from './userCache';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Roman's tour on the Home this start opens. RootNavigator decides before TutorialHost mounts, so the live
 * store is empty after a restart: read this user's saved tour. 'ask' = nothing saved, so TutorialHost starts
 * the tour if the server has the finished consultation (Sol B-310-4).
 */
async function tourAtStart(userId: string): Promise<TutorialStatus | 'starting' | 'ask' | 'off'> {
  if (!featureFlags.clientTutorial) return 'off';
  const live = useTutorialStore.getState();
  if (live.pendingStart) return 'starting';
  if (live.hydrated && live.userId === userId) return live.tutorial.status;
  const saved = (await loadTutorial(userId))?.state.status ?? 'not_started';
  return saved === 'not_started' && featureFlags.consultationOnboarding ? 'ask' : saved;
}

export async function shouldOfferPackagePrompt(): Promise<boolean> {
  try {
    if (!(await readUserCache())?.coach_id) return false;
    const res = await clientPaymentsApi.getEntitlement();
    if (!res || !res.ok) return false;
    const data = res.data as { active?: unknown; entitlement_active?: unknown } | null | undefined;
    if (!data || typeof data !== 'object') return false;
    if (data.entitlement_active === true || data.active !== false) return false;
    return (await dunningApi.getStatus()).state === 'none';
  } catch {
    return false;
  }
}

/** R15: the key is per user, so another account on this phone never inherits it. */
export async function packagePromptDueAtStart(userId: string, now: number = Date.now()): Promise<boolean> {
  try {
    const key = `onboarding.package_prompt_dismissed_at:${userId}`;
    const lastAt = await prefsStorage.getStringAsync(key);
    const ios = Platform.OS === 'ios';
    if (lastAt ? !(now - new Date(lastAt).getTime() > DAY_MS) : !ios) return false;
    const tour = await tourAtStart(userId);
    if (tour === 'starting' || tour === 'active') return false;
    if (await shouldOfferPackagePrompt()) {
      return !(tour === 'ask' && (await consultationApi.getState())?.completed === true);
    }
    if (ios) await prefsStorage.set(key, new Date(now).toISOString());
    return false;
  } catch {
    return false;
  }
}
