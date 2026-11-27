/**
 * LO-987R3 B1 (m#987 round 3, owner #203-E80 "odays workouts -> workout plans button -> this week/2 weeks out", the
 * operator's ruling (2) at REFINE-987R3.txt:85: the Workout plans row shows whenever the read holds any workout, flag
 * on or off). For every Train state whose read holds a workout, a control seen and spoken "Workout plans" is drawn
 * and opens MoreTab > ClientWorkoutViewer with initial false. The hero stays the one forest action.
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
let mockAssignments: unknown[] = [];
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: false, isError: false, refetch: async () => ({}) }),
}));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach', name: 'Sam Rivera' }] }) }));
jest.mock('../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => ({ names: {}, loading: false, bodyWeight: {} }) }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../offline', () => ({
  countQueuedWorkouts: async () => 0,
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));

// Required after the mocks, so the switches above are in place when the screen loads (as r3.flow requires the navigator).
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
const OPEN_A = w('Upper body A', '2026-11-19', false);
const OPEN_B = w('Lower body B', '2026-11-20', false);
const OPEN_C = w('Conditioning C', '2026-11-21', false);
const DONE_A = w('Done A', '2026-11-16', true);
const DONE_B = w('Done B', '2026-11-17', true);

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
  mockFlags.clientTrainV2 = false;
  mockGetRoutines.mockResolvedValue({ data: [] });
});

describe('LO-987R3 B1: every Train state whose read holds a workout starts the owner\'s flow at "Workout plans"', () => {
  it.each([
    // [state, clientTrainV2, rows, routines load fails]
    ['two open and one done (the operator\'s case, FLOW-A)', false, [OPEN_A, OPEN_B, DONE_A], false],
    ['three open, none done (FLOW-A)', false, [OPEN_A, OPEN_B, OPEN_C], false],
    ['one open, none done (FLOW-B)', false, [OPEN_A], false],
    ['two open and one done after a failed routines load (FLOW-B)', false, [OPEN_A, OPEN_B, DONE_A], true],
    ['one open, none done after a failed routines load (FLOW-B)', false, [OPEN_A], true],
    ['clientTrainV2 on, only the workout Train features (FLOW-B)', true, [OPEN_A], false],
    ['one open and one done (as at the head)', false, [OPEN_A, DONE_A], false],
    ['none open, two done (as at the head)', false, [DONE_A, DONE_B], false],
    ['clientTrainV2 on, two open and one done (as at the head)', true, [OPEN_A, OPEN_B, DONE_A], false],
  ] as const)('%s: a "Workout plans" control opens Your workouts', async (_state, on, rows, routinesFail) => {
    mockFlags.clientTrainV2 = on;
    mockAssignments = [...rows];
    if (routinesFail) mockGetRoutines.mockRejectedValue(new Error('Network Error'));
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('My routines')).toBeTruthy());
    const forest = forestButtons(view);
    expect(forest.length).toBeLessThanOrEqual(1);
    const plans = await view.findByLabelText('Workout plans');
    expect(view.getByText('Workout plans')).toBeTruthy();
    mockNavigate.mockClear();
    await fireEvent.press(plans);
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'ClientWorkoutViewer', initial: false });
  });
});
