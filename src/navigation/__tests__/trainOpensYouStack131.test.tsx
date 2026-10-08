/**
 * m#542 B1 (LN-OPUS-B-130) and B-542-SOL-130-1: Train opens coach workouts in
 * the You tab. You is lazy, so for a client who has not opened You since the
 * app started, the first navigate mounts its stack. Without `initial: false`
 * that stack starts with only the coach workout screen and the You menu
 * (Settings, billing, sign out) cannot be reached until the app restarts.
 *
 * The real ClientNavigator (real tab and stack routers) and the real
 * WorkoutScreen; every other leaf screen is a stub that prints its module.
 */
import React from 'react';
import { AppState, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../config/featureFlags', () => ({
  featureFlags: { clientCalendar: true, communityTab: true, romanChat: false, clientTutorial: false },
}));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
// One stable user object, as the real hook returns between renders.
const mockUser = { id: 'c1', email: 'c1@example.test', role: 'client', coach_id: 'coach' };
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => () => null);
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// WorkoutScreen's data: the same doubles as WorkoutScreen.calm130.test.tsx.
jest.mock('../../services/api', () => ({
  workoutApi: {
    getRoutines: async () => ({ data: [] }),
    getAll: async () => ({ data: [] }),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: async () => ({}),
  },
}));
let mockAssignments: Array<{ id: string; completed_at: string | null; workout_plan: { name: string } }> = [];
jest.mock('../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, refetch: async () => ({}) }),
}));
jest.mock('../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../offline', () => ({
  countQueuedWorkouts: async () => 0,
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);

// Stub every leaf screen except the Train tab's WorkoutScreen.
const navSource = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (modulePath === '../screens/client/WorkoutScreen') continue;
  jest.doMock(`../${modulePath}`, () => ({
    __esModule: true, default: () => <Text testID="destination">{modulePath}</Text>,
  }));
}
jest.doMock('../CommunityNavigator', () => ({
  __esModule: true, default: () => <Text testID="destination">CommunityNavigator</Text>,
}));
const ClientNavigator = require('../ClientNavigator').default;

const YOU_MENU = '../screens/client/MoreScreen';
type StateLike = { routes: Array<{ name: string; params?: object; state?: StateLike }> };
/** Route names in the You tab's stack (empty while it has never mounted). */
function youStack(state: StateLike | undefined): string[] {
  const you = state?.routes.find((r) => r.name === 'MoreTab');
  return (you?.state?.routes ?? []).map((r) => r.name);
}

async function openTrain() {
  const ref = createNavigationContainerRef();
  const view = await render(<NavigationContainer ref={ref}><ClientNavigator /></NavigationContainer>);
  await fireEvent.press(view.getByLabelText('Train'));
  // The client has not opened You: its stack is not mounted yet.
  expect(youStack(ref.getRootState() as StateLike)).toEqual([]);
  return { ref, view };
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockAssignments = [];
});

describe('Train opens coach workouts above the You menu (m#542 B1 / B-542-SOL-130-1)', () => {
  it('All coach workouts: the You menu sits under the list; a second tap on You returns to it', async () => {
    mockAssignments = [
      { id: 'a0', completed_at: '2026-10-01T10:00:00Z', workout_plan: { name: 'Done a0' } },
      { id: 'a9', completed_at: '2026-10-02T10:00:00Z', workout_plan: { name: 'Done a9' } },
    ];
    const { ref, view } = await openTrain();
    await fireEvent.press(await view.findByLabelText('All coach workouts'));
    await waitFor(() => expect(youStack(ref.getRootState() as StateLike)).toEqual(['MoreIndex', 'ClientWorkoutViewer']));
    expect(view.getByText('../screens/client/ClientWorkoutViewerScreen')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Profile and more'));
    await waitFor(() => expect(youStack(ref.getRootState() as StateLike)).toEqual(['MoreIndex']));
    expect(view.getByText(YOU_MENU)).toBeTruthy();
  });

  it('one pending coach workout: the detail opens above the You menu and Back returns to it', async () => {
    mockAssignments = [{ id: 'a1', completed_at: null, workout_plan: { name: 'Upper body A' } }];
    const { ref, view } = await openTrain();
    await fireEvent.press(await view.findByLabelText('Open assigned workout: Upper body A'));
    await waitFor(() => expect(youStack(ref.getRootState() as StateLike)).toEqual(['MoreIndex', 'WorkoutAssignmentDetail']));
    const you = (ref.getRootState() as StateLike).routes.find((r) => r.name === 'MoreTab');
    expect(you?.state?.routes[1].params).toEqual({ assignmentId: 'a1' });

    await act(async () => {
      ref.goBack();
    });
    await waitFor(() => expect(youStack(ref.getRootState() as StateLike)).toEqual(['MoreIndex']));
    expect(view.getByText(YOU_MENU)).toBeTruthy();
  });
});
