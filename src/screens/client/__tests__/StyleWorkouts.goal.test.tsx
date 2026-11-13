/**
 * STYLE-WORKOUTS-M: the picked C1 Style C v2 on the four client workout screens, pinned to the drawings' numbers.
 * Frames (context main a9434a53): planning/MOCKUP3/C1/style-c-v2/C2_{detail,today,adjusted,logger}_ios390_100.png and,
 * for the library (no frame of its own, nearest picked drawing), planning/MOCKUP3/K3/style-c/C_picker_ios390_100.png
 * with C2_swap's library row. Every frame is 780 px wide for 390 pt (2x); each case names the pixel rows or columns
 * it was read from. Each case mounts the real screen at 390 x 844 (text 100%) and at 320 x 568 (text 130%).
 * Words, data, controls and test ids are main's; only the look is pinned here.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { AxiosHeaders } from 'axios';
import { PixelRatio, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
import { layout, lightTokens as sc, radius, spacing, typography } from '../../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;
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
const styleOf = (n: Host) => flat({ props: { style: n.props.style } });
const textOf = (n: Host): string => (n.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const response = <T,>(data: T) => ({ data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } });
const source = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const DEVICES = [
  { name: '390 x 844, text 100%', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: '320 x 568, text 130%', frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Stack = createNativeStackNavigator<any>();
function mount(device: Device, name: string, component: React.ComponentType<never>, initialParams?: object) {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(device.fontScale);
  return render(
    <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name={name} component={component as React.ComponentType} initialParams={initialParams} />
          <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen as React.ComponentType} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

const DETAIL = {
  id: 'bench', slug: 'bench', name: 'Bench press', primaryMuscle: 'chest', category: 'push',
  secondaryMuscles: ['triceps'], equipment: ['barbell'], difficulty: 'intermediate',
  instructions: ['Lie on the bench.', 'Lower the bar to the chest.'], playbackUrl: null, gifUrl: null,
};
const row = (order: number, id: string, extra: object = {}) => ({
  id: `r${order}`, workout_plan_id: 'plan', exercise_external_id: id, order, sets: 3, reps_or_duration_seconds: 8,
  weight_lbs: 135, rest_seconds: 90, superset_group_id: null, notes: null, ...extra,
});
// C2_today's five exercises: A, B, C single rows, D a two-row superset (Pull-up + Push-up).
const ASSIGNMENT = {
  id: 'a-1', workout_plan_id: 'plan', client_id: 'client-1', assigned_by_coach_id: 'coach',
  scheduled_for: '2026-11-13T12:00:00Z', completed_at: null, post_rpe: null, post_notes: null,
  roman_adjusted_sets: [{ order: 2, sets: 3 }],
  workout_plan: { id: 'plan', coach_id: 'coach', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55,
    created_at: '', updated_at: '', archived_at: null,
    exercises: [row(1, 'squat', { notes: 'Pause at the bottom.' }), row(2, 'bench'), row(3, 'rdl'),
      row(4, 'pull', { superset_group_id: 'ss-1' }), row(5, 'push', { superset_group_id: 'ss-1' })] },
};
const SAVED = { id: 'saved-1', workout_name: 'Full body A', notes: 'Steady',
  exercises: [{ exercise_name: 'Bench press', muscle_group: 'chest', sets_completed: 2,
    weight_per_set: [155, 155], reps_per_set: [6, 6], notes: 'Bar speed good', rpe: 7 }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockAssignment = ASSIGNMENT;
  jest.mocked(exerciseCatalogApi.getDetail).mockResolvedValue(response(DETAIL) as never);
  jest.mocked(exerciseCatalogApi.browse).mockResolvedValue(response({
    items: [{ id: 'squat', slug: 'squat', name: 'Back squat', primaryMuscle: 'quads', category: 'legs',
      secondaryMuscles: [], equipment: ['barbell'], difficulty: 'beginner' }], nextCursor: null, total: 1 }) as never);
});

describe.each(DEVICES)('at $name', (device) => {
  // ── ExerciseDetail: its own frame, C2_detail_ios390_100 ─────────────────────────────────────────────────
  it('detail: the page gutter is 24 pt (C2_detail cols 48-49, the title and "YOUR HISTORY" start at x 48)', async () => {
    const view = await mount(device, 'Detail', ExerciseDetailScreen, { idOrSlug: 'bench' });
    const scroll = await view.findByTestId('exercise-detail-screen');
    expect(flat({ props: { style: scroll.props.contentContainerStyle } }).paddingHorizontal).toBe(layout.gutter);
  });

  it('detail: each section is an eyebrow over a hairline, 4 pt above the rule, values 12 pt under it (C2_detail rows 868-917)', async () => {
    const view = await mount(device, 'Detail', ExerciseDetailScreen, { idOrSlug: 'bench' });
    await view.findByTestId('exercise-detail-screen');
    for (const head of ['MUSCLES', 'EQUIPMENT', 'HOW TO']) {
      const st = flat(view.getByText(head));
      expect(st.fontSize).toBe(typography.eyebrow.fontSize); // cap rows 868-883: 11 pt Inter Medium
      expect(st.color).toBe(sc.textMuted);
      expect(st.borderBottomWidth).toBe(StyleSheet.hairlineWidth); // rows 890-891, #DCD5CC
      expect(st.borderBottomColor).toBe(sc.border);
      expect(st.paddingBottom).toBe(spacing.xs); // ink 883 to rule 890
      expect(st.marginBottom).toBe(spacing.md); // rule 891 to the first row's ink 918
      expect(st.marginTop).toBe(layout.sectionPadY); // tile foot 831 to eyebrow 868
    }
  });

  // ── ExerciseLibrary: nearest picked drawing, K3 C_picker_ios390_100 (and C2_swap's library row) ─────────
  it('library: the head is the deep forest masthead with 24 pt bottom corners (C_picker rows 0-433, col 0-19 at row 425)', async () => {
    const view = await mount(device, 'Library', ExerciseLibraryScreen);
    await view.findByText('Back squat');
    const mast = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === sc.surface.masthead);
    expect(mast.length).toBeGreaterThan(0);
    expect(styleOf(mast[0]).borderBottomLeftRadius).toBe(radius.sheet);
    expect(styleOf(mast[0]).borderBottomRightRadius).toBe(radius.sheet);
    expect(styleOf(mast[0]).paddingHorizontal).toBe(layout.gutter); // search field from col 48
    expect(flat(view.getByText('Exercise library')).color).toBe(sc.textOnAccent);
  });

  it('library: the search field sits on the masthead, forest fill, frame line, 12 pt corners, 46 pt tall (C_picker rows 204-295)', async () => {
    const view = await mount(device, 'Library', ExerciseLibraryScreen);
    await view.findByText('Back squat');
    const field = hosts(view.toJSON()).find((n) => styleOf(n).backgroundColor === sc.surface.forestBand);
    expect(field).toBeTruthy();
    const st = styleOf(field as Host);
    expect(st.borderRadius).toBe(radius.input);
    expect(st.borderColor).toBe(sc.data.frameOnDark); // rows 204-207 #65776A
    expect(st.minHeight).toBe(46);
    const input = flat(view.getByLabelText('Search exercises'));
    expect(input.color).toBe(sc.textOnAccent);
    expect(view.getByLabelText('Search exercises').props.placeholderTextColor).toBe(sc.textOnMastheadMuted);
  });

  it('library: chips are 32 pt pills inside 44 pt targets, framed on forest, the chosen one filled leaf (C_picker rows 330-392, cols 307-309)', async () => {
    const view = await mount(device, 'Library', ExerciseLibraryScreen);
    await view.findByText('Back squat');
    expect(flat(view.getByText('Body part')).color).toBe(sc.textOnMastheadMuted);
    const chip = view.getByRole('button', { name: 'chest' });
    expect(flat(chip).minHeight).toBeGreaterThanOrEqual(layout.touchMin);
    const pills = hosts(view.toJSON()).filter((n) => styleOf(n).borderRadius === radius.chip && styleOf(n).minHeight === 32);
    expect(pills.length).toBe(14);
    expect(styleOf(pills[0]).borderColor).toBe(sc.data.frameOnDark);
    expect(styleOf(pills[0]).paddingHorizontal).toBe(spacing.lg); // ink from col 79, pill edge 48
    expect(flat(view.getByText('chest')).color).toBe(sc.textOnAccent);
    await fireEvent.press(chip);
    await waitFor(() => expect(flat(view.getByText('chest')).color).toBe(sc.surface.masthead));
    const chosen = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === sc.data.leaf);
    expect(chosen.length).toBe(1); // rows 332-391 #A3C46A
  });

  it('library: rows are 56 pt, 24 pt in from the edge, name over meta, hairline between (C_picker rows 766-879)', async () => {
    const view = await mount(device, 'Library', ExerciseLibraryScreen);
    const name = await view.findByText('Back squat');
    expect(flat(name).fontFamily).toBe(typography.h4.fontFamily); // ink 792-822
    const rowNode = view.getByRole('button', { name: 'Open Back squat' });
    const st = flat(rowNode);
    expect(st.minHeight).toBe(layout.rowMinHeight);
    expect(st.paddingHorizontal).toBe(layout.gutter);
    expect(st.paddingVertical).toBe(spacing.xs);
    expect(st.flexDirection).toBe('row'); // name and meta, then C2_swap's chevron (cols 715-726)
    expect(st.borderBottomColor).toBe(sc.border);
  });

  // ── WorkoutAssignmentDetail: C2_today_ios390_100 below its masthead, C2_adjusted for the changed row ──────
  it('assigned: each block starts with a 28 pt moss letter chip, 6 pt corners (C2_today cols 48-103, rows 890-945)', async () => {
    const view = await mount(device, 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' });
    await view.findByText('Back squat');
    const chips = hosts(view.toJSON()).filter((n) => styleOf(n).borderColor === sc.data.moss);
    expect(chips.length).toBe(4); // one per block, testIDs stay one per exercise
    for (const c of chips) {
      const st = styleOf(c);
      expect([st.width, st.height]).toEqual([28, 28]);
      expect(st.borderRadius).toBe(radius.control);
      expect(st.borderWidth).toBe(1.5);
    }
    expect(chips.map(textOf)).toEqual(['A', 'B', 'C', 'D']); // ruling (5): one superset block under D
    expect(view.getByText('Pull-up + Push-up')).toBeTruthy();
    expect(view.getByText('Superset · 3 rounds')).toBeTruthy();
    expect(flat(view.getAllByText('D', { includeHiddenElements: true })[0]).fontFamily).toBe(typography.h3.fontFamily);
    for (const order of [1, 2, 3, 4, 5]) expect(view.getByTestId(`assignment-row-${order}`)).toBeTruthy();
  });

  it('assigned: names are Inter 17 Medium, as drawn (C2_today rows 904-934)', async () => {
    const view = await mount(device, 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' });
    const name = await view.findByText('Back squat');
    expect(flat(name).fontFamily).toBe(typography.h4.fontFamily);
    expect(flat(name).fontSize).toBe(typography.h4.fontSize);
  });

  it("assigned: a coach-changed row sits on sage with a 3 pt forest edge (C2_adjusted cols 128-133, rows 1040-1203)", async () => {
    const view = await mount(device, 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' });
    await view.findByText('Back squat');
    const sage = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === sc.surface.sage);
    expect(sage.length).toBe(1);
    const st = styleOf(sage[0]);
    expect(st.borderLeftWidth).toBe(3);
    expect(st.borderLeftColor).toBe(sc.data.forest);
    expect(st.borderTopRightRadius).toBe(radius.card);
    const mark = flat(view.getByTestId('assignment-adjusted-2'));
    expect(mark.fontFamily).toBe('Inter_600SemiBold');
    expect(mark.color).toBe(sc.accentText);
  });

  it("assigned: the coach's words are Cormorant italic (C2_today note, TrainDay's reason)", async () => {
    const view = await mount(device, 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' });
    const note = await view.findByText('Pause at the bottom.');
    expect(flat(note).fontFamily).toBe('CormorantGaramond_400Regular_Italic');
    expect(flat(note).color).toBe(sc.textPrimary);
  });

  it('assigned: "Exercises" is the eyebrow over the hairline above the first row (C2_today rows 864-865)', async () => {
    const view = await mount(device, 'Assigned', WorkoutAssignmentDetailScreen, { assignmentId: 'a-1' });
    await view.findByText('Back squat');
    const st = flat(view.getByText('Exercises'));
    expect(st.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(st.borderBottomColor).toBe(sc.border);
    expect(st.paddingBottom).toBe(spacing.xs);
  });

  // ── WorkoutHistoryEdit: no frame, nearest picked drawing C2_logger_ios390_100 ───────────────────────────────
  it('edit: each exercise is the open block card, sage, 1 pt sage line, 16 pt corners and padding (C2_logger rows 462-1065, cols 48-82)', async () => {
    const view = await mount(device, 'Edit', WorkoutHistoryEditScreen, { workout: JSON.stringify(SAVED) });
    await view.findByText('Bench press');
    // The card: sage with the card corners (a saved set's row is sage too, without them).
    const cards = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === sc.surface.sage
      && styleOf(n).borderRadius === radius.card);
    expect(cards.length).toBe(1);
    const st = styleOf(cards[0]);
    expect(st.borderColor).toBe(sc.surface.sageLine);
    expect(st.borderWidth).toBe(1);
    expect(st.borderRadius).toBe(radius.card);
    expect(st.padding).toBe(spacing.lg);
    expect(st.marginHorizontal).toBe(layout.gutter);
  });

  it('edit: the exercise name is the Cormorant card title, 24 pt (C2_logger rows 509-556)', async () => {
    const view = await mount(device, 'Edit', WorkoutHistoryEditScreen, { workout: JSON.stringify(SAVED) });
    const name = await view.findByText('Bench press');
    expect(flat(name).fontFamily).toBe(typography.h2.fontFamily);
    expect(flat(name).fontSize).toBe(typography.h2.fontSize);
  });

  it('edit: set fields are lifted onto the surface inside the card (C2_logger rows 762-873, #FFFDF8)', async () => {
    const view = await mount(device, 'Edit', WorkoutHistoryEditScreen, { workout: JSON.stringify(SAVED) });
    await view.findByText('Bench press');
    const input = flat(view.getByTestId('set-weight-0-0'));
    expect(input.backgroundColor).toBe(sc.bgSurface);
    expect(input.borderBottomColor).toBe(sc.surface.sageLine);
    expect(input.minHeight).toBeGreaterThanOrEqual(layout.touchMin);
  });
});

// The navigator bars (H1, LO-927 B1): options objects of the two routes with native headers, read from source.
it('the library bar takes the masthead ground and light tint, no rule; the detail bar loses its rule', () => {
  const nav = source('../../../navigation/ClientNavigator.tsx');
  const lib = nav.slice(nav.indexOf('name="ExerciseLibrary"'), nav.indexOf('name="ExerciseDetail"'));
  expect(lib).toMatch(/title: 'Exercise Library'/);
  expect(lib).toMatch(/headerStyle: \{ backgroundColor: lightTokens\.surface\.masthead \}/);
  expect(lib).toMatch(/headerTintColor: lightTokens\.textOnAccent/);
  expect(lib).toMatch(/headerShadowVisible: false/);
  const detail = nav.slice(nav.indexOf('name="ExerciseDetail"'), nav.indexOf('featureFlags.learnCourses &&'));
  expect(detail).toMatch(/title: 'Exercise'/);
  expect(detail).toMatch(/headerShadowVisible: false/);
  expect(source('../ExerciseLibraryScreen.tsx')).toMatch(/MastheadBand/);
});
