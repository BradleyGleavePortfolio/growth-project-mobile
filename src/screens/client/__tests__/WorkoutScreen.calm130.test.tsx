/**
 * TRAIN-TAB-FIN-130 (finishes CF-TRAIN-TAB-128): the Train tab shows true
 * states in the calm layout, with every action kept.
 *
 *   - One forest action per state: the coach's pending workout when there is
 *     one, otherwise Quick workout; after a load failure, Try again.
 *   - Completed coach workouts stay one tap away with 0 or 1 pending (U10).
 *   - A load failure keeps the header, coach workouts, Quick workout and
 *     Create a routine instead of replacing the whole tab, and says what did
 *     not load without claiming retries that never ran.
 *   - Copy names a coach only when there is one (U5); weights read "lb" (U4).
 */
import React from 'react';
import { Alert, AppState, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { lightTokens, typography } from '../../../theme/tokens';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanChat: false, clientTutorial: false } }));

let mockUser: { id: string; email: string; role: string; coach_id?: string } = { id: 'c1', email: 'c1@example.test', role: 'client' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

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

const mockGetRoutines = jest.fn();
const mockGetAll = jest.fn();
const mockGetVolume = jest.fn();
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: (...a: unknown[]) => mockGetRoutines(...a),
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getVolume: (...a: unknown[]) => mockGetVolume(...a),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));

let mockAssignments: Array<{ id: string; completed_at: string | null; workout_plan: { name: string } }> = [];
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, refetch: async () => ({}) }),
}));

const mockLoadSession = jest.fn();
const mockCountQueued = jest.fn();
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a) }));
jest.mock('../../../offline', () => ({
  countQueuedWorkouts: (...a: unknown[]) => mockCountQueued(...a),
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);

import WorkoutScreen from '../WorkoutScreen';
const RealSyncCards: typeof import('../../../components/workout/WorkoutSyncCards').default =
  jest.requireActual('../../../components/workout/WorkoutSyncCards').default;

type Node = { props?: Record<string, unknown>; children?: Array<Node | string> | null } | string | null;
function walk(view: { toJSON: () => unknown }, visit: (props: Record<string, unknown>, style: TextStyle | undefined, children: Array<Node | string>) => void) {
  const step = (node: Node | Node[]) => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    visit(node.props ?? {}, StyleSheet.flatten(node.props?.style as StyleProp<TextStyle>), node.children ?? []);
    (node.children ?? []).forEach(step);
  };
  step(view.toJSON() as Node);
}
/** Labels of the buttons drawn with the forest fill (the screen's primary action). */
function forestButtons(view: { toJSON: () => unknown }): string[] {
  const found: string[] = [];
  walk(view, (props, style) => {
    if (props.accessibilityRole === 'button' && style?.backgroundColor === lightTokens.accent) found.push(String(props.accessibilityLabel));
  });
  return found;
}
/** Font sizes of every text on screen. */
function fontSizes(view: { toJSON: () => unknown }): number[] {
  const sizes: number[] = [];
  walk(view, (_props, style, children) => {
    if (typeof style?.fontSize === 'number' && children.some((c) => typeof c === 'string')) sizes.push(style.fontSize);
  });
  return sizes;
}

const pending = (id: string, name: string) => ({ id, completed_at: null, workout_plan: { name } });
const done = (id: string) => ({ id, completed_at: '2026-10-01T10:00:00Z', workout_plan: { name: `Done ${id}` } });
const lifted = (id: string) => ({
  id, date: new Date().toISOString(), workout_name: `Session ${id}`, duration_minutes: 30, notes: '',
  exercises: [{ muscle_group: 'chest', exercise_name: 'Bench Press', sets_completed: 1, weight_per_set: [100], reps_per_set: [5] }],
});
const QUICK = ['ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' }];
const FAILED_LINE = 'Your routines and history did not load. Check the connection, then try again.';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockUser = { id: 'c1', email: 'c1@example.test', role: 'client' };
  mockAssignments = [];
  mockGetRoutines.mockResolvedValue({ data: [] });
  mockGetAll.mockResolvedValue({ data: [] });
  mockGetVolume.mockResolvedValue({ data: [] });
});

