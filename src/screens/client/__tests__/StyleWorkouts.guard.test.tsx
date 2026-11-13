/**
 * STYLE-WORKOUTS-M guard: the C1 Style C v2 look on the exercise library, an exercise's page, the assigned workout
 * and the past-workout edit takes every colour from the theme (no hex, rgb or rgba literal in the screens or their
 * parts file), never clips or shrinks text that can grow with the phone's text size, and keeps every action at a
 * 44 pt floor (the shape of assignedWorkoutRedo133.test.tsx:108-113 and planStyleC.guard.test.tsx).
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { AxiosHeaders } from 'axios';
import { StyleSheet, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../api/exerciseCatalog', () => ({ exerciseCatalogApi: { browse: jest.fn(), getDetail: jest.fn() } }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, addListener: () => ({ remove: () => undefined }) }),
  VideoView: 'VideoView',
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', role: 'client' }) }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Barbell back squat with a long pause at the bottom of every rep' }, loading: false }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockAssignment, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { put: jest.fn(), get: jest.fn() } }));

import ExerciseDetailScreen from '../ExerciseDetailScreen';
import ExerciseLibraryScreen from '../ExerciseLibraryScreen';
import WorkoutAssignmentDetailScreen from '../WorkoutAssignmentDetailScreen';
import WorkoutHistoryEditScreen from '../WorkoutHistoryEditScreen';
import { exerciseCatalogApi } from '../../../api/exerciseCatalog';

const LONG = 'Barbell back squat with a long pause at the bottom of every rep';
const SCREENS = ['ExerciseDetailScreen.tsx', 'ExerciseLibraryScreen.tsx', 'WorkoutAssignmentDetailScreen.tsx',
  'WorkoutHistoryEditScreen.tsx'].map((f) => path.join(__dirname, '..', f));
const PARTS = path.join(__dirname, '../workouts/workoutStyleC.tsx');
const files = () => [...SCREENS, ...(fs.existsSync(PARTS) ? [PARTS] : [])];

const mockAssignment = {
  id: 'a-1', workout_plan_id: 'plan', client_id: 'client-1', assigned_by_coach_id: 'coach',
  scheduled_for: '2026-11-13T12:00:00Z', completed_at: null, post_rpe: null, post_notes: null, roman_adjusted_sets: [],
  workout_plan: { id: 'plan', coach_id: 'coach', name: LONG, type: 'strength', duration_estimate_minutes: 55,
    created_at: '', updated_at: '', archived_at: null,
    exercises: [{ id: 'r1', workout_plan_id: 'plan', exercise_external_id: 'squat', order: 1, sets: 3,
      reps_or_duration_seconds: 60, weight_lbs: 135, rest_seconds: 90, superset_group_id: null, notes: LONG }] },
};
const SAVED = { id: 'saved-1', workout_name: LONG, notes: '',
  exercises: [{ exercise_name: LONG, muscle_group: 'legs', sets_completed: 2, weight_per_set: [135, 135],
    reps_per_set: [5, 5], notes: '', rpe: 7 }] };
const response = <T,>(data: T) => ({ data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } });

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
// Text the screens own: a shared button's own label (src/ui PrimaryButton) and SetLogger's empty measuring text are
// the shared parts' rules, outside this job (listed under "Found, not fixed").
function textProblems(root: unknown) {
  const inButton = new Set<Host>();
  hosts(root).filter((n) => n.props.accessibilityRole === 'button').forEach((b) => hosts(b).forEach((n) => inButton.add(n)));
  return hosts(root).filter((n) => n.type === 'Text' && !inButton.has(n) && JSON.stringify(n.children) !== '[""]'
    && (n.props.numberOfLines || n.props.adjustsFontSizeToFit || n.props.allowFontScaling === false))
    .map((n) => JSON.stringify(n.children));
}
function smallActions(root: unknown) {
  const actions = hosts(root).filter((n) => n.props.accessibilityRole === 'button'
    || (typeof n.props.accessibilityLabel === 'string' && typeof n.props.onClick === 'function'));
  return actions.filter((b) => {
    const st = (StyleSheet.flatten(b.props.style as ViewStyle) ?? {}) as ViewStyle;
    return !(typeof st.minHeight === 'number' && st.minHeight >= 44)
      && !(typeof st.height === 'number' && st.height >= 44);
  }).map((b) => String(b.props.accessibilityLabel ?? b.props.testID ?? 'button'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Stack = createNativeStackNavigator<any>();
const mount = (name: string, component: React.ComponentType<never>, initialParams?: object) => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 } }}>
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name={name} component={component as React.ComponentType} initialParams={initialParams} />
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen as React.ComponentType} />
      </Stack.Navigator>
    </NavigationContainer>
  </SafeAreaProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(exerciseCatalogApi.getDetail).mockResolvedValue(response({ id: 'squat', slug: 'squat', name: LONG,
    primaryMuscle: 'quads', category: 'legs', secondaryMuscles: ['glutes'], equipment: ['barbell'], difficulty: 'beginner',
    instructions: [LONG], playbackUrl: null, gifUrl: null }) as never);
  jest.mocked(exerciseCatalogApi.browse).mockResolvedValue(response({ items: [{ id: 'squat', slug: 'squat', name: LONG,
    primaryMuscle: 'quads', category: 'legs', secondaryMuscles: [], equipment: ['barbell'], difficulty: 'beginner' }],
  nextCursor: null, total: 1 }) as never);
});

it('no hex, rgb or rgba colour literal in the four screens or their parts file', () => {
  for (const file of files()) {
    const src = fs.readFileSync(file, 'utf8');
    expect({ file: path.basename(file), hits: src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [] })
      .toEqual({ file: path.basename(file), hits: [] });
  }
});

it('no line clamp, shrink-to-fit or fixed text size in the four screens or their parts file', () => {
  for (const file of files()) {
    const src = fs.readFileSync(file, 'utf8');
    expect({ file: path.basename(file), hits: src.match(/numberOfLines|adjustsFontSizeToFit|allowFontScaling=\{false\}/g) ?? [] })
      .toEqual({ file: path.basename(file), hits: [] });
  }
});

it.each([
  ['the exercise page', 'Detail', ExerciseDetailScreen, { idOrSlug: 'squat' }],
  ['the library', 'Library', ExerciseLibraryScreen, undefined],
  ['the assigned workout', 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' }],
  ['the past-workout edit', 'Edit', WorkoutHistoryEditScreen, { workout: JSON.stringify(SAVED) }],
] as const)('%s at 320 pt: a long name stays whole and every action keeps a 44 pt floor', async (_label, name, component, params) => {
  const view = await mount(name, component as React.ComponentType<never>, params);
  expect((await view.findAllByText(LONG)).length).toBeGreaterThan(0);
  expect(textProblems(view.toJSON())).toEqual([]);
  expect(smallActions(view.toJSON())).toEqual([]);
});
