/**
 * RENEWAL-M (RENEWAL3; backend #1127 CONTRACT 6328688356, switch FEATURE_PLAN_RENEWAL): the entitlement's `renewal`
 * block, kept by EntitlementProvider. `ended`: Home's pop-up while `popup_due` (Day 0, 1, 7, then POST popup-ack)
 * and the "Renew now" banner while `banner_due` (components/renewal). `revoked`: nothing is offered. `none`, or no
 * key (older server, switch off): #836's first-offer sheet at most once.
 */
import api from '../services/api';
import { prefsStorage } from '../storage/mmkv';
import { purchasableFromCoachPackage, type PurchasablePackage } from './planTerms';

export type PopupStep = 0 | 1 | 7;
/** `fullName` only on the house coach (backend #1142 CONTRACT); the client's own coach is named by first name only. */
export type RenewalCoach = { id: string; firstName: string; fullName?: string };
export type Renewal =
  | { state: 'none' | 'revoked' }
  | { state: 'ended'; endedAt: string; popupStep: PopupStep | null; bannerDue: boolean; coach: RenewalCoach | null; houseCoach: RenewalCoach | null };

const coachOf = (c: unknown): RenewalCoach | null => {
  const o = c as { id?: unknown; first_name?: unknown } | null;
  return o && typeof o.id === 'string' && typeof o.first_name === 'string' && o.first_name ? { id: o.id, firstName: o.first_name } : null;
};
const houseOf = (c: unknown): RenewalCoach | null => {
  const [o, full] = [coachOf(c), (c as { full_name?: unknown } | null)?.full_name];
  return o && typeof full === 'string' && full.trim() ? { ...o, fullName: full.trim() } : o;
};
/** The house pages name him in full, "Bradley Gleave" (owner W-168-HC); a server without full_name falls back to the first name. */
export const houseCoachName = (c: RenewalCoach): string => c.fullName ?? c.firstName;

/** The `renewal` block. undefined = no key (older server, switch off); a block the phone cannot read = 'none'. */
export function readRenewal(data: unknown): Renewal | undefined {
  if (!data || typeof data !== 'object' || !('renewal' in data)) return undefined;
  const r = (data as { renewal?: unknown }).renewal as Record<string, unknown> | null;
  if (r?.state === 'revoked') return { state: 'revoked' };
  if (r?.state !== 'ended' || typeof r.ended_at !== 'string') return { state: 'none' };
  const step = r.popup_due === true && [0, 1, 7].includes(r.popup_step as number) ? (r.popup_step as PopupStep) : null;
  return { state: 'ended', endedAt: r.ended_at, popupStep: step, bannerDue: r.banner_due === true, coach: coachOf(r.coach), houseCoach: houseOf(r.house_coach) };
}

const onceKey = (userId: string) => `plan_renewal.shown_once:${userId}`;
const seenKey = (userId: string) => `plan_renewal.seen:${userId}`;

/** #836's first-offer sheet already opened once for this user on this phone. */
export const shownOnce = async (userId: string) => !!(await prefsStorage.getStringAsync(onceKey(userId)));
export const markShownOnce = (userId: string) => prefsStorage.set(onceKey(userId), new Date().toISOString()).catch(() => undefined);

/**
 * Whether Home opens this day's pop-up: due on the server and not yet shown on this phone (a tap on the
 * notification opens it again). Opening saves that; the ack is sent on every read while the server still has it due.
 */
export async function takeRenewalPopup(userId: string, r: Extract<Renewal, { state: 'ended' }>, tapped: boolean): Promise<boolean> {
  if (r.popupStep === null) return false;
  const mark = `${r.endedAt}|${r.popupStep}`;
  const seen = !tapped && (await prefsStorage.getStringAsync(seenKey(userId))) === mark;
  if (!seen) await prefsStorage.set(seenKey(userId), mark).catch(() => undefined);
  void api.post('/v1/checkout/renewal/popup-ack', { step: r.popupStep }).catch(() => undefined); // retried while due
  return !seen;
}

/** HOUSE-JOIN-BE: the client package list for the house coach while his door is open for this client (else 404). */
export const houseCoachPackagesPath = (coachId: string) => `/v1/clients/me/coach/packages?coach_id=${encodeURIComponent(coachId)}`;

/**
 * A house package as sold, plus the server's own description and, for a one-time plan, its weeks of access (backend
 * computeAccessExpiry: purchase + duration_periods weeks; a renewing plan runs until canceled, so it has none).
 */
export type HousePackage = PurchasablePackage & { description: string | null; weeks: number | null };

/**
 * `{ packages }` or a bare array; rows that cannot be sold honestly are dropped, and so is any free-trial row: the house
 * offers no free trials in v1 (owner #166-6; the server leaves them out too, HOUSE-SERVER).
 */
export function readHousePackages(data: unknown): HousePackage[] {
  const d = data as { packages?: unknown } | null;
  const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(d?.packages) ? d.packages : [];
  return raw.flatMap((row) => {
    const sold = purchasableFromCoachPackage(row);
    const p = sold && sold.trialDays === 0 ? sold : null;
    const { description: text, duration_periods: n } = (row ?? {}) as { description?: unknown; duration_periods?: unknown };
    const weeks = p && !p.renewing && typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
    return p ? [{ ...p, description: typeof text === 'string' && text.trim() ? text.trim() : null, weeks }] : [];
  });
}
