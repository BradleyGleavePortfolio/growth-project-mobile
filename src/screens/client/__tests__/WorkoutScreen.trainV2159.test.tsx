/**
 * C1-TRAIN-TAB (agent 159): the Style C v2 top of the Train tab behind featureFlags.clientTrainV2.
 *   - The week masthead (ring and day strip), the coach's first note on sage, today's workout with Start
 *     workout under its name (#TRAIN-START-TOP) as the one forest action, and lettered blocks.
 *   - Start opens the live workout with the assignment (no dead button); it waits for the exercise names.
 *   - Coachless: "Your plan", no coach voice, Quick workout stays; loading and failed states are true.
 *   - The flag is off by default, and off the tab is today's (WorkoutScreen.calm130 and coachless135).
 */
import React from 'react';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { addDays, getTodayString } from '../../../utils/date';
import { blocksOf, featuredWorkout, trainWeek } from '../train/TrainToday';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { clientTrainV2: true, romanChat: false, clientTutorial: false } }));

let mockUser: { id: string; email: string; role: string; coach_id?: string } = { id: 'c1', email: 'c1@example.test', role: 'client' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn(), getParent: () => ({ navigate: mockNavigate }) };
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: async () => ({ data: [] }),
    getAll: async () => ({ data: [] }),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));
const mockRefetch = jest.fn(async () => ({}));
let mockQuery: { data?: unknown[]; isLoading?: boolean; isError?: boolean } = {};
jest.mock('../../../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ ...mockQuery, refetch: mockRefetch }) }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: (on: boolean) => ({ data: on ? [{ coach_id: 'coach', name: 'Sam Rivera' }] : undefined }) }));
let mockNames: { names: Record<string, string>; loading: boolean } = { names: {}, loading: false };
jest.mock('../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => mockNames }));
const mockLoadSession = jest.fn();
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a) }));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);

import WorkoutScreen from '../WorkoutScreen';

const today = getTodayString();
const at = (day: string) => `${day}T12:00:00`;
const row = (order: number, id: string, extra: Record<string, unknown> = {}) => ({
  exercise_external_id: id, order, sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, rest_seconds: 90, superset_group_id: null, notes: null, ...extra,
});
const fullBody = {
  id: 'a1', workout_plan_id: 'p1', client_id: 'c1', assigned_by_coach_id: 'coach', scheduled_for: at(today), completed_at: null,
  post_rpe: null, post_notes: null, snapshot_source: true, snapshot: { plan_name: 'Full body A', plan_type: 'strength' },
  workout_plan: { id: 'p1', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55, exercises: [] },
  exercises: [
    row(1, 'squat', { notes: 'Squats hold at 185 this week.' }),
    row(2, 'pullup', { sets: 3, reps_or_duration_seconds: 8, weight_lbs: null, superset_group_id: 'g1', notes: 'Slow on the way down.' }),
    row(3, 'pushup', { sets: 3, reps_or_duration_seconds: 12, weight_lbs: null, superset_group_id: 'g1' }),
  ],
};
// Done earlier today, so the week holds both on any weekday.
const doneEarlier = { ...fullBody, id: 'a0', completed_at: at(today) };
const dateNum = (day: string) => Number(day.slice(8));

function forestButtons(view: { toJSON: () => unknown }): string[] {
  const found: string[] = [];
  const step = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    const style = StyleSheet.flatten(n.props?.style as StyleProp<ViewStyle>);
    if (n.props?.accessibilityRole === 'button' && style?.backgroundColor === lightTokens.accent) found.push(String(n.props.accessibilityLabel));
    (n.children ?? []).forEach(step);
  };
  step(view.toJSON());
  return found;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(HapticService, 'mediumImpact').mockResolvedValue(undefined);
  mockUser = { id: 'c1', email: 'c1@example.test', role: 'client', coach_id: 'coach' };
  mockQuery = { data: [doneEarlier, fullBody] };
  mockNames = { names: { squat: 'Back squat', pullup: 'Pull-up', pushup: 'Push-up' }, loading: false };
  mockLoadSession.mockResolvedValue(null);
});

