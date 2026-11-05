/**
 * FIX-928-BW (agent 197, owner #197-E10): "body weight excercises are suppsoed
 * to be "BW x 60 seconds" not "0lbs x 60 seconds"".
 *
 * A body-weight exercise (its catalog equipment is "body weight", GET
 * /exercises/:id, the same read the phone already makes for the name) shows BW
 * where the weight goes, and screen readers say "body weight" where they said
 * "0 pounds". BW comes from the exercise, never from a 0 weight: a weighted
 * exercise at 0 keeps "0 lb", and a body-weight exercise with an added load
 * keeps its number.
 */
import React from 'react';
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';

const EQUIPMENT: Record<string, string> = { plank: 'body weight', pullup: 'body weight', squat: 'barbell' };
const NAMES: Record<string, string> = { plank: 'front plank', pullup: 'pull up', squat: 'back squat' };
const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...a: unknown[]) => mockGetById(...a) },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), getParent: () => undefined, addListener: jest.fn(() => () => undefined) }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => undefined,
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
let mockList: unknown[] = [];
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockList, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));

import { isBodyWeightEquipment } from '../utils/workout/bodyWeight';
import { useExerciseNames } from '../hooks/useExerciseNames';
import { useBodyWeightExercises } from '../hooks/useBodyWeightExercises';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { planLine } from '../screens/client/active-workout/ExerciseCard';
import type { SessionSet } from '../screens/client/active-workout/types';
import ClientWorkoutViewerScreen from '../screens/client/ClientWorkoutViewerScreen';

let qc: QueryClient;
const wrap = (node: React.ReactElement) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetById.mockImplementation((id: string) => Promise.resolve({ data: { id, name: NAMES[id], equipment: EQUIPMENT[id] } }));
  mockList = [];
});

