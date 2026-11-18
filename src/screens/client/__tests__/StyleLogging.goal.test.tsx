/**
 * STYLE-LOGGING-M: the client's list of assigned workouts and the routine builder in the picked Style C v2, pinned to
 * the drawings' numbers. Neither screen has a frame of its own (nearest picked drawings, owner #191-D4 op 1):
 * - ClientWorkoutViewerScreen: C1 v2 planning/MOCKUP3/C1/style-c-v2/C2_history_ios390_100.png for the page, its title
 *   and section heads, C2_today_ios390_100.png for each card's exercise rows, C2_first for the empty title.
 * - RoutineBuilderScreen: K3 Style C planning/MOCKUP3/K3/style-c/C_day_ios390_100.png for the page (masthead, lettered
 *   rows, the one forest action at the foot), C_row for the fields' sage panel, C_picker for the Add exercise sheet.
 * Frames are 780 px wide for 390 pt (2x, context a9434a53); each case names the pixel rows it was read from. Each case
 * mounts the real screen at 390 x 844 (text 100%) and at 320 x 568 (text 130%). Words, data and controls are main's.
 */
import React from 'react';
import { PixelRatio, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
let mockRoutineId: string | undefined;
let mockAssignments: unknown[] = [];
let mockLoading = false;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack }),
  useRoute: () => ({ params: { routineId: mockRoutineId } }),
}));
// REFINE-987: the list now draws this week on its own card (C2_history); these R1 cases pin the R1 cards, so the
// phone's today is fixed a week after their 13 November rows (they read as an earlier week, on main's two lists).
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-11-20' }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: mockLoading, isError: false,
    isRefetching: false, refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat', bench: 'Bench press' }, loading: false }),
}));
const mockRoutine = { id: 'routine', name: 'Upper body', exercises: [
  { exercise_id: 'press', exercise_name: 'Bench press', default_sets: 3, default_reps: 10, default_rest_seconds: 60, muscle_group: 'CHEST' },
  { exercise_id: 'row', exercise_name: 'Row', default_sets: 4, default_reps: 8, default_rest_seconds: 90, muscle_group: 'BACK' },
] };
const mockRoutineData = [mockRoutine];
jest.mock('../../../hooks/useApi', () => ({
  useRoutines: () => ({ data: mockRoutineData }),
  useCreateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteRoutine: () => ({ mutate: jest.fn() }),
}));
jest.mock('../../../db/workoutDb', () => ({ getAllExercises: async () => [
  { id: 'press', name: 'Bench press', muscle: 'chest', equipment: 'Barbell' },
  { id: 'row', name: 'Row', muscle: 'back', equipment: 'Cable' },
] }));
jest.mock('../../../api/exerciseCatalog', () => ({ exerciseCatalogApi: { libraryId: async () => null } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: Record<string, unknown>) => require('react').createElement('Ionicons', p) }));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);

import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';
import RoutineBuilderScreen from '../RoutineBuilderScreen';
import { layout, lightTokens as sc, radius, spacing, typography } from '../../../theme/tokens';
import { mast, wsc } from '../workouts/workoutStyleC';

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

