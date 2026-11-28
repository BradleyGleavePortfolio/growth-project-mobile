/**
 * FIX-987R4 (m#987 fix round 3; LS-987R3 B1 and LO-987R3 B1, one class: when the Train tab draws the first button of
 * the owner's flow, #203-E80 "odays workouts -> workout plans button -> this week/2 weeks out -> full program button ->
 * your weeks page"). Operator ruling FLOW-1 "plans row always": the Workout plans row shows in every state of Today's
 * workouts whose read holds a workout, flag on or off, whatever is open or done, after a failed routines load and over a
 * cached read whose refetch failed. Its second line stays true in each state: "{n} completed" once one is done, else
 * "{n} workouts waiting" and, for one, "1 workout waiting" (R4-W1, operator, #203-E15); never "0 completed" or
 * "1 workouts waiting". The hero stays the one forest action. An empty read has nothing to plan: no row (calm130 day one).
 */
import React from 'react';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';

const mockFlags: Record<string, boolean> = { clientTrainV2: false, romanChat: false, clientTutorial: false };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-11-18' }));

const mockUser = { id: 'c1', email: 'c1@example.test', role: 'client', coach_id: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn(), getParent: () => ({ navigate: mockNavigate }) };
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    NavigationContext: require('react').createContext(undefined),
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
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: (...a: unknown[]) => mockGetRoutines(...a),
    getAll: async () => ({ data: [] }),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));
