import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../../../utils/workout/buildActiveWorkout';
import { assignmentPrescription } from '../../../utils/workout/assignmentPrescription';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { lightTokens as sc } from '../../../theme/tokens';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
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
  default: ({ id, children }: { id?: string; children: React.ReactNode }) => {
    const { View: NativeView } = require('react-native');
    return <NativeView testID={id ? `tour-${id}` : undefined}>{children}</NativeView>;
  },
}));
let mockAssignment: ClientWorkoutAssignmentWithPlan;
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockAssignment, isLoading: false, isError: false,
    refetch: jest.fn(), isRefetching: false }),
}));
import WorkoutAssignmentDetailScreen from '../WorkoutAssignmentDetailScreen';

const names: Record<string, string> = { squat: 'Back squat', pull: 'Pull-up', push: 'Push-up' };
type Host = { props: { style?: never }; children?: (Host | string)[] | null };
function chipsOf(root: unknown): Host[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(chipsOf);
  const node = root as Host;
  return [
    ...(StyleSheet.flatten(node.props?.style)?.borderColor === sc.data.moss ? [node] : []),
    ...(node.children ?? []).flatMap(chipsOf),
  ];
}
const row = (order: number, id: string, group: string | null = null) => ({
  exercise_external_id: id, order, sets: 3, reps_or_duration_seconds: order === 2 ? 45 : 8,
  exercise_type: order === 2 ? 'timed' : 'reps', weight_lbs: order === 1 ? 95 : null,
  rest_seconds: 90, superset_group_id: group, notes: `Coach note ${order}`,
});
const cases = [
  { name: 'single rows', rows: [row(1, 'squat'), row(2, 'pull')], titles: ['Back squat', 'Pull-up'] },
  { name: 'superset first', rows: [row(1, 'pull', 's'), row(2, 'push', 's'), row(3, 'squat')],
    titles: ['Pull-up + Push-up', 'Back squat'] },
  { name: 'superset last', rows: [row(1, 'squat'), row(2, 'pull', 's'), row(3, 'push', 's')],
    titles: ['Back squat', 'Pull-up + Push-up'] },
  { name: 'noncontiguous group reused', rows: [row(1, 'pull', 's'), row(2, 'squat'), row(3, 'push', 's')],
    titles: ['Pull-up', 'Back squat', 'Push-up'] },
  { name: 'adjacent distinct supersets', rows: [row(1, 'pull', 's'), row(2, 'push', 's'),
    row(3, 'squat', 't'), row(4, 'pull', 't')], titles: ['Pull-up + Push-up', 'Back squat + Pull-up'] },
];

beforeEach(() => jest.clearAllMocks());

it.each(cases)('$name: one chip per block, every prescription and note, first-block tour and unchanged Start', async ({ rows, titles }) => {
  mockAssignment = {
    id: 'a-1', completed_at: null, roman_adjusted_sets: [{ order: 2, sets: 2 }],
    workout_plan: { id: 'plan', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55, exercises: rows },
  } as unknown as ClientWorkoutAssignmentWithPlan;
  const view = await render(<WorkoutAssignmentDetailScreen />);
  await view.findByText(titles[0]);
  const chips = chipsOf(view.toJSON());
  expect(chips).toHaveLength(titles.length);
  titles.forEach((title) => expect(view.getByText(title)).toBeTruthy());
  expect(within(view.getByTestId('tour-first-exercise')).getByText(titles[0])).toBeTruthy();
  for (const ex of rows) {
    const inner = within(view.getByTestId(`assignment-row-${ex.order}`));
    expect(inner.getByText(ex.notes)).toBeTruthy();
    expect(inner.getByText(/sets ×/)).toBeTruthy();
    expect(inner.queryByTestId(`assignment-adjusted-${ex.order}`) !== null).toBe(ex.order === 2);
  }
  await fireEvent.press(view.getByTestId('assignment-start'));
  const expected = buildActiveWorkoutExercises({ exercises: assignmentPrescription(mockAssignment).exercises })
    .map((exercise) => ({ ...exercise, exerciseName: names[exercise.exerciseId] }));
  expect(mockNavigate).toHaveBeenCalledWith('WorkoutTab', {
    screen: 'ActiveWorkout', initial: false,
    params: { routineId: 'plan', routineName: 'Full body A', assignmentId: 'a-1', exercises: JSON.stringify(expected) },
  });
});