const DEVICES = [
  { name: '390 x 844, text 100%', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: '320 x 568, text 130%', frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];
function mount(device: Device, el: React.ReactElement) {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(device.fontScale);
  return render(<SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{el}</SafeAreaProvider>);
}

const row = (order: number, id: string) => ({ id: `r${order}`, workout_plan_id: 'plan', exercise_external_id: id, order,
  sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, rest_seconds: 120, superset_group_id: null, notes: null });
const assignment = (id: string, completed = false) => ({
  id, workout_plan_id: id, client_id: 'client', assigned_by_coach_id: 'coach',
  scheduled_for: '2026-11-13T12:00:00Z', completed_at: completed ? '2026-11-13T13:00:00Z' : null,
  post_rpe: completed ? 8 : null, post_notes: null,
  workout_plan: { id, coach_id: 'coach', name: id, type: 'strength', exercises: [row(1, 'squat'), row(2, 'bench')],
    duration_estimate_minutes: 55, created_at: '', updated_at: '', archived_at: null },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRoutineId = undefined;
  mockLoading = false;
  mockAssignments = [assignment('Full body A'), assignment('Upper body', true)];
});

describe.each(DEVICES)('at $name', (device) => {
  // ── ClientWorkoutViewerScreen: nearest C2_history (page) and C2_today (rows) ─────────────────────────────
  it('viewer: the page clears the status bar by 12 pt and keeps the 24 pt gutter (C2_history "TRAIN" cap row 118 = 47 + 12 pt, col 48)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const content = flat({ props: { style: view.getByTestId('assigned-workouts-scroll').props.contentContainerStyle } });
    expect(content.paddingTop).toBe(device.insets.top + layout.statusBarGap);
    expect(content.paddingHorizontal).toBe(layout.gutter);
  });

  it('viewer: "Your workouts" is the Cormorant page title, 32 pt (C2_history "Your weeks" Y cap rows 160-201)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const title = flat(view.getByText('Your workouts'));
    expect(title.fontFamily).toBe(typography.h1.fontFamily);
    expect(title.fontSize).toBe(typography.h1.fontSize);
    expect(title.color).toBe(sc.textPrimary);
  });

  it('viewer: each section head is the eyebrow over its own hairline (C2_history "EARLIER" rows 876-891, rule 898-899)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    for (const head of ['To complete', 'Completed']) {
      const st = flat(view.getByText(head));
      expect(st.fontSize).toBe(typography.eyebrow.fontSize);
      expect(st.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
      expect(st.borderBottomColor).toBe(sc.border);
      expect(st.paddingBottom).toBe(spacing.xs);
      expect(st.marginBottom).toBe(0); // the first card's own hairline-free top follows the rule (rows 900-930)
    }
  });

  it('viewer: a card is a C2_history row: Inter name, 12 pt above and below, a chevron at the right (rows 930-1027, chevron cols 708-720)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const name = flat(view.getByText('Full body A'));
    expect(name.fontFamily).toBe(typography.h4.fontFamily); // "Oct" cap rows 930-953: 17 pt Inter
    expect(name.fontSize).toBe(typography.h4.fontSize);
    const card = flat(view.getByRole('button', { name: 'Open workout Full body A' }));
    expect(card.paddingVertical).toBe(spacing.md);
    const chevrons = hosts(view.toJSON()).filter((n) => n.type === 'Ionicons' && n.props.name === 'chevron-forward');
    expect(chevrons).toHaveLength(2);
    expect(chevrons[0].props.color).toBe(sc.textPrimary); // cols 718-720 #1A1A18
  });

  it('viewer: exercise rows are C2_today rows: the name in Inter 17 over the prescription, 12 pt above and below (rows 864-1007)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const names = view.getAllByText('Back squat');
    expect(flat(names[0]).fontFamily).toBe(typography.h4.fontFamily); // "Back" cap rows 904-927
    expect(flat(names[0]).fontSize).toBe(typography.h4.fontSize);
    const rowView = hosts(view.toJSON()).find((n) => styleOf(n).borderTopWidth === StyleSheet.hairlineWidth
      && styleOf(n).paddingVertical === spacing.md);
    expect(rowView).toBeTruthy();
  });

  it('viewer: no assignment shows the C2_first title style, Cormorant 32 (rows 575-618)', async () => {
    mockAssignments = [];
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const st = flat(view.getByText('No workouts assigned'));
    expect(st.fontFamily).toBe(typography.h1.fontFamily);
    expect(st.fontSize).toBe(typography.h1.fontSize);
  });

  // ── RoutineBuilderScreen: nearest K3 Style C C_day, C_row and C_picker ─────────────────────────────────
  it('builder: the top is the deep forest masthead with 24 pt bottom corners, holding the bar and the name (C_day rows 0-465)', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    const heads = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === mast.ground);
    expect(heads.length).toBeGreaterThan(0);
    const st = styleOf(heads[0]);
    expect(st.borderBottomLeftRadius).toBe(radius.sheet);
    expect(st.borderBottomRightRadius).toBe(radius.sheet);
    expect(st.paddingHorizontal).toBe(layout.gutter);
    expect(st.paddingTop).toBe(device.insets.top + spacing.xs); // the back glyph's rows 129-162: a 44 pt bar 4 pt under the inset
  });

  it('builder: the bar title is Inter semibold 17 in the masthead ink (C_day "Strength foundations" S cap rows 134-157)', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    const title = flat(view.getByText('New routine'));
    expect(title.color).toBe(mast.ink);
    expect(title.fontFamily).toBe(typography.micro.fontFamily); // Inter_600SemiBold
    expect(title.fontSize).toBe(typography.h4.fontSize);
  });

  it('builder: the routine name is the serif title on the masthead, its hairline in the frame line (C_day "Full body A" rows 214-253)', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    const input = view.getByLabelText('Routine name');
    const st = flat(input);
    expect(st.color).toBe(mast.ink);
    expect(st.borderBottomColor).toBe(mast.line);
    expect(input.props.placeholderTextColor).toBe(mast.muted);
    expect(flat(view.getByText('Routine name')).color).toBe(mast.muted);
  });

  it('builder: each row carries its letter in the 28 pt moss chip, then the Inter 17 name (C_day rows 954-1009, cols 48-103)', async () => {
    mockRoutineId = 'routine';
    const view = await mount(device, <RoutineBuilderScreen />);
    expect(view.getByText('A')).toBeTruthy();
    expect(view.getByText('B')).toBeTruthy();
    expect(view.queryByText('1')).toBeNull();
    const chips = hosts(view.toJSON()).filter((n) => styleOf(n).width === wsc.letterChip && styleOf(n).height === wsc.letterChip);
    expect(chips).toHaveLength(2);
    expect(styleOf(chips[0]).borderWidth).toBe(wsc.letterLine);
    expect(styleOf(chips[0]).borderColor).toBe(sc.data.moss);
    expect(styleOf(chips[0]).borderRadius).toBe(radius.control);
    expect(flat(view.getByText('Bench press')).fontFamily).toBe(typography.h4.fontFamily); // "Back" cap rows 966-989
  });

  it('builder: the three fields sit on the sage panel, one row each, 16 pt corners (C_row rows 480-993)', async () => {
    mockRoutineId = 'routine';
    const view = await mount(device, <RoutineBuilderScreen />);
    const panels = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === sc.surface.sage);
    expect(panels).toHaveLength(2);
    expect(styleOf(panels[0]).borderColor).toBe(sc.surface.sageLine);
    expect(styleOf(panels[0]).borderRadius).toBe(radius.card);
    const field = flat(view.getByLabelText('Sets for Bench press, exercise 1'));
    expect(field.backgroundColor).toBe(sc.bgSurface); // the drawn field ground (C_row rows 1066-1168)
    expect(field.borderRadius).toBe(radius.input);
    expect(field.minHeight).toBeGreaterThanOrEqual(layout.touchMin);
    expect(flat(view.getAllByText('Sets')[0]).color).toBe(sc.textPrimary); // "Sets" on the panel, col 82
  });

  it('builder: Add exercise is a forest link (C_day "Reorder" rows 860-879) and Save routine stays the one forest action (rows 1392-1499)', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    const add = flat(view.getByText('Add exercise'));
    expect(add.color).toBe(sc.accentText);
    expect(add.textDecorationLine).toBeUndefined();
    const save = flat(view.getByLabelText('Save routine'));
    expect(save.backgroundColor).toBe(sc.accent);
    expect(save.minHeight).toBe(layout.buttonHeight);
    // The label keeps the app's primary label (PrimaryButton's bodyMd, as m#975's Start workout): drawn 15 pt semibold, NONE.
    expect(flat(view.getByText('Save routine')).fontFamily).toBe(typography.bodyMd.fontFamily);
    expect(flat(view.getByLabelText('Add exercise')).minHeight).toBeGreaterThanOrEqual(layout.touchMin);
  });

  it('builder: the Add exercise sheet opens on the masthead with the forest search field and 32 pt pills (C_picker rows 0-433)', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    await fireEvent.press(view.getByLabelText('Add exercise'));
    await view.findByLabelText('Add Bench press');
    const field = hosts(view.toJSON()).find((n) => styleOf(n).backgroundColor === mast.field);
    expect(field).toBeTruthy();
    expect(styleOf(field as Host).minHeight).toBe(wsc.searchHeight);
    expect(styleOf(field as Host).borderColor).toBe(mast.line);
    expect(styleOf(field as Host).borderRadius).toBe(radius.input);
    const pills = hosts(view.toJSON()).filter((n) => styleOf(n).minHeight === wsc.pillHeight && styleOf(n).borderRadius === radius.chip);
    expect(pills).toHaveLength(10);
    const chosen = pills.filter((n) => styleOf(n).backgroundColor === mast.chosen);
    expect(chosen).toHaveLength(1);
    const titles = view.getAllByText('Add exercise').map(flat);
    expect(titles.some((t) => t.color === mast.ink && t.fontFamily === typography.micro.fontFamily)).toBe(true); // rows 118-141
    const name = flat(view.getByText('Row'));
    expect(name.fontFamily).toBe(typography.h4.fontFamily); // C_picker "Back squat" rows 792-822
    const item = flat(view.getByLabelText('Add Row'));
    expect(item.minHeight).toBe(layout.rowMinHeight);
  });
});
