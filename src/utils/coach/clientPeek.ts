/**
 * UI-4 peek sheet (client-peek-sheet mockup): one line per slice from GET /coach/clients/:id/summary
 * and the latest check-in. A slice the client does not share reads "Not shared by <first name>",
 * and a shared slice with nothing in it reads the existing "Nothing logged yet", never an empty value.
 */
import type { MacroTarget } from '../../api/macrosApi';
import type { ClientProfile } from '../../types';
import { bucketDateLocal } from '../date';
import { dayWord, firstName } from './clientLookup';
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

/** "today", "yesterday", "on Wednesday" (this week) or "on Sep 30" (the mockup's "Full body A on Wednesday"). */
function whenWords(day: string, today: Date): string {
  const word = dayWord(day, today);
  if (word === 'Today' || word === 'Yesterday') return word.toLowerCase();
  const [y, m, d] = day.split('-').map(Number);
  return /^[A-Z][a-z]{2}$/.test(word) ? `on ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}` : `on ${MONTHS[m - 1]} ${d}`;
}

export const notSharedBy = (c: RosterClient) => `Not shared by ${firstName(c)}`;

/** "Active, joined Aug 14" (the mockup's plan type is not on any coach route, so it is left out). */
export function peekJoinedLine(c: RosterClient): string {
  const state = c.status === 'archived' ? 'Archived' : 'Active';
  const day = localDay(c.createdAt, false);
  if (!day) return state;
  const [, m, d] = day.split('-').map(Number);
  return `${state}, joined ${MONTHS[m - 1]} ${d}`;
}

/** "Logged today. 2 check-ins waiting for you." Null when the client shares nothing (each slice says so). */
export function peekStatusLine(c: RosterClient, today: Date = new Date()): { text: string; ok: boolean } | null {
  const a = c.activity;
  if (!a?.shared) return null;
  const line = a.lastActiveOn ? rosterActivityLine(c, today) : { text: NOTHING, tone: 'quiet' as const };
  const n = a.checkInsToReview ?? 0;
  const waiting = n > 0 ? ` ${n} ${n === 1 ? 'check-in' : 'check-ins'} waiting for you.` : '';
  return { text: `${line.text}.${waiting}`, ok: line.tone === 'ok' };
}

export interface PeekSlices {
  checkIn: { text: string; shared: boolean; hasOne: boolean };
  food: { text: string; shared: boolean };
  workouts: { text: string; shared: boolean };
  weighIn: { text: string; shared: boolean };
}

/** Monday 00:00 of this week, local. */
function weekStart(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function peekSlices(
  c: RosterClient,
  summary: unknown,
  checkIns: unknown,
  coachId: string | undefined,
  target: MacroTarget | null | undefined,
  today: Date = new Date(),
): PeekSlices {
  const s = obj(summary);
  const consent = obj(s.consent);
  const off = notSharedBy(c);
  const shared = {
    checkIns: consent.habits_progress !== false,
    food: consent.food_macros !== false,
    workouts: consent.workouts !== false,
    weighIn: consent.body_metrics !== false,
  };

  const latest = rows(checkIns)[0];
  const checkDay = latest ? localDay(latest.date, false) : null;
  const energy = latest ? num(latest.energy) : null;
  const note = latest ? text(latest.notes)?.split('\n')[0] ?? null : null;
  const parts = [energy != null ? `energy ${energy} of 5` : null, note].filter(Boolean);
  const checkText = checkDay ? `${dayWord(checkDay, today)}: ${parts.length ? parts.join(', ') : 'checked in'}` : NOTHING;

  const day = obj(s.today);
  const targets = resolveCoachTargets(target ?? null, (s.profile as ClientProfile | null) ?? null);
  const kcal = num(day.total_calories) ?? 0;
  const of = targets?.calories != null ? ` of ${grouped(targets.calories)}` : '';
  const foodText = rows(day.entries).length > 0 ? `${grouped(kcal)}${of} kcal, protein ${grouped(num(day.total_protein_g) ?? 0)} g` : NOTHING;

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
  const weighText = lbs != null && weightDay ? `${Math.round(lbs * 10) / 10} lb ${whenWords(weightDay, today)}` : NOTHING;

  return {
    checkIn: { text: shared.checkIns ? checkText : off, shared: shared.checkIns, hasOne: shared.checkIns && !!checkDay },
    food: { text: shared.food ? foodText : off, shared: shared.food },
    workouts: { text: shared.workouts ? workoutText : off, shared: shared.workouts },
    weighIn: { text: shared.weighIn ? weighText : off, shared: shared.weighIn },
  };
}
