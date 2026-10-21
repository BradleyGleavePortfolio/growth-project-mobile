/**
 * RENEWAL-M: the phone half of the plan renewal sequence (owner 10-21, answer to #836-CAP: "it should be a renewal
 * dunning proccess, in app pop-up, coach messages, app notifs"). The server decides every step (backend #1127,
 * switch FEATURE_PLAN_RENEWAL): GET /v1/checkout/entitlement carries a `renewal` block, and the phone shows the plan
 * sheet only while it says `popup_due`, then acknowledges that pop-up (POST /v1/checkout/renewal/popup-ack).
 *  - `revoked`: the coach ended this client's access; the coach's packages are never offered.
 *  - `none`, or no `renewal` key (an older server, or the switch off; the contract reads it as `none`): the sheet
 *    shows at most once (#836's first offer: iPhone first Home, Android after a Day 1 skip), never daily. The mark
 *    clears when the phone next sees an active plan, so a plan that ends later gets its one showing.
 *  - A pop-up this phone already showed is not shown again while its ack is still on the way (retried each start).
 *  - A plan_renewal push tap opens the sheet over Home while the plan is still ended (pushTapRouter PlanRenewal,
 *    RootNavigator, packagePromptGate renewalTapDue).
 */
import api from '../services/api';
import { prefsStorage } from '../storage/mmkv';

export type PopupStep = 0 | 3 | 7;
export type Renewal =
  | { state: 'none' | 'revoked' }
  | { state: 'ended'; endedAt: string | null; popupStep: PopupStep | null; running: boolean };

/** The `renewal` block. undefined = no key (older server, switch off); a block the phone cannot read = 'none'. */
export function readRenewal(data: unknown): Renewal | undefined {
  if (!data || typeof data !== 'object' || !('renewal' in data)) return undefined;
  const r = (data as { renewal?: unknown }).renewal as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || (r.state !== 'ended' && r.state !== 'revoked')) return { state: 'none' };
  if (r.state === 'revoked') return { state: 'revoked' };
  const step = r.popup_due === true && [0, 3, 7].includes(r.popup_step as number) ? (r.popup_step as PopupStep) : null;
  // running: a later pop-up can still come (the Day 7 step not reached, or its pop-up still due).
  return { state: 'ended', endedAt: typeof r.ended_at === 'string' ? r.ended_at : null, popupStep: step, running: r.step !== 7 || step !== null };
}

const seenKey = (userId: string) => `plan_renewal.seen:${userId}`;
const onceKey = (userId: string) => `plan_renewal.shown_once:${userId}`;
const seenMark = (endedAt: string | null, step: PopupStep) => `${endedAt ?? ''}|${step}`;
const ack = (step: PopupStep) => api.post('/v1/checkout/renewal/popup-ack', { step }).then(() => undefined, () => undefined);

/**
 * Whether the plan sheet is due at this start for a coached client with no active plan and no failing payment.
 * `legacyAllowed`: the older rule may offer it (iPhone first Home, Android after a skip).
 */
export async function renewalSheetDue(userId: string, renewal: Renewal | undefined, legacyAllowed: boolean): Promise<boolean> {
  if (!renewal || renewal.state === 'none') return legacyAllowed && !(await prefsStorage.getStringAsync(onceKey(userId)));
  if (renewal.state !== 'ended' || renewal.popupStep === null) return false;
  if ((await prefsStorage.getStringAsync(seenKey(userId))) !== seenMark(renewal.endedAt, renewal.popupStep)) return true;
  await ack(renewal.popupStep); // shown before, ack still on the way
  return false;
}

/** The sheet opened: save that it was seen, then acknowledge a due pop-up. Never throws. */
export async function recordRenewalShown(userId: string, renewal: Renewal | undefined): Promise<void> {
  try {
    if (!renewal || renewal.state === 'none') await prefsStorage.set(onceKey(userId), new Date().toISOString());
    else if (renewal.state === 'ended' && renewal.popupStep !== null) {
      await prefsStorage.set(seenKey(userId), seenMark(renewal.endedAt, renewal.popupStep));
      await ack(renewal.popupStep);
    }
  } catch {
    // best-effort: the server keeps popup_due until the ack lands
  }
}

/** The phone saw an active plan: a plan that ends later gets its one showing (the `none` / older server rule). */
export async function clearRenewalShownOnce(userId: string): Promise<void> {
  await prefsStorage.delete(onceKey(userId)).catch(() => undefined);
}
