/**
 * REFINE-987R3 (m#987 round 3, owner #203-E80 on 203-D38): two screens in one flow.
 * - Your workouts (ClientWorkoutViewerScreen): main's cards for this week and the two after (WINDOW-1: this Monday to
 *   the Sunday two weeks after, Monday first, the phone's own today; a row whose day cannot be read stays listed),
 *   "Full program" under the title; with a week (a Monday) as its route parameter, that one week's workouts.
 * - Your weeks (YourWeeksScreen, C2_history as the owner picked it): this week's card, Coming up (later weeks, soonest
 *   first), Earlier (past weeks, newest first), each week row opening Your workouts for its Monday, and the key.
 * One week rule for both (TrainToday.tsx trainWeek over thisWeek.ts workoutWeek). The drawn numbers are round 2's,
 * re-homed from StyleLogging.r2.goal.test.tsx (C2_history_ios390_100.png, 780 px for 390 pt).
 */
import React from 'react';
import { PixelRatio, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
const mockRefetch = jest.fn();
let mockToday = '2026-11-18';
let mockAssignments: unknown[] = [];
let mockLoading = false;
let mockError = false;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => mockToday }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockLoading || mockError ? undefined : mockAssignments, isLoading: mockLoading,
    isError: mockError, isRefetching: false, refetch: mockRefetch }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat' }, loading: false, bodyWeight: {} }),
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: Record<string, unknown>) => require('react').createElement('Ionicons', p) }));

import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';
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
/** Every text on the page in screen order. */
const texts = (root: unknown) => hosts(root).filter((n) => n.type === 'Text')
  .map((n) => (n.children ?? []).filter((c) => typeof c === 'string').join(''));

