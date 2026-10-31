/**
 * B-LS-WORKOUT-4: a client can complete exercises in any order; the real
 * Roman card must read the set that was just completed, not the last row.
 */
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

const mockUser = { id: 'client-fixture', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, clientTrainV2: true },
}));
const mockNavigation = {
  navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), dispatch: jest.fn(),
  addListener: () => () => undefined,
};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: {
    routineName: 'My upper body workout',
    exercises: JSON.stringify([
      { exerciseId: 'seed:push-001', exerciseName: 'Barbell Bench Press', sets: 1, reps: 8, weightLbs: 80, restSec: 0 },
      { exerciseId: 'row-fixture', exerciseName: 'Barbell Row', sets: 1, reps: 6, weightLbs: 135, restSec: 0 },
    ]),
  } }),
}));
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: jest.fn() }) }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../services/api', () => ({
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
}));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(), settleQueuedWorkout: jest.fn(), releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

it('B-LS-WORKOUT-4 reads the latest completed set when the client returns to an earlier exercise', async () => {
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByTestId('set-done-1-0')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('set-done-1-0')); });
  expect(within(view.getByTestId('roman-voicelog-card')).getByText('135 pounds, 6 reps.')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
  expect(view.getByText('2 of 2 sets completed')).toBeTruthy();
  expect(within(view.getByTestId('roman-voicelog-card')).getByText('80 pounds, 8 reps.')).toBeTruthy();
});
