/** C1 v2's compact logger is an owner-picked layout, not an optional sketch. */
import React from 'react';
import { Alert } from 'react-native';
import { cleanup, render, waitFor } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';
jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'ls-r3-member', role: 'student', coach_id: 'ls-r3-coach' }),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Strength A', assignmentId: 'ls-r3-assignment', exercises: '[]' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../components/tutorial/TutorialTarget', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/HapticPressable', () => ({
  __esModule: true, default: jest.requireActual('react-native').Pressable,
}));
jest.mock('../components/share/ShareSheet', () => ({
  __esModule: true, default: () => null, ShareLink: () => null,
}));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({ isPending: false, mutate: jest.fn() }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({})) },
}));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'ls-r3-queue', alreadySynced: false })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(), triggerSync: jest.fn(async () => undefined),
}));
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: jest.fn(async () => ({ data: [] })) },
  workoutApi: { getAll: jest.fn(async () => ({ data: [{
    id: 'ls-r3-previous', exercises: [{
      exercise_name: 'Bench Press', sets_completed: 1,
      weight_per_set: [155], reps_per_set: [6],
    }],
  }] })) },
}));
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

async function show() {
  const exercises = buildActiveWorkoutExercises({ exercises: [
    { exercise_external_id: 'seed:bench', order: 0, sets: 3,
      reps_or_duration_seconds: 6, weight_lbs: 155, rest_seconds: 0,
      superset_group_id: null, notes: null },
    { exercise_external_id: 'seed:row', order: 1, sets: 2,
      reps_or_duration_seconds: 8, weight_lbs: 80, rest_seconds: 0,
      superset_group_id: null, notes: null },
  ] }).map((row, i) => ({ ...row, exerciseName: i ? 'Barbell Row' : 'Bench Press' }));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByLabelText('Use previous set 1: 155 pounds, 6 reps')).toBeTruthy());
  return view;
}
beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined));
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it('LS-917R3 B2: C1 v2 names the active block and total blocks, not just an exercise number', async () => {
  const view = await show();
  expect(view.getByText(/block\s+a\s+of\s+b/i)).toBeTruthy();
});
it('LS-917R3 B2: C1 v2 shows the session set progress beside the block progress', async () => {
  const view = await show();
  expect(view.getByText(/0\s*\/\s*5\s+sets/i)).toBeTruthy();
});
it('LS-917R3 B2: prescribed live sets expose the compact weight-unit-times-reps row', async () => {
  const view = await show();
  expect(view.getAllByText(/155\s*lb\s*[×x]\s*6/).length).toBeGreaterThan(0);
});
