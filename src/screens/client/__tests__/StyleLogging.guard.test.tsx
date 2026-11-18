/**
 * STYLE-LOGGING-M guard: the client's list of assigned workouts, the routine builder and the coach's program assign
 * take every colour from the theme (no hex, rgb or rgba literal in code; comments are skipped, so a ruling id such as
 * "#197-E10" in a comment is not a colour), never clip or shrink text that can grow with the phone's text size, and
 * keep every pressable at a 44 pt floor at 320 pt with long names (the shape of StyleWorkouts.guard.test.tsx).
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LONG = 'Single-arm dumbbell Romanian deadlift with a slow three-second lowering';
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { routineId: 'routine' } }),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(), data: [{
    id: 'a-1', workout_plan_id: 'plan', client_id: 'client', assigned_by_coach_id: 'coach',
    scheduled_for: '2026-11-13T12:00:00Z', completed_at: null, post_rpe: null, post_notes: null,
    workout_plan: { id: 'plan', coach_id: 'coach', name: LONG, type: 'strength', duration_estimate_minutes: 55,
      created_at: '', updated_at: '', archived_at: null, exercises: [{ id: 'r1', workout_plan_id: 'plan',
        exercise_external_id: 'long', order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 135, rest_seconds: 90,
        superset_group_id: null, notes: null }] } }] }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => ({ names: { long: LONG }, loading: false }) }));
const mockRoutines = [{ id: 'routine', name: LONG, exercises: [{ exercise_id: 'long', exercise_name: LONG,
  default_sets: 3, default_reps: 10, default_rest_seconds: 60, muscle_group: 'LEGS' }] }];
jest.mock('../../../hooks/useApi', () => ({
  useRoutines: () => ({ data: mockRoutines }),
  useCreateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteRoutine: () => ({ mutate: jest.fn() }),
}));
jest.mock('../../../db/workoutDb', () => ({ getAllExercises: async () => [{ id: 'long', name: LONG, muscle: 'legs', equipment: 'Dumbbell' }] }));
jest.mock('../../../api/exerciseCatalog', () => ({ exerciseCatalogApi: { libraryId: async () => null } }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }) }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {}, coachApi: {} }));
jest.mock('../../../hooks/usePrograms', () => ({
  useProgram: () => ({ data: { id: 'p1', name: LONG }, isLoading: false }),
  useAssignableClients: () => ({ data: [{ id: 'c1', name: LONG, email: 'long@example.test' }], isLoading: false, refetch: jest.fn() }),
  useInvalidatePrograms: () => jest.fn(async () => undefined),
}));

import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';
import RoutineBuilderScreen from '../RoutineBuilderScreen';
import ProgramAssignScreen from '../../coach/programs/ProgramAssignScreen';

const SCREENS = [
  path.join(__dirname, '../ClientWorkoutViewerScreen.tsx'),
  path.join(__dirname, '../RoutineBuilderScreen.tsx'),
  path.join(__dirname, '../../coach/programs/ProgramAssignScreen.tsx'),
];
const PARTS = [path.join(__dirname, '../../coach/programs/programAssignStyleC.tsx')];
const files = () => [...SCREENS, ...PARTS.filter((f) => fs.existsSync(f))];
/** Code only: block and line comments removed (a "//" inside a string literal is not a comment here). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

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
// An Ionicons glyph is a fixed-size icon, not text (the shared icon set's own rule, as in StyleWorkouts.guard).
function textProblems(root: unknown) {
  const glyph = (n: Host) => (StyleSheet.flatten(n.props.style as TextStyle) ?? {}).fontFamily === 'Ionicons'
    || (n.children ?? []).every((c) => typeof c === 'string' && /^[-]+$/.test(c));
  return hosts(root).filter((n) => n.type === 'Text' && !glyph(n) && JSON.stringify(n.children) !== '[""]'
    && (n.props.numberOfLines || n.props.adjustsFontSizeToFit || n.props.allowFontScaling === false))
    .map((n) => JSON.stringify(n.children));
}
function smallActions(root: unknown) {
  const actions = hosts(root).filter((n) => n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'checkbox'
    || (typeof n.props.accessibilityLabel === 'string' && typeof n.props.onClick === 'function'));
  return actions.filter((b) => {
    const st = (StyleSheet.flatten(b.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;
    return !(typeof st.minHeight === 'number' && st.minHeight >= 44) && !(typeof st.height === 'number' && st.height >= 44);
  }).map((b) => String(b.props.accessibilityLabel ?? b.props.testID ?? 'button'));
}
const mount = (el: React.ReactElement) => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 } }}>
    {el}
  </SafeAreaProvider>,
);

it('no hex, rgb or rgba colour literal in the three screens or a parts file (code, not comments)', () => {
  for (const file of files()) {
    const src = code(fs.readFileSync(file, 'utf8'));
    expect({ file: path.basename(file), hits: src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [] })
      .toEqual({ file: path.basename(file), hits: [] });
  }
});

it('no line clamp, shrink-to-fit or fixed text size in the three screens or a parts file', () => {
  for (const file of files()) {
    const src = fs.readFileSync(file, 'utf8');
    expect({ file: path.basename(file), hits: src.match(/numberOfLines|adjustsFontSizeToFit|allowFontScaling=\{false\}/g) ?? [] })
      .toEqual({ file: path.basename(file), hits: [] });
  }
});

it('the list of workouts at 320 pt: a long name stays whole and every pressable keeps a 44 pt floor', async () => {
  const view = await mount(<ClientWorkoutViewerScreen />);
  expect(view.getAllByText(LONG).length).toBe(2);
  expect(textProblems(view.toJSON())).toEqual([]);
  expect(smallActions(view.toJSON())).toEqual([]);
});

it('the routine builder and its Add exercise sheet at 320 pt: long names stay whole, every pressable at 44 pt', async () => {
  const view = await mount(<RoutineBuilderScreen />);
  expect((await view.findAllByText(LONG)).length).toBeGreaterThan(0);
  expect(textProblems(view.toJSON())).toEqual([]);
  expect(smallActions(view.toJSON())).toEqual([]);
  await fireEvent.press(view.getByLabelText('Add exercise'));
  await view.findByLabelText(`Add ${LONG}`);
  expect(textProblems(view.toJSON())).toEqual([]);
  expect(smallActions(view.toJSON())).toEqual([]);
});

it('the program assign at 320 pt: a long client name stays whole, every pressable at 44 pt', async () => {
  const props = { route: { params: { programId: 'p1' } }, navigation: mockNavigation } as unknown as Parameters<typeof ProgramAssignScreen>[0];
  const view = await mount(<ProgramAssignScreen {...props} />);
  expect(view.getByText(LONG)).toBeTruthy();
  expect(textProblems(view.toJSON())).toEqual([]);
  expect(smallActions(view.toJSON())).toEqual([]);
});
