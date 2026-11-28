/**
 * REFINE-987R3 (m#987 round 3, owner #203-E80): the flow in the real ClientNavigator (real tab and stack routers, as
 * trainOpensYouStack131.test.tsx mounts it): Train > "Workout plans" > Your workouts over the You menu > "Full program" >
 * Your weeks > a week row > that week's workouts; Back returns the same way, one page at a time. The real WorkoutScreen,
 * ClientWorkoutViewerScreen and YourWeeksScreen; every other leaf screen is a stub that prints its module.
 * The gates: YourWeeks is wrapped OWN and is in the payment lockout's open set; the Train row reads "Workout plans".
 */
import React from 'react';
import { AppState, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
const { OPEN_FOR_OWN_LOGGING } = require('../../../entitlements/dunning/DunningLockoutProvider');

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
  // Today Wednesday 18 November 2026: one done this week, one open this week, one done three weeks ago.
  mockAssignments = [w('Done this week', '2026-11-16', true), w('Open this week', '2026-11-19', false), w('Done earlier', '2026-11-03', true)];
});

describe('G. the flow in the real navigator (owner #203-E80)', () => {
  it('Train > Workout plans > Full program > an Earlier week; Back returns through Your weeks and the list to the You menu', async () => {
    const { ref, view } = await openTrain();
    expect(view.queryByLabelText('All coach workouts')).toBeNull();
    await fireEvent.press(await view.findByLabelText('Workout plans'));
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer']));
    expect(view.getByText('Your workouts')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Open workout Open this week' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Open workout Done earlier' })).toBeNull();

    await fireEvent.press(view.getByRole('button', { name: 'Full program' }));
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer', 'YourWeeks']));
    expect(view.getByText('Your weeks')).toBeTruthy();

    await fireEvent.press(view.getByTestId('earlier-2026-11-02'));
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer', 'YourWeeks', 'ClientWorkoutViewer']));
    expect(you(ref.getRootState() as StateLike)[3].params).toEqual({ week: '2026-11-02' });
    expect(view.getByRole('button', { name: 'Open workout Done earlier' })).toBeTruthy();
    expect(view.getByText('Nov 2 to 8')).toBeTruthy();

    await act(async () => { ref.goBack(); });
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer', 'YourWeeks']));
    await act(async () => { ref.goBack(); });
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer']));
    expect(you(ref.getRootState() as StateLike)[1].params).toBeUndefined();
    await act(async () => { ref.goBack(); });
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex']));
    expect(view.getByText('../screens/client/MoreScreen')).toBeTruthy();
  });

  it("a card on the week's page opens WorkoutAssignmentDetail with its id, above that page", async () => {
    const { ref, view } = await openTrain();
    await fireEvent.press(await view.findByLabelText('Workout plans'));
    await fireEvent.press(await view.findByRole('button', { name: 'Full program' }));
    await fireEvent.press(await view.findByTestId('earlier-2026-11-02'));
    await fireEvent.press(await view.findByRole('button', { name: 'Open workout Done earlier' }));
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(
      ['MoreIndex', 'ClientWorkoutViewer', 'YourWeeks', 'ClientWorkoutViewer', 'WorkoutAssignmentDetail']));
    expect(you(ref.getRootState() as StateLike)[4].params).toEqual({ assignmentId: 'Done earlier' });
  });

  it("a session on Your weeks' card opens its workout above Your weeks", async () => {
    const { ref, view } = await openTrain();
    await fireEvent.press(await view.findByLabelText('Workout plans'));
    await fireEvent.press(await view.findByRole('button', { name: 'Full program' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Open workout Open this week, Thu 19, planned' }));
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer', 'YourWeeks', 'WorkoutAssignmentDetail']));
    expect(you(ref.getRootState() as StateLike)[3].params).toEqual({ assignmentId: 'Open this week' });
  });
});

describe('H. the gates and the row', () => {
  it('YourWeeks is registered with a withProtectedScreen(YourWeeksScreen, OWN) component and is open while a payment is held', () => {
    expect(navSource).toMatch(/const ProtectedYourWeeksScreen = withProtectedScreen\(YourWeeksScreen, OWN\);/);
    expect(navSource).toMatch(/<MoreStackNav\.Screen name="YourWeeks" component=\{ProtectedYourWeeksScreen\} \/>/);
    expect(OPEN_FOR_OWN_LOGGING.has('YourWeeks')).toBe(true);
    expect(OPEN_FOR_OWN_LOGGING.has('ClientWorkoutViewer')).toBe(true);
  });

  it('the Train row reads "Workout plans" in the code, never "All coach workouts"', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'WorkoutScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/All coach workouts/);
    expect(src).toMatch(/<QuietRow title="Workout plans" [^\n]*label="Workout plans" [^\n]*testID="workout-all-coach-workouts"/);
  });

  it.each([false, true])('with clientTrainV2 %s the Train row is found by "Workout plans" and opens Your workouts', async (on) => {
    mockFlags.clientTrainV2 = on;
    const { ref, view } = await openTrain();
    const row = await view.findByLabelText('Workout plans');
    expect(view.queryByLabelText('All coach workouts')).toBeNull();
    await fireEvent.press(row);
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'ClientWorkoutViewer']));
  });
});
