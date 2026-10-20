/**
 * Roman's pace line for the S3 credit moments (CREDIT-S / CREDIT-SW), from
 * the pool the app already reads (no backend change). The CREDITSTYLE pace
 * rule did not survive, so this is rebuilt from the approved shots and
 * listed for the owner (U5): the pace is what was used so far this period
 * per day (at least one day), the credits run out after remaining / pace
 * days, and the suggested pack is the smallest offered pack that covers the
 * pace until renewal. Pure; dates are UTC days, like "Renews Nov 1.".
 */
import { formatCents, type CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';
import { renewalDay } from '../../../screens/coach/settings/AICreditsRow';

const DAY_MS = 86_400_000;

export type PaceBudget = Pick<
  CoachAIBudgetResponse,
  'period_start' | 'period_end' | 'used_displayed_cents' | 'remaining_displayed_cents' | 'pack_options_cents'
>;

export interface Pace {
  /** True when, at this pace, the pool lasts until it renews. */
  lastsToRenewal: boolean;
  /** UTC day the pool runs out at this pace ("Oct 27"); null when it lasts or is already empty. */
  runOutDay: string | null;
  /** Smallest pack that covers the pace until renewal; null when none is needed or none is enough. */
  suggestedCents: number | null;
}

/** Null when there is no pace to speak of (nothing used yet, or the period is unreadable or over). */
export function paceOf(b: PaceBudget, now: Date = new Date()): Pace | null {
  const start = Date.parse(b.period_start);
  const end = Date.parse(b.period_end);
  const t = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || t < start || t >= end) return null;
  if (!(b.used_displayed_cents > 0)) return null;
  const perDay = b.used_displayed_cents / Math.max(1, (t - start) / DAY_MS);
  const remaining = Math.max(0, b.remaining_displayed_cents);
  const runOut = t + (remaining / perDay) * DAY_MS;
  const lastsToRenewal = runOut >= end;
  const need = perDay * ((end - t) / DAY_MS) - remaining;
  const packs = [...b.pack_options_cents].sort((x, y) => x - y);
  const suggestedCents = need > 0 ? (packs.find((p) => p >= need) ?? null) : null;
  return {
    lastsToRenewal,
    runOutDay: lastsToRenewal || remaining === 0 ? null : utcDay(runOut),
    suggestedCents,
  };
}

function utcDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export type Moment = 'low' | 'usedUp';

/**
 * Roman's line for a moment, in the approved words, or null when no approved
 * sentence is true (then Roman says nothing). Packs are mentioned only on
 * builds that sell them.
 */
export function paceLine(moment: Moment, b: PaceBudget, packsSold: boolean, now: Date = new Date()): string | null {
  const pace = paceOf(b, now);
  const renews = renewalDay(b.period_end);
  if (!pace || !renews) return null;
  if (moment === 'usedUp') {
    // S3-R4; builds that sell no packs have no Roman line on this sheet.
    if (!packsSold || pace.suggestedCents === null) return null;
    return `At your usual pace, a ${formatCents(pace.suggestedCents)} pack should cover you until ${renews}.`;
  }
  // S3-R1 when the pool lasts; S3-R3 (sold, a pack covers it) or S3-R2 otherwise.
  if (pace.lastsToRenewal) return `At your pace this month, your credits should last until they renew on ${renews}.`;
  if (!pace.runOutDay) return null;
  const runOut = `At your pace this month, your credits will last until about ${pace.runOutDay}.`;
  if (packsSold && pace.suggestedCents !== null) {
    return `${runOut} A ${formatCents(pace.suggestedCents)} pack should cover you until ${renews}.`;
  }
  return runOut;
}

/** The pack the sheet preselects: the suggestion, else the largest when none is enough, else the smallest. */
export function preselectedPack(b: PaceBudget, now: Date = new Date()): number | null {
  const packs = [...b.pack_options_cents].sort((x, y) => x - y);
  if (!packs.length) return null;
  const pace = paceOf(b, now);
  if (pace?.suggestedCents != null) return pace.suggestedCents;
  if (pace && !pace.lastsToRenewal) return packs[packs.length - 1];
  return packs[0];
}
