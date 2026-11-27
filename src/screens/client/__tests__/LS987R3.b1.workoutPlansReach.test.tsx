/**
 * LS-987R3 B1 (m#987 review round 3, the owner's flow #203-E80 and the operator's ruling (2), REFINE-987R3.txt:85):
 * every client whose read holds a workout finds, on the Train tab, a control seen and spoken "Workout plans" that opens
 * Your workouts. Mounted in the real ClientNavigator (the harness of StyleLogging.r3.flow.test.tsx), today Wednesday
 * 18 November 2026. Each state below holds at least one workout and, at 316f94c7, draws no "Workout plans" control
 * (WorkoutScreen.tsx:726, main's condition kept).
 */
import React from 'react';
import { AppState, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

const mockFlags: Record<string, boolean> = { clientCalendar: true, communityTab: true, romanChat: false, clientTutorial: false, clientTrainV2: false };
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-11-18' }));
jest.mock('../../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
const mockUser = { id: 'c1', email: 'c1@example.test', role: 'client', coach_id: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));
jest.mock('../../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach', name: 'Sam Rivera' }] }) }));
jest.mock('../../../components/community/UnreadBadge', () => () => null);
jest.mock('../../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../../entitlements/dunning/UpdateCardScreen', () => () => null);
jest.mock('../../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), lightImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: async () => ({ data: [] }),
    getAll: async () => ({ data: [] }),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: async () => ({}),
  },
}));
let mockAssignments: unknown[] = [];
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: false, isError: false, isRefetching: false, refetch: async () => ({}) }),
}));
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

// Stub every leaf screen except the three this flow walks through.
const NAV = path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx');
const navSource = fs.readFileSync(NAV, 'utf8');
const REAL = ['../screens/client/WorkoutScreen', '../screens/client/ClientWorkoutViewerScreen', '../screens/client/workouts/YourWeeksScreen'];
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (REAL.includes(modulePath)) continue;
  jest.doMock(`../../../navigation/${modulePath}`, () => ({
    __esModule: true, default: () => <Text testID="destination">{modulePath}</Text>,
  }));
}
jest.doMock('../../../navigation/CommunityNavigator', () => ({
  __esModule: true, default: () => <Text testID="destination">CommunityNavigator</Text>,
}));
const ClientNavigator = require('../../../navigation/ClientNavigator').default;

type StateLike = { routes: Array<{ name: string; params?: object; state?: StateLike }> };
function you(state: StateLike | undefined) {
  return state?.routes.find((r) => r.name === 'MoreTab')?.state?.routes ?? [];
}
const youStack = (state: unknown) => you(state as StateLike).map((r) => r.name);

async function openTrain() {
  const ref = createNavigationContainerRef();
  const view = await render(<NavigationContainer ref={ref}><ClientNavigator /></NavigationContainer>);
  await fireEvent.press(view.getByLabelText('Train'));
  return { ref, view };
}
const at = (day: string) => `${day}T00:00:00.000Z`;
function w(name: string, day: string, done: boolean) {
  return { id: name, workout_plan_id: name, client_id: 'c1', assigned_by_coach_id: 'coach', scheduled_for: at(day),
    completed_at: done ? `${day}T18:00:00.000Z` : null, skipped_at: null, post_rpe: done ? 7 : null, post_notes: null,
    workout_plan: { id: name, coach_id: 'coach', name, type: 'strength', exercises: [], duration_estimate_minutes: 30,
      created_at: '', updated_at: '', archived_at: null } };
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockFlags.clientTrainV2 = false;
  mockAssignments = [];
});

const STATES: Array<[string, boolean, unknown[]]> = [
  ['two open and one done, clientTrainV2 off (the operator ruling)', false,
    [w('Upper body A', '2026-11-19', false), w('Lower body B', '2026-11-20', false), w('Done this week', '2026-11-16', true)]],
  ['two open and none done, clientTrainV2 off', false,
    [w('Upper body A', '2026-11-19', false), w('Lower body B', '2026-11-20', false)]],
  ['one open and none done, clientTrainV2 off (FLOW-B)', false, [w('Upper body A', '2026-11-19', false)]],
  ['only the workout Train features, clientTrainV2 on (FLOW-B)', true, [w('Upper body A', '2026-11-19', false)]],
];

describe('LS-987R3 B1: the owner\'s flow starts at a "Workout plans" button whenever the read holds a workout', () => {
  it.each(STATES)('%s: Train draws "Workout plans" and it opens Your workouts on the default window', async (_name, on, rows) => {
    mockFlags.clientTrainV2 = on;
    mockAssignments = rows;
    const { ref, view } = await openTrain();
    expect((await view.findAllByLabelText('Quick workout')).length).toBeGreaterThan(0);
    const plans = view.queryByLabelText('Workout plans');
    expect(plans).not.toBeNull();
    await fireEvent.press(plans!);
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer']));
    expect(you(ref.getRootState() as StateLike)[1].params).toBeUndefined();
    expect(view.getByRole('button', { name: 'Full program' })).toBeTruthy();
  });
});
