/**
 * TRAIN-TAB-2 (agent 160): the Train day (featureFlags.clientTrainV2) reads what GET /assignments/me already
 * returns on backend main: the coach's day note, what the coach changed (sets before, the reason) and a skipped day.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { addDays, getTodayString } from '../../../../utils/date';
import { TrainDay, featuredWorkout, trainWeek, type TrainWorkout } from '../TrainToday';

jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ReactLib.useEffect(() => cb(), []);
    },
  };
});
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: (on: boolean) => ({ data: on ? [{ coach_id: 'coach', name: 'Sam Rivera' }] : undefined }) }));
jest.mock('../../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => ({ names: { squat: 'Back squat', bench: 'Bench press' }, loading: false }) }));
jest.mock('../../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));

const today = getTodayString();
const at = (day: string) => `${day}T12:00:00`;
const row = (order: number, id: string, extra: Record<string, unknown> = {}) => ({
  exercise_external_id: id, order, sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, rest_seconds: 90, superset_group_id: null, notes: null, ...extra,
});
const reason = 'Fewer bench sets today so the squat gets your best effort.';
const workout = (extra: Record<string, unknown> = {}) => ({
  id: 'a1', workout_plan_id: 'p1', client_id: 'c1', assigned_by_coach_id: 'coach', scheduled_for: at(today), completed_at: null,
  post_rpe: null, post_notes: null, snapshot_source: true, snapshot: { plan_name: 'Full body A', plan_type: 'strength' },
  workout_plan: { id: 'p1', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55, exercises: [] },
  exercises: [row(1, 'squat', { notes: 'Squats hold at 185 this week.' }), row(2, 'bench', { sets: 3, weight_lbs: 155 })],
  ...extra,
}) as unknown as TrainWorkout;
const changed = { roman_adjusted_sets: [{ order: 2, sets: 3, sets_before: 4, client_reason: reason }] };

const day = (w: TrainWorkout, coachless = false) => render(
  <TrainDay workout={w} hasAny state="ready" coachless={coachless} coachId="coach" userId="c1" onStart={jest.fn()} onRetry={jest.fn()} today={today} />,
);

/** testIDs and text in screen order (top to bottom). */
function screenOrder(view: { toJSON: () => unknown }): string[] {
  const seen: string[] = [];
  const step = (node: unknown): void => {
    if (typeof node === 'string') { seen.push(node); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    if (typeof n.props?.testID === 'string') seen.push(n.props.testID);
    (n.children ?? []).forEach(step);
  };
  step(view.toJSON());
  return seen;
}

describe('TRAIN-TAB-2: the Train day shows coach changes, the day note and skipped days', () => {
  it("leads the note card with the coach's day note, signed, over the first row note", async () => {
    const view = await day(workout({ client_note: '  Pause at the bottom of every squat.  ' }));
    await waitFor(() => expect(view.getByText('Pause at the bottom of every squat.')).toBeTruthy());
    expect(view.queryByText('Squats hold at 185 this week.')).toBeNull();
    expect(view.getByTestId('train-coach-note-author').props.children).toBe('Sam');
  });

  it('keeps the first row note before a day note is written, and no coach voice for a coachless client', async () => {
    const view = await day(workout({ client_note: null }));
    expect(view.getByText('Squats hold at 185 this week.')).toBeTruthy();
    const coachless = await day(workout({ client_note: 'Pause at the bottom of every squat.' }), true);
    expect(coachless.queryByTestId('train-coach-note')).toBeNull();
  });

  it('marks what the coach changed today: the lead line, then "Changed by Sam · 3 sets, was 4" and the reason on that block', async () => {
    const view = await day(workout(changed));
    await waitFor(() => expect(view.getByText("Sam adjusted today's workout.")).toBeTruthy());
    expect(view.getByTestId('train-block-B-adjusted').props.children).toBe('Changed by Sam · 3 sets, was 4');
    expect(view.getByTestId('train-block-B-reason').props.children).toBe(reason);
    expect(view.getByText('3 × 5 · 155 lb')).toBeTruthy();
    expect(view.queryByTestId('train-block-A-adjusted')).toBeNull();
    const seen = screenOrder(view);
    const order = ['Full body A', 'train-start', 'train-adjusted-lead', 'train-coach-note', 'train-details', 'train-block-A', 'train-block-B-adjusted'].map((m) => seen.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('on another day keeps the block mark without the today line; unsigned for a former coach; one set reads "set"', async () => {
    const view = await day(workout({
      scheduled_for: at(addDays(today, 2)), assigned_by_coach_id: 'former',
      roman_adjusted_sets: [{ order: 1, sets: 1, sets_before: 2, client_reason: null }],
    }));
    await waitFor(() => expect(view.getByTestId('train-block-A-adjusted')).toBeTruthy());
    expect(view.getByTestId('train-block-A-adjusted').props.children).toBe('Changed by your coach · 1 set, was 2');
    expect(view.queryByTestId('train-adjusted-lead')).toBeNull();
    expect(view.queryByTestId('train-block-A-reason')).toBeNull();
  });

  it('a change saved without its sets before keeps the Detail screen mark', async () => {
    const view = await day(workout({ roman_adjusted_sets: [{ order: 2, sets: 3 }] }));
    await waitFor(() => expect(view.getByTestId('train-block-B-adjusted').props.children).toBe('Updated by your coach'));
    expect(view.getByText("Sam adjusted today's workout.")).toBeTruthy();
  });

  it('never offers a skipped day with Start: the next open workout leads, or none', () => {
    const open = (id: string, d: string, skipped_at: string | null = null) => ({ id, scheduled_for: at(d), completed_at: null, skipped_at });
    const later = open('later', addDays(today, 2));
    expect(featuredWorkout([open('skipped', today, at(today)), later], today)?.id).toBe('later');
    expect(featuredWorkout([open('old', addDays(today, -2), at(today))], today)).toBeNull();
  });

  it('a skipped day reads missed on the strip and ring and still counts in the week', () => {
    const week = trainWeek([
      { scheduled_for: at(today), completed_at: null, skipped_at: at(today) },
      { scheduled_for: at(today), completed_at: at(today), skipped_at: null },
      { scheduled_for: at(addDays(today, -7)), completed_at: null, skipped_at: null },
    ], today);
    const d = (new Date(Date.parse(today)).getUTCDay() + 6) % 7;
    expect(week.days[d]).toBe('missed');
    expect(week.segments.sort()).toEqual(['done', 'missed']);
    expect([week.done, week.total]).toEqual([1, 2]);
  });
});
