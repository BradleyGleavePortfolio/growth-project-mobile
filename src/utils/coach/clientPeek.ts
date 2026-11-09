/**
 * UI-4 peek sheet, drawn as K1 Style C (C_peek): one line per row from GET /coach/clients/:id/summary, the
 * roster's check-ins to review, the latest check-in and (Workouts) the client file's week. A row with nothing
 * in it reads the existing "Nothing logged yet" (Workouts: "Nothing planned this week"), never an empty value.
 * #SHARE-SIMPLE: every row reaches the current coach, so no row is "not shared".
 */
import type { MacroTarget } from '../../api/macrosApi';
import type { ClientProfile } from '../../types';
import { bucketDateLocal } from '../date';
import { weekHeadline, workoutsLine, type WorkoutWeek } from '../../screens/coach/client-detail/thisWeek';
import { dayWord } from './clientLookup';
import { rosterReviewBadge, type RosterClient } from './clientRoster';
import { resolveCoachTargets } from './foodReview';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Row[]) : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOTHING = 'Nothing logged yet';

/** A date-only value ("2026-10-05" or its midnight ISO) or a timestamp, as the local YYYY-MM-DD. */
function localDay(v: unknown, timestamp: boolean): string | null {
  const s = text(v);
  if (!s) return null;
  if (!timestamp && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : bucketDateLocal(d);
}

/** "Active, joined Aug 14" (the mockup's plan type is on no coach route, so it is left out); archived reads "Archived". */
export function peekJoinedLine(c: RosterClient): string {
  const day = c.status === 'archived' ? null : localDay(c.createdAt, false);
  if (!day) return c.status === 'archived' ? 'Archived' : 'Active';
  const [, m, d] = day.split('-').map(Number);
  return `Active, joined ${MONTHS[m - 1]} ${d}`;
}

export interface PeekSlices {
  /**
   * `text`: the app's own words, never cut. `note`: the client's own free-text note, every line of it (LF or CRLF)
   * joined by a space, or null; the sheet may cut only this to one line, and speaks all of it (FIX-933).
   */
  checkIn: { text: string; hasOne: boolean; note: string | null };
  food: { text: string };
  /** `week`: the ring's sessions, only when this week has one. */
  workouts: { text: string; week: WorkoutWeek | null };
  weighIn: { text: string };
}

export function peekSlices(
  c: RosterClient,
  summary: unknown,
  checkIns: unknown,
  week: WorkoutWeek,
  target: MacroTarget | null | undefined,
  today: Date = new Date(),
): PeekSlices {
  const s = obj(summary);

  const latest = rows(checkIns)[0];
  const checkDay = latest ? localDay(latest.date, false) : null;
  const energy = latest ? num(latest.energy) : null;
  // FIX-933 (LS-933 B2): the whole note, every line, so the sheet can speak all of it; it is never split to line one.
  const lines = text(latest?.notes)?.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean) ?? [];
  const note = lines.length ? lines.join(' ') : null;
  // C_peek: K1-S-19 "{n} to review" (the roster's count, as on the list row); with none waiting, main's latest check-in,
  // its app words ("{day}: energy {e} of 5") apart from the client's note (LS-933 B1, LO-933 B1).
  const badge = rosterReviewBadge(c);
  const checkText = badge ?? (checkDay ? `${dayWord(checkDay, today)}${energy != null ? `: energy ${energy} of 5` : ''}` : NOTHING);

  const day = obj(s.today);
  const targets = resolveCoachTargets(target ?? null, (s.profile as ClientProfile | null) ?? null);
  const kcal = num(day.total_calories) ?? 0;
  const of = targets?.calories != null ? ` of ${grouped(targets.calories)}` : '';
  // C_peek draws kcal alone on one line (its "so far today" is not an approved word, so main's "{n} of {m} kcal" stays).
  const foodText = rows(day.entries).length > 0 ? `${grouped(kcal)}${of}\u00a0kcal` : NOTHING;

  // CLIENT-FILE-DAYS-M: the week the client file's ring reads (GET /coach/clients/:id/week, the client's own
  // Monday-to-Sunday in their zone), in the file's words: K1-S-39 "Missed {day}", else K1-S-38 "{n} of {m} done".
  const workoutText = week.total > 0 ? weekHeadline(week) : workoutsLine(week);

  const weight = rows(s.weight_logs)[0];
  const lbs = weight ? num(weight.weight_lbs) : null;
  const weightDay = weight ? localDay(weight.date, false) : null;
  // The check-in slice's "{day}: {value}" with today's "{weight} lb" (WeeklySummaryTab).
  const weighText = lbs != null && weightDay ? `${dayWord(weightDay, today)}: ${Math.round(lbs * 10) / 10}\u00a0lb` : NOTHING;

  return {
    checkIn: { text: checkText, hasOne: !!checkDay || (c.activity?.checkInsToReview ?? 0) > 0, note: !badge && checkDay ? note : null },
    food: { text: foodText },
    workouts: { text: workoutText, week: week.total > 0 ? week : null },
    weighIn: { text: weighText },
  };
}