describe('C1 Train tab, Style C v2 (clientTrainV2)', () => {
  it('is off by default in every build', () => {
    expect(jest.requireActual('../../../config/featureFlags').featureFlags.clientTrainV2).toBe(false);
  });

  it('draws the week, the coach note and today, with Start workout under the name as the one forest action', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Full body A')).toBeTruthy());
    expect(view.getByText('This week')).toBeTruthy();
    expect(view.getByText('1 of 2 done')).toBeTruthy();
    expect(view.getByLabelText('1 of 2 done')).toBeTruthy();
    expect(view.getByLabelText(`${dateNum(today)}, Today`)).toBeTruthy();
    expect(view.getByText('Squats hold at 185 this week.')).toBeTruthy();
    expect(view.getByText('Sam')).toBeTruthy();
    expect(view.getByText('3 exercises · about 55 min')).toBeTruthy();
    expect(view.getByText('Back squat')).toBeTruthy();
    expect(view.getByText('4 × 5 · 185 lb')).toBeTruthy();
    expect(view.getByText('Pull-up + Push-up')).toBeTruthy();
    expect(view.getByText('Superset · 3 rounds')).toBeTruthy();
    expect(view.getByTestId('train-block-B')).toBeTruthy();
    expect(view.queryByText('From your coach')).toBeNull();
    expect(forestButtons(view)).toEqual(['Start workout']);
    // Quick workout and the coach list stay one tap away.
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
    await fireEvent.press(view.getByLabelText('All coach workouts'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
  });

  it('Start workout opens the live workout with the assignment and the real names, with a medium haptic', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Start workout')).toBeTruthy());
    await fireEvent.press(view.getByTestId('train-start'));
    expect(HapticService.mediumImpact).toHaveBeenCalledTimes(1);
    const [screen, params] = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1];
    expect(screen).toBe('ActiveWorkout');
    expect(params).toMatchObject({ routineId: 'p1', routineName: 'Full body A', assignmentId: 'a1' });
    const sent = JSON.parse(params.exercises) as Array<{ exerciseId: string; exerciseName: string; sets: number }>;
    expect(sent.map((e) => e.exerciseName)).toEqual(['Back squat', 'Pull-up', 'Push-up']);
    expect(sent[0]).toMatchObject({ exerciseId: 'squat', sets: 4 });
  });

  it('waits for the exercise names, and reads Resume workout when this workout is in progress', async () => {
    mockNames = { names: {}, loading: true };
    const waiting = await render(<WorkoutScreen />);
    await waitFor(() => expect(waiting.getByLabelText('Loading exercise names')).toBeTruthy());
    await fireEvent.press(waiting.getByTestId('train-start'));
    expect(mockNavigate).not.toHaveBeenCalledWith('ActiveWorkout', expect.objectContaining({ assignmentId: 'a1' }));
    waiting.unmount();
    mockNames = { names: {}, loading: false };
    mockLoadSession.mockResolvedValue({ session: { assignmentId: 'a1' } });
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Resume workout')).toBeTruthy());
    expect(mockLoadSession).toHaveBeenCalledWith('c1');
  });

  it('first day with a coach: Nothing planned yet, the coach line, Quick workout leads', async () => {
    mockQuery = { data: [] };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Nothing planned yet.')).toBeTruthy());
    expect(view.getByText('When Sam sends a plan, each day shows here with what to lift and why.')).toBeTruthy();
    expect(view.queryByTestId('train-week-ring')).toBeNull();
    expect(view.getByLabelText(`${dateNum(today)}, Today`)).toBeTruthy();
    expect(forestButtons(view)).toEqual(['Quick workout']);
  });

  it('coachless: Your plan, no coach voice, every logging route kept', async () => {
    mockUser = { id: 'c1', email: 'c1@example.test', role: 'client' };
    mockQuery = { data: [] };
    const empty = await render(<WorkoutScreen />);
    await waitFor(() => expect(empty.getByText('Your plan')).toBeTruthy());
    expect(empty.getByText('Nothing planned yet.')).toBeTruthy();
    expect(empty.queryByText(/sends a plan/)).toBeNull();
    expect(empty.queryByLabelText('Coach guidelines')).toBeNull();
    await fireEvent.press(empty.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
    empty.unmount();
    mockQuery = { data: [fullBody] };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Full body A')).toBeTruthy());
    expect(view.queryByTestId('train-coach-note')).toBeNull();
    expect(view.queryByText('Squats hold at 185 this week.')).toBeNull();
    expect(forestButtons(view)).toEqual(['Start workout']);
  });

  it('loading and failed reads are true: a calm skeleton and disabled Start, then Try again', async () => {
    mockQuery = { isLoading: true };
    const loading = await render(<WorkoutScreen />);
    await waitFor(() => expect(loading.getAllByLabelText("Loading today's workout").length).toBe(2));
    expect(loading.getByTestId('train-start').props.accessibilityState).toMatchObject({ disabled: true });
    expect(forestButtons(loading)).not.toContain('Start workout');
    loading.unmount();
    mockQuery = { isError: true };
    const failed = await render(<WorkoutScreen />);
    await waitFor(() => expect(failed.getByText('This workout did not load.')).toBeTruthy());
    expect(failed.queryByTestId('train-week')).toBeNull();
    await fireEvent.press(failed.getByTestId('train-retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });
});

describe('C1 Train tab helpers', () => {
  const open = (id: string, day: string) => ({ id, scheduled_for: at(day), completed_at: null });
  it('features today, else the next open workout, else the latest missed one', () => {
    const later = open('later', addDays(today, 2));
    const missed = open('missed', addDays(today, -2));
    expect(featuredWorkout([later, open('now', today), missed], today)?.id).toBe('now');
    expect(featuredWorkout([missed, later], today)?.id).toBe('later');
    expect(featuredWorkout([open('old', addDays(today, -3)), missed], today)?.id).toBe('missed');
    expect(featuredWorkout([{ ...later, completed_at: at(today) }], today)).toBeNull();
  });

  it('letters blocks in order and keeps a superset on one letter', () => {
    const rows = fullBody.exercises.map((r) => ({ ...r })) as Parameters<typeof blocksOf>[0];
    expect(blocksOf(rows).map((b) => [b.letter, b.rows.length])).toEqual([['A', 1], ['B', 2]]);
  });

  it('with nothing set this week the strip is the bare week with today marked', () => {
    const week = trainWeek([], today);
    expect(week.total).toBe(0);
    expect(week.days).toHaveLength(7);
    expect(week.days.filter((d) => d === 'today')).toHaveLength(1);
    expect(week.dates).toContain(dateNum(today));
  });
});
