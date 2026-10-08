// B1 / B-524-SOL-129-1: keep the lazy tab roots below Home's workout targets.
// Real ClientNavigator, Home, assignment detail and ActiveWorkout; other leaves are shallow.
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Text } from 'react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadActiveWorkoutSession, saveActiveWorkoutSession } from '../../storage/activeWorkoutSession';
import { getTodayString } from '../../utils/date';
import type { EntitlementStatus } from '../../entitlements/EntitlementProvider';

const mockUser = { id: 'home-entry-client', role: 'client', coach_id: 'coach', profile: {} };
const mockAssignments = jest.fn();
const mockAssignment = {
  id: 'pending-assignment', completed_at: null, post_rpe: null,
  workout_plan: {
    id: 'plan-130', name: 'Foundations', type: 'strength', duration_estimate_minutes: 30,
    exercises: [{
      id: 'prescribed-push', exercise_external_id: 'push', order: 1, sets: 3,
      reps_or_duration_seconds: 8, weight_lbs: null, rest_seconds: 60, notes: null,
    }],
  },
};
const mockDay = {
  foodLogs: [], dailyTotals: {}, waterOz: 0, isLoading: false, loadError: null,
  selectedDate: getTodayString(), hasLoadedDay: true,
  loadDayData: jest.fn(), loadProfile: jest.fn(),
};
const mockEntitlement = {
  entitlementActive: true,
  confirmedActive: true,
  status: 'active' as EntitlementStatus,
};
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => mockEntitlement,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../config/featureFlags', () => ({
  featureFlags: { clientCalendar: true, communityTab: true, romanChat: false },
}));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: jest.fn() }) }));
jest.mock('../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({
    data: mockAssignment, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(),
  }),
}));
jest.mock('../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { push: 'Push-up' }, loading: false }),
}));
jest.mock('../../store/clientStore', () => ({ useClientStore: () => mockDay }));
jest.mock('../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../services/api', () => ({ workoutApi: { getAll: async () => ({ data: [] }) } }));
jest.mock('../../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: () => mockAssignments(), completeMyAssignment: jest.fn() },
}));
jest.mock('../../db/workoutDb', () => ({ getAllExercises: async () => [] }));
jest.mock('../../offline', () => ({
  queueWorkout: jest.fn(), settleQueuedWorkout: jest.fn(),
  releaseQueuedWorkout: jest.fn(), triggerSync: jest.fn(),
}));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../lib/profileCompletion', () => ({
  getProfileCompletion: () => ({ isComplete: true, missing: [], percentComplete: 100 }),
  summarizeMissing: () => '',
}));
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => function UpdateCard() { return null; });
jest.mock('../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../components/home/HomeHeaderActions', () => () => null);
jest.mock('../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../components/home/FullMacrosIntroCard', () => () => null);
jest.mock('../../components/coachless/CoachlessHomeSlot', () => () => null);
jest.mock('../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../components/PendingInviteBanner', () => () => null);
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(),
    heavyImpact: jest.fn(), warning: jest.fn(), success: jest.fn(), error: jest.fn(),
  },
}));

const navSource = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (['/HomeScreen', '/ActiveWorkoutScreen', '/WorkoutAssignmentDetailScreen']
    .some((screen) => modulePath.endsWith(screen))) continue;
  jest.doMock(`../${modulePath}`, () => ({
    __esModule: true, default: function LeafScreen() { return <Text>{modulePath}</Text>; },
  }));
}
jest.doMock('../CommunityNavigator', () => ({
  __esModule: true, default: function Community() { return null; },
}));
const ClientNavigator = require('../ClientNavigator').default;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAssignments.mockResolvedValue([]);
  Object.assign(mockEntitlement, { entitlementActive: true, confirmedActive: true, status: 'active' });
});

it('inactive Home → View access → Membership → Back retains the You menu', async () => {
  Object.assign(mockEntitlement, { entitlementActive: false, confirmedActive: false, status: 'inactive' });
  const navigation = createNavigationContainerRef<ParamListBase>();
  const view = await render(<NavigationContainer ref={navigation}><ClientNavigator /></NavigationContainer>);
  await fireEvent.press(await view.findByLabelText('View access'));
  expect(await view.findByText('../screens/client/MembershipScreen')).toBeTruthy();
  expect(navigation.getRootState().routes.find((route) => route.name === 'MoreTab')?.state?.routes.map((route) => route.name))
    .toEqual(['MoreIndex', 'Membership']);
  await act(async () => navigation.goBack());
  expect(await view.findByText('../screens/client/MoreScreen')).toBeTruthy();
  expect(mockAssignments).not.toHaveBeenCalled();
});

