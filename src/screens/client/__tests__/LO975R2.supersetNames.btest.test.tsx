/**
 * LO-975R2 B-TEST (agent 204): inside a superset block, each exercise's own prescription, coach mark and coach
 * note must still say which exercise they belong to. Main and the round-1 head drew the name inside every
 * assignment-row-<order> (assignmentSnapshot151.test.tsx:110 pins it for a single row); at 0f60d075 the superset's
 * inner rows drop it (WorkoutAssignmentDetailScreen.tsx:244), so "2 sets × 8 reps / Updated by your coach / Use a
 * slow lowering." names no exercise. Fails at 0f60d0757c9f5af91a18d297867b67ac92799f34.
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: jest.fn() }) }),
  useRoute: () => ({ params: { assignmentId: 'a-1' } }),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({
  CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true, null],
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat', pull: 'Pull-up', push: 'Push-up' }, loading: false }),
}));
jest.mock('../../../components/tutorial/TutorialTarget', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
let mockAssignment: ClientWorkoutAssignmentWithPlan;
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockAssignment, isLoading: false, isError: false,
    refetch: jest.fn(), isRefetching: false }),
}));
import WorkoutAssignmentDetailScreen from '../WorkoutAssignmentDetailScreen';

const row = (order: number, id: string, reps: number, notes: string, group: string | null = null) => ({
  exercise_external_id: id, order, sets: 3, reps_or_duration_seconds: reps, unit: 'reps', weight_lbs: null,
  rest_seconds: 90, superset_group_id: group, notes,
});

it("inside a superset block each exercise's prescription, coach mark and note sit under that exercise's own name", async () => {
  // A single row, then a Pull-up + Push-up superset whose second exercise the coach changed (2 sets, was 3).
  mockAssignment = {
    id: 'a-1', completed_at: null, roman_adjusted_sets: [{ order: 3, sets: 2 }],
    workout_plan: { id: 'plan', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55,
      exercises: [row(1, 'squat', 5, 'Brace first.'), row(2, 'pull', 8, 'Keep the shoulders down.', 'ss-1'),
        row(3, 'push', 12, 'Use a slow lowering.', 'ss-1')] },
  } as unknown as ClientWorkoutAssignmentWithPlan;
  const view = await render(<WorkoutAssignmentDetailScreen />);
  await view.findByText('Pull-up + Push-up');
  const expected: Array<[number, string, RegExp, string]> = [
    [1, 'Back squat', /^3 sets × 5 reps/, 'Brace first.'],
    [2, 'Pull-up', /^3 sets × 8 reps/, 'Keep the shoulders down.'],
    [3, 'Push-up', /^2 sets × 12 reps/, 'Use a slow lowering.'],
  ];
  for (const [order, name, prescription, note] of expected) {
    const inner = within(view.getByTestId(`assignment-row-${order}`));
    expect(inner.getByText(prescription)).toBeTruthy();
    expect(inner.getByText(note)).toBeTruthy();
    // The drawn joined heading alone does not say which line, mark or note is whose.
    expect(inner.getByText(name)).toBeTruthy();
  }
  expect(within(view.getByTestId('assignment-row-3')).getByTestId('assignment-adjusted-3')).toBeTruthy();
});
