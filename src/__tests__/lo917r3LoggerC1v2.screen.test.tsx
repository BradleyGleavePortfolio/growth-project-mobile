/** LO-917R3 B-TESTs: the C1 v2 live logger at the real screen (ActiveWorkoutScreen, ExerciseCard, SetLogger). */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
const mockUser = { id: 'member-lo917r3', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Assigned pull ups', assignmentId: 'assigned-pull-ups', exercises: '[]' };
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
const mockCreate = jest.fn();
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({
    isPending: false,
    mutate: async (payload: unknown, options: { onSuccess: (value: unknown) => void }) =>
      options.onSuccess(await mockCreate(payload)),
  }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({})) },
}));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'queued-lo917r3', alreadySynced: false })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
const mockHistory = [{
  id: 'previous-weighted-pull-up',
  exercises: [{
    exercise_name: 'Pull Up', muscle_group: 'back', sets_completed: 1,
    weight_per_set: [20], reps_per_set: [8],
  }],
}];
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [] })) },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockHistory })) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'saved-lo917r3' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

/** Three coached exercises (A, B, C), nothing done yet. */
function threeBlocks() {
  const rows = [
    { exercise_external_id: 'seed:squat-001', sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, name: 'Back Squat' },
    { exercise_external_id: 'seed:bench-001', sets: 3, reps_or_duration_seconds: 6, weight_lbs: 155, name: 'Bench Press' },
    { exercise_external_id: 'seed:rdl-001', sets: 3, reps_or_duration_seconds: 8, weight_lbs: 135, name: 'Romanian Deadlift' },
  ];
  return buildActiveWorkoutExercises({ exercises: rows.map((r, order) => ({
    exercise_external_id: r.exercise_external_id, order, sets: r.sets,
    reps_or_duration_seconds: r.reps_or_duration_seconds, weight_lbs: r.weight_lbs, rest_seconds: 0,
    superset_group_id: null, notes: null,
  })) }).map((exercise, i) => ({ ...exercise, exerciseName: rows[i].name }));
}

it('LO-917R3 B1: a block not started yet is one line with its plan (C1 v2 "C  Romanian deadlift  3 × 8 · 135 lb"), not its set grid', async () => {
  // GOAL planning/MOCKUP3/C1/style-c-v2 C2_logger_ios390_100: only the block in
  // progress is open; a later block is its letter, its name and "3 × 8 · 135 lb".
  mockParams = { ...mockParams, exercises: JSON.stringify(threeBlocks()) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByTestId('exercise-active-0')).toBeTruthy());
  expect(view.queryByTestId('set-weight-2-0')).toBeNull();
  expect(view.queryByTestId('set-done-2-0')).toBeNull();
  expect(view.getByText(/3 × 8 · 135 lb/)).toBeTruthy();
});

it('LO-917R3 B2: the set row with the filled "As planned" fits the sage card on a 320 pt phone', async () => {
  // Widths are the real styles on the rendered row. The label's width is a
  // floor (half an em per letter); the real Inter SemiBold text is wider and
  // 130% text wider again, so a row over the floor cannot fit.
  mockParams = { ...mockParams, exercises: JSON.stringify(threeBlocks()) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByTestId('exercise-active-0')).toBeTruthy());
  const card = StyleSheet.flatten(view.getByTestId('exercise-active-0').props.style);
  const pill = view.getByTestId('set-done-0-0');
  const pillStyle = StyleSheet.flatten(pill.props.style);
  const label = view.getAllByText('As planned')[0];
  const labelStyle = StyleSheet.flatten(label.props.style);
  const weight = StyleSheet.flatten(view.getByTestId('set-weight-0-0').props.style);
  const reps = StyleSheet.flatten(view.getByTestId('set-reps-0-0').props.style);
  // The row's gap (setRow, 4) between the four cells.
  const gap = 4;
  const labelFloor = 0.5 * Number(labelStyle.fontSize) * 'As planned'.length;
  const pillWidth = 2 * Number(pillStyle.paddingHorizontal ?? 0) + Number(pillStyle.gap ?? 0) + 16 + labelFloor;
  const rowFloor = 36 + Number(weight.minWidth) + Number(reps.minWidth) + 3 * gap + pillWidth;
  const inside = 320 - 2 * Number(card.marginHorizontal) - 2 * Number(card.paddingHorizontal);
  expect(Number.isFinite(rowFloor) && Number.isFinite(inside)).toBe(true);
  expect(rowFloor).toBeLessThanOrEqual(inside);
});