describe('which exercise is body-weight', () => {
  it.each([
    ['body weight', true], ['Body Weight', true], ['bodyweight', true], [' body  weight ', true],
    ['barbell', false], ['dumbbell', false], ['', false], [undefined, false], [null, false], [['body weight'], false],
  ])('equipment %p -> %p', (equipment, expected) => {
    expect(isBodyWeightEquipment(equipment)).toBe(expected);
  });

  it('useExerciseNames reads it from the same catalog read as the name', async () => {
    const { result } = await renderHook(() => useExerciseNames(['plank', 'squat']), { wrapper: ({ children }) => wrap(<>{children}</>) });
    await waitFor(() => expect(result.current.names.squat).toBe('Back Squat'));
    expect(result.current.bodyWeight).toEqual({ plank: true, squat: false });
  });

  it('useBodyWeightExercises answers {} and never throws without a query client', async () => {
    // FIX-928: the real renderHook, so the hook is truly bare. The "All switches
    // on" job's setup wraps render and renderHook in a default QueryClient,
    // which would make this a with-client test there.
    const bare = jest.requireActual<typeof import('@testing-library/react-native')>('@testing-library/react-native');
    const { result } = await bare.renderHook(() => useBodyWeightExercises(['plank']));
    expect(result.current).toEqual({});
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('useBodyWeightExercises reads the catalog with a query client', async () => {
    const { result } = await renderHook(() => useBodyWeightExercises(['plank', 'squat']), { wrapper: ({ children }) => wrap(<>{children}</>) });
    await waitFor(() => expect(result.current).toEqual({ plank: true, squat: false }));
  });
});

const styles = new Proxy({}, { get: () => ({}) }) as never;
const colors = new Proxy({}, { get: () => '#000000' }) as never;
function setRow(props: { set: SessionSet; timed?: boolean; bodyWeight?: boolean; previous?: SessionSet; nextUp?: boolean; onUpdate?: jest.Mock; onToggleComplete?: jest.Mock }) {
  return render(
    <SetLogger set={props.set} setIdx={0} exIdx={0} timed={props.timed} bodyWeight={props.bodyWeight} previous={props.previous}
      nextUp={props.nextUp} onUpdate={props.onUpdate ?? jest.fn()} onToggleComplete={props.onToggleComplete ?? jest.fn()}
      colors={colors} styles={styles} />,
  );
}

describe('the live set row of a body-weight exercise', () => {
  it.each([
    { name: 'body-weight timed set', timed: true, bodyWeight: true, weight: 0, reps: 60, zero: true,
      text: 'BW × 60 sec', spoken: 'Set 1, body weight, 60 seconds. Change the numbers' },
    { name: 'body-weight rep set', timed: false, bodyWeight: true, weight: 0, reps: 10, zero: true,
      text: 'BW × 10', spoken: 'Set 1, body weight, 10 reps. Change the numbers' },
    { name: 'body-weight set with no coach weight', timed: true, bodyWeight: true, weight: 0, reps: 60, zero: false,
      text: 'BW × 60 sec', spoken: 'Set 1, body weight, 60 seconds. Change the numbers' },
    { name: 'weighted exercise at 0 keeps 0 lb', timed: true, bodyWeight: false, weight: 0, reps: 60, zero: true,
      text: '0 lb × 60 sec', spoken: 'Set 1, 0 pounds, 60 seconds. Change the numbers' },
    { name: 'body-weight exercise with an added load keeps its number', timed: false, bodyWeight: true, weight: 20, reps: 8, zero: false,
      text: '20 lb × 8', spoken: 'Set 1, 20 pounds, 8 reps. Change the numbers' },
  ])('$name reads "$text"', async ({ timed, bodyWeight, weight, reps, zero, text, spoken }) => {
    const view = await setRow({ set: { weight, reps, completed: false, ...(zero ? { prescribedZero: true } : {}) }, timed, bodyWeight });
    expect(view.getByText(text)).toBeTruthy();
    expect(view.getByLabelText(spoken)).toBeTruthy();
  });

  it.each([
    { name: 'body-weight', bodyWeight: true, prevWeight: 0, text: 'BW × 45 sec', spoken: 'Use previous set 1: body weight, 45 seconds' },
    { name: 'weighted at 0', bodyWeight: false, prevWeight: 0, text: '0 × 45 sec', spoken: 'Use previous set 1: 0 pounds, 45 seconds' },
    { name: 'body-weight with a load last time', bodyWeight: true, prevWeight: 25, text: '25 × 45 sec', spoken: 'Use previous set 1: 25 pounds, 45 seconds' },
  ])('Use previous for $name reads "$text"', async ({ bodyWeight, prevWeight, text, spoken }) => {
    const view = await setRow({ set: { weight: 0, reps: 60, completed: false }, timed: true, bodyWeight, nextUp: true,
      previous: { weight: prevWeight, reps: 45, completed: true } });
    expect(view.getByText(text)).toBeTruthy();
    expect(view.getByLabelText(spoken)).toBeTruthy();
  });

  it('the next set fields show BW in the weight cell and no "lb"', async () => {
    const view = await setRow({ set: { weight: 0, reps: 60, completed: false, prescribedZero: true }, timed: true, bodyWeight: true, nextUp: true });
    const cell = view.getByTestId('set-weight-0-0');
    expect(cell.props.value).toBe('');
    expect(cell.props.placeholder).toBe('BW');
    expect(view.queryByText('lb ×')).toBeNull();
    expect(view.getByText('×')).toBeTruthy();
  });

  it('a weighted exercise at 0 keeps "0" and "lb ×" in its fields', async () => {
    const view = await setRow({ set: { weight: 0, reps: 60, completed: false, prescribedZero: true }, timed: true, bodyWeight: false, nextUp: true });
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('0');
    expect(view.getByText('lb ×')).toBeTruthy();
  });

  it('As planned on a coach\'s body-weight 0 keeps 0, never last time\'s load', async () => {
    const onUpdate = jest.fn();
    const onToggleComplete = jest.fn();
    const view = await setRow({ set: { weight: 0, reps: 8, completed: false, prescribedZero: true }, bodyWeight: true, nextUp: true,
      previous: { weight: 20, reps: 8, completed: true }, onUpdate, onToggleComplete });
    await fireEvent.press(view.getByTestId('set-done-0-0'));
    expect(onUpdate).not.toHaveBeenCalledWith(0, 0, 'weight', 20);
    expect(onToggleComplete).toHaveBeenCalledWith(0, 0);
  });

  it('typing a load into a body-weight set shows "lb ×" again', async () => {
    const view = await setRow({ set: { weight: 0, reps: 8, completed: false }, bodyWeight: true, nextUp: true });
    expect(view.queryByText('lb ×')).toBeNull();
    await view.rerender(
      <SetLogger set={{ weight: 25, reps: 8, completed: false }} setIdx={0} exIdx={0} bodyWeight nextUp
        onUpdate={jest.fn()} onToggleComplete={jest.fn()} colors={colors} styles={styles} />,
    );
    expect(view.getByText('lb ×')).toBeTruthy();
  });
});

describe('the live plan line', () => {
  const sets = (weight: number, zero: boolean, reps = 60): SessionSet[] =>
    [0, 1, 2].map(() => ({ weight, reps, completed: false, ...(zero ? { prescribedZero: true } : {}) }));
  it.each([
    ['body-weight timed', sets(0, true), true, true, '3 × 60 sec · BW'],
    ['body-weight reps', sets(0, true, 10), false, true, '3 × 10 · BW'],
    ['weighted at 0', sets(0, true), true, false, '3 × 60 sec · 0 lb'],
    ['body-weight with a load', sets(20, false, 8), false, true, '3 × 8 · 20 lb'],
    ['body-weight, no coach weight', sets(0, false), true, true, '3 × 60 sec'],
  ])('%s -> %p', (_n, s, timed, bodyWeight, expected) => {
    expect(planLine(s, timed, bodyWeight)).toBe(expected);
  });
});

describe('Your workouts list', () => {
  it('a body-weight row reads "BW prescribed"; a weighted row at 0 keeps "0 lb prescribed"', async () => {
    mockList = [{
      id: 'asg-1', workout_plan_id: 'plan-1', client_id: 'client-a', assigned_by_coach_id: 'coach-1',
      scheduled_for: '2026-11-05T12:00:00', completed_at: null, post_rpe: null, post_notes: null,
      workout_plan: { id: 'plan-1', coach_id: 'coach-1', name: 'Core day', type: 'strength', duration_estimate_minutes: 30,
        created_at: '', updated_at: '', archived_at: null, exercises: [] },
      snapshot: { plan_name: 'Core day', plan_type: 'strength' },
      exercises: [
        { exercise_external_id: 'plank', order: 1, sets: 3, reps_or_duration_seconds: 60, unit: 'seconds', weight_lbs: 0, rest_seconds: 30, superset_group_id: null, notes: null },
        { exercise_external_id: 'squat', order: 2, sets: 3, reps_or_duration_seconds: 5, unit: 'reps', weight_lbs: 0, rest_seconds: 30, superset_group_id: null, notes: null },
        { exercise_external_id: 'pullup', order: 3, sets: 3, reps_or_duration_seconds: 8, unit: 'reps', weight_lbs: 20, rest_seconds: 30, superset_group_id: null, notes: null },
      ],
      snapshot_source: true, roman_adjusted_sets: [],
    } as unknown as ClientWorkoutAssignmentWithPlan];
    const view = await render(wrap(<ClientWorkoutViewerScreen />));
    await waitFor(() => expect(view.getByText('Front Plank')).toBeTruthy());
    await waitFor(() => expect(view.getByText(/^3 sets × 60 sec · BW prescribed$/)).toBeTruthy());
    expect(view.getByText(/^3 sets × 5 reps \/ sec · 0 lb prescribed$/)).toBeTruthy();
    expect(view.getByText(/^3 sets × 8 reps \/ sec · 20 lb prescribed$/)).toBeTruthy();
  });
});
