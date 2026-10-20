// TRAIN-ROOT-RETURN: finishing a workout returns to the one Train root.
// Real ClientNavigator (real tabs and native stacks) and the real ActiveWorkout
// screen; other leaves are shallow. With romanChat on, the finish used to push
// a second WorkoutMain over the finished workout instead of returning.
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, Text } from 'react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type NavigationState,
  type ParamListBase,
} from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUser = { id: 'train-root-client', role: 'client', coach_id: 'coach', profile: {} };
const mockFlags = { clientCalendar: true, communityTab: true, romanChat: false };
let mockMutateOptions: { onSuccess?: (data: unknown) => void } | null = null;
const mockLoadSession = jest.fn();

jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../hooks/useApi', () => ({
  useCreateWorkout: () => ({
    mutate: (_vars: unknown, options: typeof mockMutateOptions) => { mockMutateOptions = options; },
  }),
}));
jest.mock('../../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: () => mockLoadSession(),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../../db/workoutDb', () => ({ getAllExercises: async () => [] }));
jest.mock('../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn() } }));
jest.mock('../../services/api', () => ({ workoutApi: { getAll: async () => ({ data: [] }) } }));
jest.mock('../../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'q1', alreadySynced: false, serverId: null })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => function UpdateCard() { return null; });
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(),
    heavyImpact: jest.fn(), warning: jest.fn(), success: jest.fn(), error: jest.fn(),
  },
}));

const navSource = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (modulePath.endsWith('/ActiveWorkoutScreen')) continue;
  jest.doMock(`../${modulePath}`, () => ({
    __esModule: true, default: function LeafScreen() { return <Text>{modulePath}</Text>; },
  }));
}
jest.doMock('../CommunityNavigator', () => ({ __esModule: true, default: function Community() { return null; } }));
const ClientNavigator = require('../ClientNavigator').default;

const trainStack = (ref: ReturnType<typeof createNavigationContainerRef<ParamListBase>>) =>
  ref.getRootState().routes.find((route) => route.name === 'WorkoutTab')?.state as NavigationState | undefined;

beforeEach(() => {
  mockMutateOptions = null;
  mockLoadSession.mockResolvedValue({
    isStale: false,
    session: {
      version: 1, startedAtMs: Date.now() - 300000, updatedAtMs: Date.now() - 300000,
      routineName: 'Push Day', exercisesJson: '[]', idempotencyKey: '00000000-0000-4000-8000-000000000162',
      sessionExercises: [{ exerciseId: 'ex-1', exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, completed: true }] }],
    },
  });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    (buttons ?? []).find((b) => b.text === 'Resume' || b.text === 'Finish')?.onPress?.();
  });
});
afterEach(() => jest.restoreAllMocks());

it.each([true, false])('finishing a workout (romanChat=%s) leaves one WorkoutMain in the Train stack', async (roman) => {
  mockFlags.romanChat = roman;
  const ref = createNavigationContainerRef<ParamListBase>();
  const view = await render(<NavigationContainer ref={ref}><ClientNavigator /></NavigationContainer>);
  await act(async () => ref.navigate('WorkoutTab'));
  await act(async () => ref.navigate('WorkoutTab', {
    screen: 'ActiveWorkout',
    params: { routineName: 'Push Day', exercises: '[]', assignmentId: null },
  }));
  expect(trainStack(ref)?.routes.map((route) => route.name)).toEqual(['WorkoutMain', 'ActiveWorkout']);
  await waitFor(() => expect(view.getByText('Push Day')).toBeTruthy());

  await act(async () => { await fireEvent.press(view.getByText('Finish workout')); });
  await waitFor(() => expect(mockMutateOptions?.onSuccess).toBeTruthy());
  await act(async () => mockMutateOptions!.onSuccess!({ id: 'server-123' }));

  const routes = trainStack(ref)!.routes;
  expect(routes.map((route) => route.name)).toEqual(['WorkoutMain']);
  expect((routes[0].params as { justCompletedId?: string } | undefined)?.justCompletedId)
    .toBe(roman ? 'server-123' : undefined);
});