describe('Train tab: one forest action and every route kept (TRAIN-TAB-FIN-130)', () => {
  it('day one: Quick workout is the one forest action, the title is Cormorant, header and routine routes stay', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Quick workout')).toBeTruthy());
    expect(StyleSheet.flatten(view.getByText('Workouts').props.style).fontFamily).toBe(typography.h1.fontFamily);
    expect(forestButtons(view)).toEqual(['Quick workout']);
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith(...QUICK);
    for (const button of view.getAllByLabelText('Create a routine')) {
      mockNavigate.mockClear();
      await fireEvent.press(button);
      expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder');
    }
    await fireEvent.press(view.getByLabelText('Exercise library'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ExerciseLibrary');
    // B22/B29: no coach, no Coach guidelines (WorkoutScreen.coachless135).
    expect(view.queryByLabelText('Coach guidelines')).toBeNull();
    expect(view.queryByLabelText('All coach workouts')).toBeNull();
  });

  it('one pending coach workout leads; completed coach workouts and Quick workout stay one tap away', async () => {
    mockUser = { ...mockUser, coach_id: 'coach' };
    mockAssignments = [pending('a1', 'Upper body A'), done('a0')];
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Upper body A')).toBeTruthy());
    expect(forestButtons(view)).toEqual(['Open assigned workout: Upper body A']);
    await fireEvent.press(view.getByLabelText('Open assigned workout: Upper body A'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: 'a1' }, initial: false });
    expect(view.getByText('1 completed')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('All coach workouts'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith(...QUICK);
  });

  it('two pending: the one forest action opens the list, with no second row to the same place', async () => {
    mockUser = { ...mockUser, coach_id: 'coach' };
    mockAssignments = [pending('a1', 'Upper body A'), pending('a2', 'Lower body B'), done('a0')];
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('2 workouts waiting')).toBeTruthy());
    expect(forestButtons(view)).toEqual(['View 2 coach-assigned workouts']);
    await fireEvent.press(view.getByLabelText('View 2 coach-assigned workouts'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
    expect(view.queryByLabelText('All coach workouts')).toBeNull();
  });

  it('nothing pending but some completed: Quick workout leads and the completed list stays reachable', async () => {
    mockUser = { ...mockUser, coach_id: 'coach' };
    mockAssignments = [done('a0'), done('a9')];
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('2 completed')).toBeTruthy());
    expect(forestButtons(view)).toEqual(['Quick workout']);
    await fireEvent.press(view.getByLabelText('All coach workouts'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
  });

  it('a load failure keeps the header, Quick workout and Create a routine, says what failed, and Try again reloads', async () => {
    mockGetRoutines.mockRejectedValueOnce(new Error('Network Error'));
    mockGetRoutines.mockResolvedValue({ data: [{ id: 'r1', name: 'Full body', exercises: [], is_template: false }] });
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText(FAILED_LINE)).toBeTruthy());
    expect(forestButtons(view)).toEqual(['Try again']);
    expect(view.queryByText(/tried|retried|several times/i)).toBeNull();
    expect(view.queryByText('Recent workouts')).toBeNull();
    await fireEvent.press(view.getByLabelText('Exercise library'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ExerciseLibrary');
    await fireEvent.press(view.getByLabelText('Create a routine'));
    expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder');
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith(...QUICK);
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Try again'));
    });
    await waitFor(() => expect(view.getByText('Full body')).toBeTruthy());
    expect(view.queryByText(FAILED_LINE)).toBeNull();
    expect(forestButtons(view)).toEqual(['Quick workout']);
  });

  it('a load failure keeps a pending coach workout one tap away as a quiet row', async () => {
    mockUser = { ...mockUser, coach_id: 'coach' };
    mockAssignments = [pending('a1', 'Upper body A')];
    mockGetRoutines.mockRejectedValue(new Error('Network Error'));
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText(FAILED_LINE)).toBeTruthy());
    expect(forestButtons(view)).toEqual(['Try again']);
    await fireEvent.press(view.getByLabelText('Open assigned workout: Upper body A'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: 'a1' }, initial: false });
  });

  it('routine and history actions keep their routes', async () => {
    mockGetRoutines.mockResolvedValue({ data: [{ id: 'r1', name: 'Full body', exercises: [], is_template: false }] });
    mockGetAll.mockResolvedValue({ data: [lifted('s1')] });
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Full body')).toBeTruthy());
    expect(view.getByText('0 exercises')).toBeTruthy();
    await fireEvent.press(view.getByText('Full body'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', expect.objectContaining({ routineId: 'r1', routineName: 'Full body' }));
    await fireEvent.press(view.getByLabelText('Edit routine Full body'));
    expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder', { routineId: 'r1' });
    await fireEvent.press(view.getByLabelText('Edit workout Session s1'));
    expect(mockNavigate).toHaveBeenLastCalledWith('WorkoutHistoryEdit', { workout: expect.stringContaining('"id":"s1"') });
  });

  it.each([
    ['coachless', undefined, 'Session s1 will be removed from your history.'],
    ['coached', 'coach', 'Session s1 will be removed from your history and from what your coach sees.'],
  ])('delete copy names a coach only when there is one: %s', async (_case, coachId, body) => {
    mockUser = { ...mockUser, coach_id: coachId };
    mockGetAll.mockResolvedValue({ data: [lifted('s1')] });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByLabelText('Delete workout Session s1')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Delete workout Session s1'));
    expect(alert).toHaveBeenCalledWith('Delete this workout?', body, expect.any(Array));
    alert.mockRestore();
  });

  it('weights read lb, the week count is tabular ink, labels are sentence case, and no text is below 11 pt', async () => {
    mockGetAll.mockResolvedValue({ data: [lifted('s1')] });
    mockGetVolume.mockResolvedValue({ data: [{ muscle_group: 'chest', total_volume: 1200, period: 'week' }] });
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('1,200 lb')).toBeTruthy());
    expect(view.getByText('500 lb')).toBeTruthy();
    expect(view.getByText('Last 8 weeks, lb lifted')).toBeTruthy();
    expect(view.queryByText(/\blbs\b/)).toBeNull();
    for (const label of ['My routines', 'Recent workouts', 'This week', 'Training volume', 'Muscle breakdown']) {
      expect(view.getByText(label)).toBeTruthy();
    }
    const week = StyleSheet.flatten(view.getByTestId('workout-week-count').props.style);
    expect(week.color).toBe(lightTokens.textPrimary);
    expect(week.fontVariant).toContain('tabular-nums');
    expect(Math.min(...fontSizes(view))).toBeGreaterThanOrEqual(11);
  });
});

describe('Train tab sync rows (TRAIN-TAB-FIN-130)', () => {
  it('the queued notice says when it sends without promising a coach', async () => {
    mockLoadSession.mockResolvedValue(null);
    mockCountQueued.mockResolvedValue(2);
    const view = await render(<RealSyncCards userId="c1" />);
    await waitFor(() => expect(view.getByTestId('workout-queued-notice')).toBeTruthy());
    expect(view.getByText('2 workouts are saved on this phone and will be sent once the phone is back online.')).toBeTruthy();
    expect(view.queryByText(/coach/)).toBeNull();
  });
});