const DEVICES = [
  { name: '390 x 844, text 100%', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: '320 x 568, text 130%', frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];
function mount(el: React.ReactElement, device: Device = DEVICES[0]) {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(device.fontScale);
  return render(<SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{el}</SafeAreaProvider>);
}
const list = (week?: string) => <ClientWorkoutViewerScreen {...(week === undefined ? {} : { route: { params: { week } } })} />;
// Required when first drawn, so the list's cases run (and go red on their own assertions) before the new screen exists.
const weeksPage = () => {
  const YourWeeksScreen = (require('../workouts/YourWeeksScreen') as { default: React.ComponentType }).default;
  return <YourWeeksScreen />;
};

const lift = { id: 'r1', workout_plan_id: 'plan', exercise_external_id: 'squat', order: 1, sets: 4, reps_or_duration_seconds: 5,
  weight_lbs: 185, rest_seconds: 120, superset_group_id: null, notes: null };
/** `when` is a calendar day (stored at UTC midnight, read as written), a full moment (the local day) or anything else. */
function a(id: string, when: string, state: 'open' | 'done' | 'skipped' = 'open') {
  const day = /^\d{4}-\d\d-\d\d/.test(when) ? when.slice(0, 10) : '2026-11-18';
  return {
    id, workout_plan_id: id, client_id: 'client', assigned_by_coach_id: 'coach',
    scheduled_for: when.length === 10 ? `${when}T00:00:00.000Z` : when,
    completed_at: state === 'done' ? `${day}T18:00:00.000Z` : null,
    skipped_at: state === 'skipped' ? `${day}T18:00:00.000Z` : null,
    post_rpe: state === 'done' ? 7 : null, post_notes: null,
    workout_plan: { id, coach_id: 'coach', name: id, type: 'strength', exercises: [lift], duration_estimate_minutes: 40,
      created_at: '', updated_at: '', archived_at: null },
  };
}
const LINE = 'Strength • about 40 min • 1 exercise';
const LIFT = '4 sets × 5 reps / sec · 185 lb prescribed';
const OUT_LINE = 'Nothing planned in the next three weeks.';
/** The workouts a page lists, by their cards' spoken names, in screen order. */
const listed = (view: { queryAllByRole: (r: 'button', o: { name: RegExp }) => Array<{ props: { accessibilityLabel?: string } }> }) =>
  view.queryAllByRole('button', { name: /^Open workout / }).map((b) => String(b.props.accessibilityLabel).replace(/^Open workout /, ''));
const dateLine = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// Today Wednesday 18 November 2026: this week is Mon 16 to Sun 22; the window runs to Sun 6 December.
const MIXED = [
  a('Upper body', '2026-11-16', 'done'),
  a('Full body A', '2026-11-17', 'skipped'),
  a('Lower body', '2026-11-19'),
  a('Conditioning', '2026-11-15'),
  a('Push day', '2026-11-10', 'done'),
  a('Legs', '2026-11-03', 'done'),
  a('Next week', '2026-11-24'),
  a('Mobility', '2026-11-16'),
  a('Far week', '2026-12-08'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockToday = '2026-11-18';
  mockAssignments = MIXED;
  mockLoading = false;
  mockError = false;
});

// ── A. The window ─────────────────────────────────────────────────────────────────────────────────────────────
describe('A. Your workouts lists this week and the two after (WINDOW-1)', () => {
  const EDGES = [
    a('This Monday', '2026-11-16'), a('This Sunday', '2026-11-22'), a('Next Monday', '2026-11-23'),
    a('Far Sunday', '2026-12-06'), a('Three weeks out', '2026-12-07'), a('Last Sunday', '2026-11-15'),
    a('No day', 'some day'),
  ];
  it.each([['a Wednesday', '2026-11-18'], ['a Monday', '2026-11-16'], ['a Sunday', '2026-11-22']])(
    'with today %s: this Monday to the Sunday two weeks out, and a row with no readable day', async (_n, today) => {
      mockToday = today;
      mockAssignments = EDGES;
      const view = await mount(list());
      expect(listed(view).sort()).toEqual(['Far Sunday', 'Next Monday', 'No day', 'This Monday', 'This Sunday']);
      expect(within(view.getByRole('button', { name: 'Open workout No day' })).getByText('scheduled')).toBeTruthy();
    });

  it('a session just after local midnight counts on that local day (out from Sunday 22 Nov, in from Monday 23 Nov)', async () => {
    mockAssignments = [a('Early riser', new Date(2026, 11, 7, 0, 30).toISOString())];
    mockToday = '2026-11-22';
    let view = await mount(list());
    expect(listed(view)).toEqual([]);
    expect(view.getByText(OUT_LINE)).toBeTruthy();
    await view.unmount();
    mockToday = '2026-11-23';
    view = await mount(list());
    expect(listed(view)).toEqual(['Early riser']);
  });

  it('a week crossing the clock change (Mon 26 Oct to Sun 1 Nov) is one week', async () => {
    mockAssignments = [a('Before the change', '2026-10-26', 'done'), a('After the change', '2026-11-01')];
    mockToday = '2026-11-01';
    let view = await mount(list());
    expect(listed(view).sort()).toEqual(['After the change', 'Before the change']);
    await view.unmount();
    mockToday = '2026-11-02';
    view = await mount(list());
    expect(listed(view)).toEqual([]);
  });
});

// ── B. Inside the window the list is main's ──────────────────────────────────────────────────────────────────
describe("B. inside the window the list is main's", () => {
  it('"To complete" then "Completed", in main\'s order (day order), each card main\'s', async () => {
    const view = await mount(list());
    const seen = texts(view.toJSON());
    expect(seen.indexOf('To complete')).toBeGreaterThan(-1);
    expect(seen.indexOf('To complete')).toBeLessThan(seen.indexOf('Completed'));
    expect(listed(view)).toEqual(['Mobility', 'Full body A', 'Lower body', 'Next week', 'Upper body']);
    for (const name of ['Mobility', 'Full body A', 'Lower body', 'Next week', 'Upper body']) {
      const card = within(view.getByRole('button', { name: `Open workout ${name}` }));
      expect(card.getByText(name)).toBeTruthy();
      expect(card.getByText(LINE)).toBeTruthy();
      expect(card.getByText(LIFT)).toBeTruthy();
    }
    expect(within(view.getByRole('button', { name: 'Open workout Next week' })).getByText(dateLine('2026-11-24'))).toBeTruthy();
    expect(within(view.getByRole('button', { name: 'Open workout Upper body' })).getByText('Completed RPE 7')).toBeTruthy();
  });

  it('a card opens WorkoutAssignmentDetail with its id, as on main', async () => {
    const view = await mount(list());
    await fireEvent.press(view.getByRole('button', { name: 'Open workout Lower body' }));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', { assignmentId: 'Lower body' });
  });

  it('no week card, ring, Earlier rows or key on this screen; the "Train" eyebrow stays', async () => {
    const view = await mount(list());
    for (const id of ['week-card', 'week-ring', 'week-earlier', 'week-legend', 'week-coming']) {
      expect(view.queryByTestId(id, { includeHiddenElements: true })).toBeNull();
    }
    expect(view.queryByText('This week')).toBeNull();
    expect(view.getByText('Train')).toBeTruthy();
    expect(view.getByText('Your workouts')).toBeTruthy();
  });
});

// ── C. "Full program" ────────────────────────────────────────────────────────────────────────────────────────
describe('C. "Full program" under the title', () => {
  it('drawn with a workout in the window, right under the title; a press opens YourWeeks once', async () => {
    mockAssignments = [a('Lower body', '2026-11-19')];
    const view = await mount(list());
    const row = view.getByRole('button', { name: 'Full program' });
    const seen = texts(view.toJSON());
    expect(seen.indexOf('Full program')).toBe(seen.indexOf('Your workouts') + 1);
    await fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('YourWeeks');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('drawn with workouts only outside the window, over "Nothing planned in the next three weeks."', async () => {
    mockAssignments = [a('Legs', '2026-11-03', 'done'), a('Far week', '2026-12-08')];
    const view = await mount(list());
    expect(view.getByRole('button', { name: 'Full program' })).toBeTruthy();
    const line = view.getByText(OUT_LINE);
    expect(flat(line).color).toBe(sc.textMuted);
    expect(listed(view)).toEqual([]);
    expect(view.queryByText('To complete')).toBeNull();
  });

  it.each([
    ['while loading', () => { mockLoading = true; }, 'Loading...'],
    ['after a failed load', () => { mockError = true; }, 'Could not load your workouts. Pull to retry.'],
    ['with no workout at all', () => { mockAssignments = []; }, 'No workouts assigned'],
  ])('not drawn %s (main\'s words stay)', async (_n, set, words) => {
    set();
    const view = await mount(list());
    expect(view.queryByText('Full program')).toBeNull();
    expect(view.queryByText(OUT_LINE)).toBeNull();
    expect(view.getByText(words)).toBeTruthy();
  });

  it('not drawn on the one-week page', async () => {
    const view = await mount(list('2026-11-02'));
    expect(view.queryByText('Full program')).toBeNull();
  });
});

// ── E. The one-week page ─────────────────────────────────────────────────────────────────────────────────────
describe('E. Your workouts for one week (the week row\'s page)', () => {
  it('an earlier Monday: exactly that week\'s workouts, both sections, main\'s cards, its span as the eyebrow', async () => {
    mockAssignments = [...MIXED, a('Legs open', '2026-11-05')];
    const view = await mount(list('2026-11-02'));
    expect(listed(view)).toEqual(['Legs open', 'Legs']);
    expect(view.getByText('To complete')).toBeTruthy();
    expect(view.getByText('Completed')).toBeTruthy();
    expect(within(view.getByRole('button', { name: 'Open workout Legs' })).getByText(LINE)).toBeTruthy();
    expect(view.getByText('Nov 2 to 8')).toBeTruthy();
    expect(view.queryByText('Train')).toBeNull();
    expect(flat(view.getByText('Nov 2 to 8')).fontSize).toBe(typography.eyebrow.fontSize);
  });

  it('a Monday inside the window: that week only', async () => {
    const view = await mount(list('2026-11-23'));
    expect(listed(view)).toEqual(['Next week']);
    expect(view.getByText('Nov 23 to 29')).toBeTruthy();
  });

  it('a later week beyond the window: that week only', async () => {
    const view = await mount(list('2026-12-07'));
    expect(listed(view)).toEqual(['Far week']);
    expect(view.getByText('Dec 7 to 13')).toBeTruthy();
  });

  it.each([['a Wednesday', '2026-11-18'], ['not a date', 'soon'], ['not a real day', '2026-02-30'], ['empty', '']])(
    'a value that is not a Monday date (%s): the default window', async (_n, week) => {
      const view = await mount(list(week));
      expect(listed(view)).toEqual(['Mobility', 'Full body A', 'Lower body', 'Next week', 'Upper body']);
      expect(view.getByText('Train')).toBeTruthy();
      expect(view.getByText('Full program')).toBeTruthy();
    });
});

// ── D. Your weeks ────────────────────────────────────────────────────────────────────────────────────────────
describe('D. Your weeks (C2_history)', () => {
  it('the eyebrow and the serif title', async () => {
    const view = await mount(weeksPage());
    expect(view.getByText('Train')).toBeTruthy();
    expect(flat(view.getByText('Your weeks')).fontFamily).toBe(typography.h1.fontFamily);
  });

  it("this week's card: the ring and one row per session in day order; skipped and past open read missed", async () => {
    const view = await mount(weeksPage());
    const card = view.getByTestId('week-card');
    const rows = within(card).getAllByTestId(/^week-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['week-row-Upper body', 'week-row-Mobility', 'week-row-Full body A', 'week-row-Lower body']);
    expect(rows.map((r) => within(r).getByText(/^(done|planned|missed)$/).props.children)).toEqual(['done', 'missed', 'missed', 'planned']);
    expect(within(card).getAllByText('Mon 16')).toHaveLength(2);
    expect(within(card).getByText('This week')).toBeTruthy();
    expect(within(card).getByText('1/4')).toBeTruthy();
    expect(view.getByTestId('week-ring').props.accessibilityLabel).toBe('1 of 4 done');
  });

  it('a session row is one line: no exercise line and no card line under it (WEEKS-2)', async () => {
    const view = await mount(weeksPage());
    const card = within(view.getByTestId('week-card'));
    expect(card.queryByText(LIFT)).toBeNull();
    expect(card.queryByText(LINE)).toBeNull();
    expect(view.queryByText(LIFT)).toBeNull();
  });

  it.each([
    ['Upper body', 'Mon 16', 'done'], ['Mobility', 'Mon 16', 'missed'], ['Full body A', 'Tue 17', 'missed'], ['Lower body', 'Thu 19', 'planned'],
  ])('the row for %s is spoken with its day and state and opens its workout (WEEKS-3)', async (name, day, state) => {
    const view = await mount(weeksPage());
    const press = view.getByRole('button', { name: `Open workout ${name}, ${day}, ${state}` });
    await fireEvent.press(press);
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', { assignmentId: name });
  });

  it('Coming up: soonest first, the span, "{n} to go", a chevron; a press opens that week', async () => {
    const view = await mount(weeksPage());
    const coming = view.getByTestId('week-coming');
    expect(within(coming).getByText('Coming up')).toBeTruthy();
    const weeks = within(coming).getAllByTestId(/^coming-\d{4}-\d\d-\d\d$/);
    expect(weeks.map((n) => n.props.testID)).toEqual(['coming-2026-11-23', 'coming-2026-12-07']);
    expect(within(weeks[0]).getByText('Nov 23 to 29')).toBeTruthy();
    expect(within(weeks[0]).getByText('1 to go')).toBeTruthy();
    expect(weeks[0].props.accessibilityLabel).toBe('Nov 23 to 29, 1 to go');
    expect(weeks[0].props.accessibilityRole).toBe('button');
    expect(hosts(weeks[0]).filter((n) => n.type === 'Ionicons' && n.props.name === 'chevron-forward')).toHaveLength(1);
    await fireEvent.press(weeks[1]);
    expect(mockNavigate).toHaveBeenCalledWith('ClientWorkoutViewer', { week: '2026-12-07' });
  });

  it('Coming up reads doneLine when nothing planned is left in that week', async () => {
    mockAssignments = [a('Early done', '2026-11-24', 'done'), a('Skipped ahead', '2026-11-25', 'skipped')];
    const view = await mount(weeksPage());
    const row = view.getByTestId('coming-2026-11-23');
    expect(within(row).getByText('1 of 2 done')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Nov 23 to 29, 1 of 2 done');
  });

  it('Earlier: newest first, the span and doneLine, a chevron; a press opens that week', async () => {
    const view = await mount(weeksPage());
    const earlier = view.getByTestId('week-earlier');
    expect(within(earlier).getByText('Earlier')).toBeTruthy();
    const weeks = within(earlier).getAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/);
    expect(weeks.map((n) => n.props.testID)).toEqual(['earlier-2026-11-09', 'earlier-2026-11-02']);
    expect(within(weeks[0]).getByText('Nov 9 to 15')).toBeTruthy();
    expect(within(weeks[0]).getByText('1 of 2 done')).toBeTruthy();
    expect(weeks[0].props.accessibilityLabel).toBe('Nov 9 to 15, 1 of 2 done');
    expect(within(weeks[1]).getByText('Nov 2 to 8')).toBeTruthy();
    expect(view.getByTestId('earlier-ring-2026-11-09').props.accessibilityLabel).toBe('1 of 2 done');
    expect(hosts(weeks[0]).filter((n) => n.type === 'Ionicons' && n.props.name === 'chevron-forward')).toHaveLength(1);
    await fireEvent.press(weeks[1]);
    expect(mockNavigate).toHaveBeenCalledWith('ClientWorkoutViewer', { week: '2026-11-02' });
  });

  it('neither list holds this week, and a week with no session has no card and no row', async () => {
    mockToday = '2026-12-02';
    const view = await mount(weeksPage());
    expect(view.queryByTestId('week-card')).toBeNull();
    const all = [...view.queryAllByTestId(/^coming-\d{4}-\d\d-\d\d$/), ...view.queryAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/)]
      .map((n) => String(n.props.testID).replace(/^\w+-/, ''));
    expect(all).not.toContain('2026-11-30');
    expect(all.sort()).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-12-07']);
    mockToday = '2026-11-18';
    await view.unmount();
    const again = await mount(weeksPage());
    const ids = [...again.queryAllByTestId(/^coming-\d{4}-\d\d-\d\d$/), ...again.queryAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/)]
      .map((n) => String(n.props.testID));
    expect(ids.some((id) => id.endsWith('2026-11-16'))).toBe(false);
  });

  it('a week crossing the clock change (Mon 26 Oct to Sun 1 Nov) is one Earlier row', async () => {
    mockAssignments = [a('Before the change', '2026-10-26', 'done'), a('After the change', '2026-11-01')];
    mockToday = '2026-11-01';
    let view = await mount(weeksPage());
    expect(view.getByTestId('week-ring').props.accessibilityLabel).toBe('1 of 2 done');
    await view.unmount();
    mockToday = '2026-11-02';
    view = await mount(weeksPage());
    expect(view.queryByTestId('week-card')).toBeNull();
    expect(within(view.getByTestId('earlier-2026-10-26')).getByText('Oct 26 to Nov 1')).toBeTruthy();
    expect(within(view.getByTestId('earlier-2026-10-26')).getByText('1 of 2 done')).toBeTruthy();
  });

  it("the key names the three marks with the app's words, only when a card or a week row is drawn", async () => {
    let view = await mount(weeksPage());
    const legend = view.getByTestId('week-legend');
    for (const w of ['done', 'planned', 'missed']) expect(within(legend).getByText(w)).toBeTruthy();
    expect(within(legend).queryByText('New best')).toBeNull();
    await view.unmount();
    mockAssignments = [a('No day', 'some day')];
    view = await mount(weeksPage());
    expect(view.queryByTestId('week-legend')).toBeNull();
  });

  it('a row whose day cannot be read is on no card and no week row, and nothing throws', async () => {
    mockAssignments = [a('No day', 'some day'), a('Lower body', '2026-11-19')];
    const view = await mount(weeksPage());
    expect(within(view.getByTestId('week-card')).getAllByTestId(/^week-row-/).map((r) => r.props.testID)).toEqual(['week-row-Lower body']);
    expect(view.queryByText('No day')).toBeNull();
    expect(view.queryByTestId('week-coming')).toBeNull();
    expect(view.queryByTestId('week-earlier')).toBeNull();
  });

  it.each([
    ['while loading', () => { mockLoading = true; }, 'Loading...'],
    ['after a failed load', () => { mockError = true; }, 'Could not load your workouts. Pull to retry.'],
    ['with no workout at all', () => { mockAssignments = []; }, 'No workouts assigned'],
  ])("%s: main's words, no card, no rows, no key", async (_n, set, words) => {
    set();
    const view = await mount(weeksPage());
    expect(view.getByText(words)).toBeTruthy();
    for (const id of ['week-card', 'week-coming', 'week-earlier', 'week-legend']) expect(view.queryByTestId(id)).toBeNull();
    if (words === 'No workouts assigned') expect(view.getByText('Assigned workouts appear here when available.')).toBeTruthy();
  });

  it('pull to refresh asks the read again', async () => {
    const view = await mount(weeksPage());
    const scroll = view.getByTestId('your-weeks-scroll');
    await act(async () => { (scroll.props.refreshControl as React.ReactElement<{ onRefresh: () => void }>).props.onRefresh(); });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

// ── F. Reach: every workout is on exactly one card of the page that lists it ─────────────────────────────────
describe('F. reach (class): every row kind GET /assignments/me returns', () => {
  const KINDS = [
    a('this open', '2026-11-19'), a('this done', '2026-11-16', 'done'), a('this skipped', '2026-11-17', 'skipped'),
    a('next week', '2026-11-24'), a('two out', '2026-12-03'), a('three out', '2026-12-08'), a('far out', '2027-01-12'),
    a('earlier open', '2026-11-10'), a('earlier done', '2026-11-03', 'done'), a('earlier skipped', '2026-10-28', 'skipped'),
    a('no day', 'some day'), a('same day A', '2026-11-20'), a('same day B', '2026-11-20'),
  ];
  const PLACE: Record<string, 'list+card' | 'list+coming' | 'coming' | 'earlier' | 'list'> = {
    'this open': 'list+card', 'this done': 'list+card', 'this skipped': 'list+card', 'next week': 'list+coming',
    'two out': 'list+coming', 'three out': 'coming', 'far out': 'coming', 'earlier open': 'earlier', 'earlier done': 'earlier',
    'earlier skipped': 'earlier', 'no day': 'list', 'same day A': 'list+card', 'same day B': 'list+card',
  };
  const MONDAY: Record<string, string> = {
    'next week': '2026-11-23', 'two out': '2026-11-30', 'three out': '2026-12-07', 'far out': '2027-01-11',
    'earlier open': '2026-11-09', 'earlier done': '2026-11-02', 'earlier skipped': '2026-10-26',
  };

  beforeEach(() => { mockAssignments = KINDS; });

  it('each workout: once on the default list, or on no card there and once on its week row\'s page; never in both sections', async () => {
    const def = await mount(list());
    const onDefault = listed(def);
    await def.unmount();
    const weeks = await mount(weeksPage());
    const rowIds = [...weeks.queryAllByTestId(/^coming-\d{4}-\d\d-\d\d$/), ...weeks.queryAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/)];
    const opened: string[] = [];
    for (const row of rowIds) {
      mockNavigate.mockClear();
      await fireEvent.press(row);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      const [route, params] = mockNavigate.mock.calls[0] as [string, { week: string }];
      expect(route).toBe('ClientWorkoutViewer');
      opened.push(params.week);
    }
    expect(opened).toHaveLength(7);
    await weeks.unmount();
    const pages: Record<string, string[]> = {};
    for (const week of opened) {
      const params = { week };
      const page = await mount(list(params.week));
      pages[params.week] = listed(page);
      // Every week row drawn opens a page with at least one card.
      expect(pages[params.week].length).toBeGreaterThan(0);
      const both = page.queryByText('To complete') && page.queryByText('Completed');
      if (both) expect(new Set(pages[params.week]).size).toBe(pages[params.week].length);
      await page.unmount();
    }
    for (const w of KINDS) {
      const here = onDefault.filter((n) => n === w.id).length;
      const elsewhere = Object.values(pages).flat().filter((n) => n === w.id).length;
      if (here === 1) continue;
      expect({ id: w.id, here }).toEqual({ id: w.id, here: 0 });
      expect({ id: w.id, elsewhere }).toEqual({ id: w.id, elsewhere: 1 });
    }
    for (const ids of [onDefault, ...Object.values(pages)]) expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(Object.entries(PLACE))('%s sits where the reach table says (%s)', async (id, place) => {
    const def = await mount(list());
    expect(listed(def).filter((n) => n === id)).toHaveLength(place.startsWith('list') ? 1 : 0);
    await def.unmount();
    const weeks = await mount(weeksPage());
    const card = weeks.queryByTestId('week-card');
    const onCard = card ? within(card).queryAllByTestId(`week-row-${id}`).length : 0;
    expect(onCard).toBe(place === 'list+card' ? 1 : 0);
    const monday = MONDAY[id];
    if (place.endsWith('coming')) expect(weeks.getByTestId(`coming-${monday}`)).toBeTruthy();
    if (place === 'earlier') expect(weeks.getByTestId(`earlier-${monday}`)).toBeTruthy();
    await weeks.unmount();
    if (monday) {
      const page = await mount(list(monday));
      expect(listed(page).filter((n) => n === id)).toHaveLength(1);
      await page.unmount();
    }
  });

  it("each card on a list opens WorkoutAssignmentDetail with that workout's id", async () => {
    for (const week of [undefined, ...Object.values(MONDAY)]) {
      const page = await mount(list(week));
      for (const id of listed(page)) {
        mockNavigate.mockClear();
        await fireEvent.press(page.getByRole('button', { name: `Open workout ${id}` }));
        expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', { assignmentId: id });
      }
      await page.unmount();
    }
  });
});

// ── The drawn numbers (round 2's, re-homed onto Your weeks) ──────────────────────────────────────────────────
describe.each(DEVICES)('the drawn numbers at $name', (device) => {
  it.each([['Your workouts', list], ['Your weeks', weeksPage]])('%s: "Train" is the eyebrow over the title (C2_history TRAIN cap rows 118-133)', async (_n, page) => {
    const view = await mount(page(), device);
    const st = flat(view.getByText('Train'));
    expect(st.fontSize).toBe(typography.eyebrow.fontSize);
    expect(st.textTransform).toBe('uppercase');
    expect(st.color).toBe(sc.textMuted);
  });

  it('the THIS WEEK card: deep forest, 16 pt corners, 16 pt in, the 44 pt ring on dark (rows 236-843, ring cols 611-696)', async () => {
    const view = await mount(weeksPage(), device);
    const st = flat(view.getByTestId('week-card'));
    expect(st.backgroundColor).toBe(sc.surface.masthead);
    expect(st.borderRadius).toBe(radius.card);
    expect(st.paddingHorizontal).toBe(spacing.lg);
    expect(st.paddingTop).toBe(spacing.lg);
    expect(flat(view.getByTestId('week-ring')).width).toBe(44);
    expect(flat(view.getByText('This week')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(view.getByText('1/4')).color).toBe(sc.textOnAccent);
  });

  it('a session row: 56 pt under a 1 pt rule, the 22 pt mark, the day muted, the name in ink (rows 368-479, cols 80-123)', async () => {
    const view = await mount(weeksPage(), device);
    const row = view.getByTestId('week-row-Lower body');
    const st = flat(row);
    expect(st.minHeight).toBe(layout.rowMinHeight);
    expect(st.borderTopWidth).toBe(1);
    expect(st.borderTopColor).toBe(sc.surface.forestBand);
    const hidden = { includeHiddenElements: true };
    const mark = flat(view.getByTestId('week-mark-planned', hidden));
    expect([mark.width, mark.height, mark.borderColor]).toEqual([22, 22, sc.data.plannedOnDark]);
    expect(flat(view.getAllByTestId('week-mark-missed', hidden)[0]).borderStyle).toBe('dashed');
    expect(flat(view.getByTestId('week-mark-done', hidden)).backgroundColor).toBe(sc.data.leaf);
    expect(flat(within(row).getByText('Thu 19')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(within(row).getByText('Lower body')).color).toBe(sc.textOnAccent);
    expect(flat(within(row).getByText('planned')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(within(view.getByTestId('week-row-Upper body')).getByText('done')).color).toBe(sc.data.leaf);
  });

  it('a week row: 64 pt, the light 44 pt ring, the span in Inter 17 over its line muted, the chevron (rows 900-1027, 1388-1411)', async () => {
    const view = await mount(weeksPage(), device);
    for (const [id, line] of [['earlier-2026-11-09', '1 of 2 done'], ['coming-2026-11-23', '1 to go']]) {
      const row = view.getByTestId(id);
      expect(flat(row).minHeight).toBe(64);
      expect(flat(row).borderBottomColor).toBe(sc.border);
      expect(flat(view.getByTestId(id.replace('-', '-ring-'))).width).toBe(44);
      expect(flat(within(row).getByText(line)).color).toBe(sc.textMuted);
    }
    expect(flat(within(view.getByTestId('earlier-2026-11-09')).getByText('Nov 9 to 15')).fontFamily).toBe(typography.h4.fontFamily);
    expect(flat(view.getByText('Earlier')).fontSize).toBe(typography.eyebrow.fontSize);
    expect(flat(view.getByText('Coming up')).fontSize).toBe(typography.eyebrow.fontSize);
  });

  it('the key: 18 pt marks on the light ground (rows 1434-1469)', async () => {
    const view = await mount(weeksPage(), device);
    const marks = hosts(view.getByTestId('week-legend')).filter((n) => flat({ props: { style: n.props.style } }).width === 18);
    expect(marks).toHaveLength(3);
  });

  it('320 pt: the name may go under the day, nothing is clamped', async () => {
    const view = await mount(weeksPage(), device);
    expect(flat(within(view.getByTestId('week-row-Lower body')).getByText('Lower body')).minWidth).toBe(112);
    for (const n of hosts(view.toJSON())) {
      expect(n.props.numberOfLines).toBeUndefined();
      expect(n.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });
});
