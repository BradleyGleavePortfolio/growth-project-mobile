/**
 * LO-975R1 B1 (lens test, m#975): operator ruling (5) for STYLE-WORKOUTS-M builds a superset as drawn, one block
 * under one letter as C2_today draws it ("Pull-up + Push-up" beside one chip D), as TrainDay does. Fails at
 * ddc95906 (two rows, two D chips). The row test ids, the tour's first row and Start's payload must stay.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true, null] }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', role: 'client' }) }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat', bench: 'Bench press', rdl: 'Romanian deadlift',
    pull: 'Pull-up', push: 'Push-up' }, loading: false }),
}));
let mockAssignment: unknown;
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockAssignment, isLoading: false, isError: false,
    refetch: jest.fn(), isRefetching: false }),
}));

import WorkoutAssignmentDetailScreen from '../WorkoutAssignmentDetailScreen';
import { lightTokens as sc } from '../../../theme/tokens';

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | Host[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host | Host[] | null);
  return out;
}
const textOf = (n: Host): string => (n.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const row = (order: number, id: string, extra: object = {}) => ({
  id: `r${order}`, workout_plan_id: 'plan', exercise_external_id: id, order, sets: 3, reps_or_duration_seconds: 8,
  weight_lbs: null, rest_seconds: 90, superset_group_id: null, notes: null, ...extra,
});
// C2_today: A, B, C single rows, D a two-exercise superset drawn as one block.
mockAssignment = {
  id: 'a-1', workout_plan_id: 'plan', client_id: 'client-1', assigned_by_coach_id: 'coach',
  scheduled_for: '2026-11-13T12:00:00Z', completed_at: null, post_rpe: null, post_notes: null,
  workout_plan: { id: 'plan', coach_id: 'coach', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55,
    created_at: '', updated_at: '', archived_at: null,
    exercises: [row(1, 'squat'), row(2, 'bench'), row(3, 'rdl'),
      row(4, 'pull', { superset_group_id: 'ss-1' }), row(5, 'push', { superset_group_id: 'ss-1' })] },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Stack = createNativeStackNavigator<any>();

it('a superset is one block under one letter, names joined as C2_today and TrainDay draw it (ruling 5)', async () => {
  const view = await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Assigned" component={WorkoutAssignmentDetailScreen as React.ComponentType}
            initialParams={{ assignmentId: 'a-1' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
  await view.findByText(/Back squat/);
  const chips = hosts(view.toJSON()).filter((n) => StyleSheet.flatten(n.props.style as never)?.borderColor === sc.data.moss);
  expect(chips.map(textOf)).toEqual(['A', 'B', 'C', 'D']);
  expect(view.getByText('Pull-up + Push-up')).toBeTruthy();
  // Kept as they are at the head: one test id per exercise.
  for (const order of [1, 2, 3, 4, 5]) expect(view.getByTestId(`assignment-row-${order}`)).toBeTruthy();
});