it('Resume → discard the untouched session by leaving → Train opens the workout list', async () => {
  // Main removed the separate Discard action: Leave releases an untouched session.
  // Exercise the real replacement handler rather than inventing a discarded UI path.
  await saveActiveWorkoutSession(mockUser.id, {
    routineName: 'Saved strength', exercisesJson: '[]', sessionExercises: [],
    startedAtMs: Date.now(), assignmentId: 'saved-assignment', idempotencyKey: 'saved-key',
  });
  const navigation = createNavigationContainerRef<ParamListBase>();
  const view = await render(<NavigationContainer ref={navigation}><ClientNavigator /></NavigationContainer>);
  expect(navigation.getRootState().routes.find((route) => route.name === 'WorkoutTab')?.state).toBeUndefined();

  await fireEvent.press(await view.findByLabelText('Resume workout'));
  expect(await view.findByText('Saved strength')).toBeTruthy();
  await fireEvent.press(await view.findByLabelText('Leave workout'));
  await waitFor(async () => expect(await loadActiveWorkoutSession(mockUser.id)).toBeNull());
  await fireEvent.press(view.getByLabelText('Train'));

  await waitFor(() => expect(
    navigation.getRootState().routes.find((route) => route.name === 'WorkoutTab')?.state?.routes.map((route) => route.name),
  ).toEqual(['WorkoutMain']));
  expect(await view.findByText('../screens/client/WorkoutScreen')).toBeTruthy();
  expect(view.queryByLabelText('Leave workout')).toBeNull();
});

it('Start → Back → You retains the unopened You menu below the assignment', async () => {
  mockAssignments.mockResolvedValue([
    { id: 'pending-assignment', completed_at: null, workout_plan: { name: 'Foundations' } },
  ]);
  const navigation = createNavigationContainerRef<ParamListBase>();
  const view = await render(<NavigationContainer ref={navigation}><ClientNavigator /></NavigationContainer>);
  expect(navigation.getRootState().routes.find((route) => route.name === 'MoreTab')?.state).toBeUndefined();

  await fireEvent.press(await view.findByLabelText('Start Foundations'));
  expect(await view.findByTestId('assignment-start')).toBeTruthy();
  await act(async () => navigation.goBack()); // Native Back/gesture uses this same router action.
  await fireEvent.press(view.getByLabelText('Profile and more'));

  await waitFor(() => expect(
    navigation.getRootState().routes.find((route) => route.name === 'MoreTab')?.state?.routes.map((route) => route.name),
  ).toEqual(['MoreIndex']));
  expect(await view.findByText('../screens/client/MoreScreen')).toBeTruthy();
  expect(view.queryByTestId('assignment-start')).toBeNull();
});

it('Home Start → real assignment Start → Leave → Train opens the workout list', async () => {
  mockAssignments.mockResolvedValue([mockAssignment]);
  const navigation = createNavigationContainerRef<ParamListBase>();
  const view = await render(<NavigationContainer ref={navigation}><ClientNavigator /></NavigationContainer>);
  expect(navigation.getRootState().routes.find((route) => route.name === 'WorkoutTab')?.state).toBeUndefined();

  await fireEvent.press(await view.findByLabelText('Start Foundations'));
  await fireEvent.press(await view.findByTestId('assignment-start'));
  expect(await view.findByText('Push-up')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Leave workout'));
  await waitFor(async () => expect(await loadActiveWorkoutSession(mockUser.id)).toBeNull());
  await fireEvent.press(view.getByLabelText('Train'));

  await waitFor(() => expect(
    navigation.getRootState().routes.find((route) => route.name === 'WorkoutTab')?.state?.routes.map((route) => route.name),
  ).toEqual(['WorkoutMain']));
  expect(await view.findByText('../screens/client/WorkoutScreen')).toBeTruthy();
  expect(view.queryByLabelText('Leave workout')).toBeNull();
});
