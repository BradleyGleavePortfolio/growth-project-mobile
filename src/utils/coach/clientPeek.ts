/**
 * UI-4 peek sheet (client-peek-sheet mockup): one line per slice from GET /coach/clients/:id/summary
 * and the latest check-in. A slice with nothing in it reads the existing "Nothing logged yet", never an
 * empty value. #SHARE-SIMPLE: every slice reaches the current coach, so no slice is "not shared".
 */
import type { MacroTarget } from '../../api/macrosApi';
import type { ClientProfile } from '../../types';
import { bucketDateLocal } from '../date';
import { dayWord } from './clientLookup';
import { rosterActivityLine, type RosterClient } from './clientRoster';
import { resolveCoachTargets } from './foodReview';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Row[]) : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NOTHING = 'Nothing logged yet';

/** A date-only value ("2026-10-05" or its midnight ISO) or a timestamp, as the local YYYY-MM-DD. */
function localDay(v: unknown, timestamp: boolean): string | null {
  const s = text(v);
  if (!s) return null;
  if (!timestamp && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : bucketDateLocal(d);
}

/** "on Wednesday" within the last week, else "on Sep 30" (the mockup's "Full body A on Wednesday"). */
function whenWords(day: string, today: Date): string {
  const [y, m, d] = day.split('-').map(Number);
  return /^(Today|Yesterday|[A-Z][a-z]{2})$/.test(dayWord(day, today)) ? `on ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}` : `on ${MONTHS[m - 1]} ${d}`;
}

/** "Active, joined Aug 14" (the mockup's plan type is on no coach route, so it is left out); archived reads "Archived". */
export function peekJoinedLine(c: RosterClient): string {
  const day = c.status === 'archived' ? null : localDay(c.createdAt, false);
  if (!day) return c.status === 'archived' ? 'Archived' : 'Active';
  const [, m, d] = day.split('-').map(Number);
  return `Active, joined ${MONTHS[m - 1]} ${d}`;
}

/** "Logged today. 2 check-ins waiting for you." Null when the client logged nothing (each slice says so). */
export function peekStatusLine(c: RosterClient, today: Date = new Date()): { text: string; ok: boolean } | null {
  const a = c.activity;
  const n = a?.checkInsToReview ?? 0;
  if (!a || (!a.lastActiveOn && n === 0)) return null; // the slices already say so
  const line = a.lastActiveOn ? rosterActivityLine(c, today) : { text: NOTHING, tone: 'quiet' as const };
  const waiting = n > 0 ? ` ${n} ${n === 1 ? 'check-in' : 'check-ins'} waiting for you.` : '';
  return { text: `${line.text}.${waiting}`, ok: line.tone === 'ok' };
}

export interface PeekSlices {
  checkIn: { text: string; hasOne: boolean };
  food: { text: string };
  workouts: { text: string };
  weighIn: { text: string };
}

/** Monday 00:00 of this week, local. */
function weekStart(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function peekSlices(
  _c: RosterClient,
  summary: unknown,
  checkIns: unknown,
  coachId: string | undefined,
  target: MacroTarget | null | undefined,
  today: Date = new Date(),
): PeekSlices {
  const s = obj(summary);

  const latest = rows(checkIns)[0];
  const checkDay = latest ? localDay(latest.date, false) : null;
  const energy = latest ? num(latest.energy) : null;
  const note = latest ? text(latest.notes)?.split('\n')[0] ?? null : null;
  const parts = [energy != null ? `energy ${energy} of 5` : null, note].filter(Boolean);
  const checkText = checkDay ? `${dayWord(checkDay, today)}${parts.length ? `: ${parts.join(', ')}` : ''}` : NOTHING;

  const day = obj(s.today);
  const targets = resolveCoachTargets(target ?? null, (s.profile as ClientProfile | null) ?? null);
  const kcal = num(day.total_calories) ?? 0;
  const of = targets?.calories != null ? ` of ${grouped(targets.calories)}` : '';
  // A no-break space keeps each number with its unit when the line wraps ("96 g", never "96" / "g").
  const foodText = rows(day.entries).length > 0 ? `${grouped(kcal)}${of}\u00a0kcal, protein ${grouped(num(day.total_protein_g) ?? 0)}\u00a0g` : NOTHING;

  const session = rows(s.recent_workouts)[0];
  const sessionDay = session ? localDay(session.completed_at ?? session.created_at, true) : null;
  const name = session ? text(session.workout_name) ?? text(session.name) ?? 'Workout' : null;
  const from = weekStart(today).getTime();
  const to = from + 7 * 86_400_000;
  const week = rows(s.recent_assignments).filter((a) => {
    const at = new Date(String(a.scheduled_for)).getTime();
    return a.assigned_by_coach_id === coachId && at >= from && at < to;
  });
  const done = week.filter((a) => a.completed_at != null).length;
  const count = week.length > 0 ? `, ${done} of ${week.length}` : '';
  const workoutText = name && sessionDay ? `${name} ${whenWords(sessionDay, today)}${count}` : NOTHING;

  const weight = rows(s.weight_logs)[0];
  const lbs = weight ? num(weight.weight_lbs) : null;
  const weightDay = weight ? localDay(weight.date, false) : null;
  // The check-in slice's "{day}: {value}" with today's "{weight} lb" (WeeklySummaryTab).
  const weighText = lbs != null && weightDay ? `${dayWord(weightDay, today)}: ${Math.round(lbs * 10) / 10}\u00a0lb` : NOTHING;

  return {
    checkIn: { text: checkText, hasOne: !!checkDay },
    food: { text: foodText },
    workouts: { text: workoutText },
    weighIn: { text: weighText },
  };
}
