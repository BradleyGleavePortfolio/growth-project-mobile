// COACH-HOME-134: plain-words copy for the coach Home (coach-home-solo). Pure; only real values become numbers.
import type { LtvMetrics } from '../../../components/command-center/CoachLtvDashboard';
import type { MoneyPayout } from '../../../api/coachMoneyApi';
import { currencyMinorUnits, formatCurrencyCents } from '../../../utils/currency';
import { getGreeting } from '../../../utils/date';

const WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
const DAY = 86_400_000;
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', o).format(d);
const word = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 20 ? WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayStart = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
const daysBetween = (a: number, b: number) => Math.round((dayStart(b) - dayStart(a)) / DAY);

/** "Three need you; nine are steady." from the roster and its at-risk count. */
export function clientsNarrative(roster: number, atRisk: number): string {
  const need = Math.min(Math.max(atRisk, 0), roster);
  const steady = roster - need;
  if (need === 0) return roster === 1 ? 'Your one client is steady.' : roster === 2 ? 'Both are steady.' : `All ${word(roster)} are steady.`;
  const needs = `${cap(word(need))} ${need === 1 ? 'needs' : 'need'} you`;
  return steady === 0 ? `${needs} today.` : `${needs}; ${word(steady)} ${steady === 1 ? 'is' : 'are'} steady.`;
}

/** Whole units at hero size ("$14,280"); exact below 100 so a small sum never rounds away. */
export function heroAmount(cents: number, currency: string): string {
  const { exponent } = currencyMinorUnits(currency);
  if (exponent === 0 || Math.abs(cents) < 100 * 10 ** exponent) return formatCurrencyCents(cents, currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0, maximumFractionDigits: 0 })
      .format(Math.round(cents / 10 ** exponent));
  } catch {
    return formatCurrencyCents(cents, currency);
  }
}

export function monthWindow(now: Date) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const compareFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const compareTo = new Date(Math.min(compareFrom.getTime() + Math.max(now.getTime() - from.getTime(), 1), from.getTime()));
  return { from, to: new Date(now.getTime()), compareFrom, compareTo };
}

export const monthOverline = (now: Date) => `${fmt(now, { month: 'long' })} so far`;
export const dateOverline = (now: Date) => fmt(now, { weekday: 'long', month: 'long', day: 'numeric' });
export const greetingOverline = (name?: string | null) => [getGreeting(), name?.trim().split(/\s+/)[0]].filter(Boolean).join(', ');

// Caps advance widths (1/1000 em) from Inter_500Medium.ttf (hmtx), for the 11 pt overline tracked 1.98 pt.
const CAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CAPS_EM = [709, 657, 733, 722, 603, 589, 748, 745, 272, 575, 688, 565, 913, 756, 767, 642, 769, 648, 646, 653, 740, 709, 1003, 701, 696, 641, 646, 415, 616, 627, 656, 603, 630, 571, 629, 630];
export const overlineWidth = (s: string, scale = 1) =>
  [...s.toUpperCase()].reduce((w, c) => w + (11 * (CAPS_EM[CAPS.indexOf(c)] ?? 300)) / 1000 + 1.98, 0) * scale;

/** Date and greeting on one line (SHOTS-134B f): the long date if both fit, else the short date, else the greeting alone. */
export function overlinePair(now: Date, name: string | null | undefined, room: number, scale = 1): [string, string] {
  const short = fmt(now, { weekday: 'short', month: 'short', day: 'numeric' });
  const fits = (a: string, b: string) => overlineWidth(a, scale) + overlineWidth(b, scale) + 12 <= room;
  if (fits(dateOverline(now), greetingOverline(name))) return [dateOverline(now), greetingOverline(name)];
  return [short, fits(short, greetingOverline(name)) ? greetingOverline(name) : greetingOverline(null)];
}

/** "Up $620 on the same days in September"; null when there is nothing to compare. */
export function changeVsLastMonth(changeCents: number | null, currency: string, now: Date): string | null {
  if (changeCents === null) return null;
  const last = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1), { month: 'long' });
  if (changeCents === 0) return `Level with the same days in ${last}`;
  return `${changeCents > 0 ? 'Up' : 'Down'} ${heroAmount(Math.abs(changeCents), currency)} on the same days in ${last}`;
}

/** "10 days in, on pace for $18,400" (the pace from day 7, when it means something). */
export function paceLine(netCents: number, currency: string, now: Date): string {
  const day = now.getDate();
  const daysIn = `${day} ${day === 1 ? 'day' : 'days'} in`;
  if (day < 7 || netCents <= 0) return daysIn;
  const length = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${daysIn}, on pace for ${heroAmount(Math.round((netCents / day) * length), currency)}`;
}

/** 100 - monthly churn, only with a real base. */
export function retentionPct(ltv: LtvMetrics | null): string | null {
  if (!ltv || ltv.active_client_count <= 0 || (ltv.churn_rate_pct <= 0 && ltv.mrr_30d_ago_cents <= 0)) return null;
  return `${Math.max(0, Math.round(100 - ltv.churn_rate_pct))}%`;
}

/** "lands Friday" within the week, "lands Oct 20" later (Stripe's own date). */
export function payoutWords(p: MoneyPayout, now: Date): string {
  const t = p.arrivalDate ? Date.parse(p.arrivalDate) : NaN;
  if (!Number.isFinite(t)) return 'on its way';
  const days = daysBetween(now.getTime(), t);
  if (days <= 1) return days <= 0 ? 'lands today' : 'lands tomorrow';
  return `lands ${fmt(new Date(t), days < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' })}`;
}

/** "Active yesterday" from last_active_at; null when the server has none. */
export function lastActiveWords(iso: string | null, now: Date): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const days = daysBetween(t, now.getTime());
  return days <= 0 ? 'Active today' : days === 1 ? 'Active yesterday' : `Active ${days} days ago`;
}
