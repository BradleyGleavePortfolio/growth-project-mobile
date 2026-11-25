/**
 * REFINE-987R3 (owner #203-E80): what Your workouts and Your weeks share. One week rule, the Train tab's: Monday first,
 * the phone's own today, a workout's day by assignmentDay (TrainToday.tsx trainWeek over thisWeek.ts workoutWeek).
 * - WINDOW-1: Your workouts lists this week's Monday to the Sunday two weeks after (21 days), and every workout whose
 *   day cannot be read; with a week (a real Monday) as its route parameter, that one week.
 * - Your weeks: this week's sessions in day order; every other week holding a session, later ones soonest first and
 *   earlier ones newest first.
 * - main's loading, failed and no-workout words, drawn by both pages.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { layout, spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { assignmentDay, dayStart } from '../../../utils/workout/workoutDay';
import { DAY_NAMES, workoutWeek, type WorkoutWeek } from '../../coach/client-detail/thisWeek';
import { trainWeek, type TrainWorkout } from '../train/TrainToday';

type Assignment = ClientWorkoutAssignmentWithPlan;
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const plusDays = (day: string, n: number) => new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
/** A YYYY-MM-DD that is a real calendar day (2026-02-30 is not). */
const realDay = (day: string) => DATE.test(day) && !Number.isNaN(Date.parse(day)) && plusDays(day, 0) === day;

/** A workout's day (YYYY-MM-DD), or '' when it cannot be read. */
export function dayOf(a: Assignment): string {
  const day = assignmentDay(a);
  return realDay(day) ? day : '';
}

/** Monday (YYYY-MM-DD) of a readable day, by the Train tab's own week rule. */
export const mondayOf = (day: string) => trainWeek([], day).week;

/** The route's week: a real Monday, else null (the page shows the default window). */
export function weekParam(value: unknown): string | null {
  return typeof value === 'string' && realDay(value) && mondayOf(value) === value ? value : null;
}

/** The workouts a list shows: one week's when `week` is set, else the window's and every one whose day cannot be read. */
export function listRows<T extends Assignment>(rows: ReadonlyArray<T>, today: string, week: string | null): T[] {
  const from = week ?? mondayOf(today);
  const to = plusDays(from, week ? 6 : 20);
  return rows.filter((a) => {
    const day = dayOf(a);
    return day ? day >= from && day <= to && (!!week || mondayOf(day) !== mondayOf(today)) : !week;
  });
}

export interface WeekRow { monday: string; week: WorkoutWeek }

/**
 * Your weeks: this week's sessions in day order with their week (trainWeek: segment i is row i), the later weeks
 * holding a session soonest first and the earlier ones newest first (workoutWeek with the real today, so an open
 * session in a past week reads missed). `rows` arrive in day order.
 */
export function weeksOf(rows: ReadonlyArray<Assignment>, today: string) {
  const thisMonday = mondayOf(today);
  const thisWeek: Assignment[] = [];
  const other = new Map<string, Assignment[]>();
  for (const a of rows) {
    const day = dayOf(a);
    if (!day) continue; // a day that cannot be read is on the list only
    const monday = mondayOf(day);
    if (monday === thisMonday) thisWeek.push(a);
    else other.set(monday, [...(other.get(monday) ?? []), a]);
  }
  const row = (monday: string): WeekRow => ({
    monday,
    week: workoutWeek({
      week_start: monday,
      today,
      assignments: (other.get(monday) ?? []).map((a) => ({
        day: dayOf(a),
        completed_at: a.completed_at,
        skipped_at: (a as TrainWorkout).skipped_at,
      })),
    }),
  });
  const mondays = Array.from(other.keys()).sort();
  return {
    rows: thisWeek,
    week: trainWeek(thisWeek, today),
    later: mondays.filter((m) => m > thisMonday).map(row),
    earlier: mondays.filter((m) => m < thisMonday).reverse().map(row),
  };
}

/** "Mon 12" (C2_history rows 413-433). */
export function sessionDay(a: Assignment): string {
  const d = dayStart(dayOf(a));
  return d ? `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}` : '';
}

/** "Oct 12 to 18", "Sep 28 to Oct 4" (C2_history rows 930-953). */
export function weekSpan(monday: string): string {
  const from = dayStart(monday);
  if (!from) return '';
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${md(from)} to ${to.getMonth() === from.getMonth() ? to.getDate() : md(to)}`;
}

/** Main's loading, failed and no-workout states (ClientWorkoutViewerScreen's words and look), one copy for both pages. */
export function ListState({ state, sc }: { state: 'loading' | 'failed' | 'empty'; sc: SemanticTokens }) {
  if (state === 'empty') {
    return (
      <View style={styles.empty}>
        <Text style={[typography.h1, { color: sc.textPrimary }]}>
          No workouts assigned
        </Text>
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Assigned workouts appear here when available.
        </Text>
      </View>
    );
  }
  return (
    <Text style={[typography.body, styles.state, { color: sc.textMuted }]}>
      {state === 'loading' ? 'Loading...' : 'Could not load your workouts. Pull to retry.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  // C2_first: the serif title over its line, 18 pt under the page title; no rule.
  empty: { marginTop: layout.sectionPadY, gap: spacing.sm },
  state: { marginTop: layout.sectionPadY },
});