let mockRead: { data?: unknown[]; isError: boolean } = { data: [], isError: false };
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ ...mockRead, isLoading: false, refetch: async () => ({}) }),
}));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach', name: 'Sam Rivera' }] }) }));
jest.mock('../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => ({ names: {}, loading: false, bodyWeight: {} }) }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../offline', () => ({
  countQueuedWorkouts: async () => 0,
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
  listRefusedWorkouts: async () => [],
  deadLetterEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));

// Required after the mocks, so the switches above are in place when the screen loads.
const WorkoutScreen = (require('../WorkoutScreen') as { default: React.ComponentType }).default;

/** Today is Wednesday 18 November 2026 (the mock above); open ones fall later this week, done ones earlier. */
function w(id: string, day: string, done: boolean) {
  return {
    id, workout_plan_id: id, client_id: 'c1', assigned_by_coach_id: 'coach', scheduled_for: `${day}T00:00:00.000Z`,
    completed_at: done ? `${day}T18:00:00.000Z` : null, skipped_at: null, post_rpe: done ? 7 : null, post_notes: null,
    workout_plan: { id, coach_id: 'coach', name: id, type: 'strength', exercises: [], duration_estimate_minutes: 30,
      created_at: '', updated_at: '', archived_at: null },
  };
}
const open = (n: number) => ['Upper body A', 'Lower body B', 'Conditioning C'].slice(0, n).map((id, i) => w(id, `2026-11-${19 + i}`, false));
const done = (n: number) => ['Done A', 'Done B'].slice(0, n).map((id, i) => w(id, `2026-11-${16 + i}`, true));

type Tree = { props?: Record<string, unknown>; children?: Array<Tree | string> | null } | string | null;
/** Every string drawn inside a subtree, in order (an icon's font glyph, a private-use character, left out). */
function texts(node: Tree | Tree[]): string[] {
  if (!node) return [];
  if (typeof node === 'string') return /^[\s\uE000-\uF8FF]*$/.test(node) ? [] : [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return (node.children ?? []).flatMap(texts);
}
function find(node: Tree | Tree[], testID: string): Tree[] {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap((n) => find(n, testID));
  const own = node.props?.testID === testID ? [node] : [];
  return [...own, ...(node.children ?? []).flatMap((n) => find(n as Tree, testID))];
}
function forestButtons(node: Tree | Tree[]): string[] {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(forestButtons);
  const style = StyleSheet.flatten(node.props?.style as StyleProp<ViewStyle>);
  const own = node.props?.accessibilityRole === 'button' && style?.backgroundColor === lightTokens.accent ? [String(node.props.accessibilityLabel)] : [];
  return [...own, ...(node.children ?? []).flatMap((n) => forestButtons(n as Tree))];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockFlags.clientTrainV2 = false;
  mockRead = { data: [], isError: false };
  mockGetRoutines.mockResolvedValue({ data: [] });
});

async function openTrain(on: boolean, rows: unknown[] | undefined, opts: { routinesFail?: boolean; readFailed?: boolean } = {}) {
  mockFlags.clientTrainV2 = on;
  mockRead = { data: rows, isError: !!opts.readFailed };
  if (opts.routinesFail) mockGetRoutines.mockRejectedValue(new Error('Network Error'));
  const view = await render(<WorkoutScreen />);
  await waitFor(() => expect(view.getByText('My routines')).toBeTruthy());
  return view;
}

describe('FIX-987R4 FLOW-1: the Workout plans row in every Train state whose read holds a workout, with true words', () => {
  it.each([
    // [state, its second line, clientTrainV2, rows, options]
    ['flag off, one open, none done (a new client\'s first workout)', '1 workout waiting', false, [...open(1)], {}],
    ['flag off, two open, none done', '2 workouts waiting', false, [...open(2)], {}],
    ['flag off, three open, none done', '3 workouts waiting', false, [...open(3)], {}],
    ['flag off, two open, one done (the commonest)', '1 completed', false, [...open(2), ...done(1)], {}],
    ['flag off, two open, two done', '2 completed', false, [...open(2), ...done(2)], {}],
    ['flag off, one open, one done', '1 completed', false, [...open(1), ...done(1)], {}],
    ['flag off, none open, one done', '1 completed', false, [...done(1)], {}],
    ['flag off, none open, two done', '2 completed', false, [...done(2)], {}],
    ['flag off, one open, none done, routines failed', '1 workout waiting', false, [...open(1)], { routinesFail: true }],
    ['flag off, two open, one done, routines failed', '1 completed', false, [...open(2), ...done(1)], { routinesFail: true }],
    ['flag off, two open, none done, a cached read whose refetch failed', '2 workouts waiting', false, [...open(2)], { readFailed: true }],
    ['flag on, only the workout Train features', '1 workout waiting', true, [...open(1)], {}],
    ['flag on, two open, none done', '2 workouts waiting', true, [...open(2)], {}],
    ['flag on, two open, one done', '1 completed', true, [...open(2), ...done(1)], {}],
    ['flag on, none open, two done', '2 completed', true, [...done(2)], {}],
    ['flag on, only the featured workout, routines failed', '1 workout waiting', true, [...open(1)], { routinesFail: true }],
    ['flag on, a cached read whose refetch failed', '1 completed', true, [...open(1), ...done(1)], { readFailed: true }],
  ] as const)('%s: one "Workout plans" row reads "%s" and opens Your workouts', async (_state, line, on, rows, opts) => {
    const view = await openTrain(on, [...rows], opts);
    const tree = view.toJSON() as Tree;
    const row = find(tree, 'workout-all-coach-workouts');
    expect(row).toHaveLength(1);
    expect(texts(row)).toEqual(['Workout plans', line]);
    expect(texts(tree)).not.toContain('0 completed');
    expect(texts(tree)).not.toContain('1 workouts waiting');
    expect(forestButtons(tree).length).toBeLessThanOrEqual(1);
    mockNavigate.mockClear();
    await fireEvent.press(view.getByLabelText('Workout plans'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
  });

  it.each([
    ['flag off, the read holds nothing', false, [], {}],
    ['flag on, the read holds nothing', true, [], {}],
    ['flag off, the read failed with nothing cached', false, undefined, { readFailed: true }],
    ['flag on, the read failed with nothing cached', true, undefined, { readFailed: true }],
  ] as const)('%s: nothing to plan, so no Workout plans row', async (_state, on, rows, opts) => {
    const view = await openTrain(on, rows ? [...rows] : undefined, opts);
    expect(view.queryByLabelText('Workout plans')).toBeNull();
    expect(find(view.toJSON() as Tree, 'workout-all-coach-workouts')).toHaveLength(0);
  });
});
