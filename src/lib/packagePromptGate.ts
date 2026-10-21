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
 *  - RENEWAL-M: never when the server says the coach revoked this client's
 *    access (`renewal.state` 'revoked'), on any path.
 *  - At start (packagePromptDueAtStart), never daily (owner #836-CAP: "a renewal
 *    dunning proccess"): an ended plan opens it only while the server's
 *    renewal block says `popup_due`; a client with no renewal (never bought, or
 *    an older server) gets it once (iPhone first Home, Android after a Day 1
 *    skip), see lib/planRenewal. The start read stays bounded (#836 Opus C3):
 *    once a day, at every start only while a renewal sequence still has a
 *    pop-up to come, and never within a day of the sheet opening (it saves that
 *    time the moment it opens, `recordShown`, #836 Sol B1). Never while Roman's
 *    tour is unfinished or about to start, also after a restart (tourAtStart,
 *    #836 Opus C4, Sol B2): the tour comes first, nothing is saved, and a later
 *    start offers the sheet.
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
import { clearRenewalShownOnce, readRenewal, renewalSheetDue, type Renewal } from './planRenewal';

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

type PlanRead = { kind: 'active' } | { kind: 'no' } | { kind: 'offer'; renewal: Renewal | undefined };
const NO: PlanRead = { kind: 'no' };

async function readPlan(): Promise<PlanRead> {
  if (!(await readUserCache())?.coach_id) return NO;
  const res = await clientPaymentsApi.getEntitlement();
  if (!res || !res.ok) return NO;
  const data = res.data as { active?: unknown; entitlement_active?: unknown } | null | undefined;
  if (!data || typeof data !== 'object') return NO;
  if (data.entitlement_active === true || data.active === true) return { kind: 'active' };
  if (data.active !== false) return NO;
  const renewal = readRenewal(data);
  if (renewal?.state === 'revoked') return NO;
  return (await dunningApi.getStatus()).state === 'none' ? { kind: 'offer', renewal } : NO;
}

export async function shouldOfferPackagePrompt(): Promise<boolean> {
  try {
    return (await readPlan()).kind === 'offer';
  } catch {
    return false;
  }
}

/** What the start check offered, for PackageSelectionSheet `onShown` (lib/planRenewal recordRenewalShown). */
let startOffer: { userId: string; renewal: Renewal | undefined } | null = null;
export function takeStartOffer(userId: string): { renewal: Renewal | undefined } | null {
  const o = startOffer?.userId === userId ? startOffer : null;
  startOffer = null;
  return o;
}

/** R15: the keys are per user, so another account on this phone never inherits them. */
export async function packagePromptDueAtStart(userId: string, now: number = Date.now()): Promise<boolean> {
  try {
    const shownAt = await prefsStorage.getStringAsync(`onboarding.package_prompt_dismissed_at:${userId}`);
    const lookKey = `onboarding.package_prompt_looked_at:${userId}`;
    const within = (at: string | undefined) => !!at && !(now - new Date(at).getTime() > DAY_MS);
    if (within(shownAt) || within(await prefsStorage.getStringAsync(lookKey))) return false;
    const tour = await tourAtStart(userId);
    if (tour === 'starting' || tour === 'active') return false;
    const plan = await readPlan();
    if (plan.kind === 'offer' && (await renewalSheetDue(userId, plan.renewal, Platform.OS === 'ios' || !!shownAt))) {
      if (tour === 'ask' && (await consultationApi.getState())?.completed === true) return false;
      startOffer = { userId, renewal: plan.renewal };
      return true;
    }
    if (plan.kind === 'active') await clearRenewalShownOnce(userId);
    const running = plan.kind === 'offer' && plan.renewal?.state === 'ended' && plan.renewal.running;
    if (!running) await prefsStorage.set(lookKey, new Date(now).toISOString());
    return false;
  } catch {
    return false;
  }
}

/** RENEWAL-M: a plan_renewal push was tapped. Open the sheet while the server still has this plan ended. */
export async function renewalTapDue(userId: string): Promise<boolean> {
  try {
    const plan = await readPlan();
    if (plan.kind !== 'offer' || plan.renewal?.state !== 'ended') return false;
    startOffer = { userId, renewal: plan.renewal };
    return true;
  } catch {
    return false;
  }
}
