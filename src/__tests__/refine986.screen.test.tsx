/**
 * REFINE-986 (fix round 1 on m#986): an exercise's page moves toward the picked C1 Style C v2 drawing
 * (planning/MOCKUP3/C1/style-c-v2/C2_detail_ios390_100.png; pixel rows and columns at 2x in each name): a bar with no
 * title and no back label, the drawn play control at its right (only while a demonstration can show, never a dead
 * tap), the drawn meta line "Chest · Barbell", and the drawn gaps in the tiles, the YOUR HISTORY head and the rows.
 * The real ExerciseDetailScreen in a navigator; only the HTTP client (services/api) and the video player are mocked,
 * as workoutDetailM.screen.test.tsx mocks them. The bar is read through a test header that draws the options the
 * screen sets (title and headerRight) on both registrations: the plain push and the modal over the live workout.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { CommonActions, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackHeaderProps } from '@react-navigation/native-stack';
import type { AxiosResponse } from 'axios';

jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View: MockView } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) => ReactLib.createElement(MockView, { testID: props.testID }),
  };
});
type StatusListener = (e: { status: string }) => void;
const mockPlayer = {
  loop: false,
  play: jest.fn(),
  listener: null as StatusListener | null,
  addListener(_name: string, cb: StatusListener) {
    mockPlayer.listener = cb;
    return { remove: () => undefined };
  },
};
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('../theme/tokens');
    return { semanticColors: t.lightTokens };
  },
}));
jest.mock('../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get, defaults: { baseURL: 'http://test.local/api' } }, get };
});

import api from '../services/api';
import ExerciseDetailScreen, { metaLine } from '../screens/client/ExerciseDetailScreen';
import { lightTokens, spacing, typography } from '../theme/tokens';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const HISTORY = '/workouts/exercise-history';
const HIDDEN = { includeHiddenElements: true } as const;

function ok<T>(data: T): AxiosResponse<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as any };
}
const httpError = (status: number) => ({ response: { status } });

// Fictional rows in the shape the /exercises fallback maps (exerciseCatalog.ts fromLibrary): category is the body
// part, primaryMuscle the target, difficulty ''.
const DETAIL = {
  id: 'seed:push-001', slug: 'seed:push-001', name: 'Bench press', primaryMuscle: 'pectorals', category: 'chest',
  difficulty: '', secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Lie flat on the bench.'],
  playbackUrl: null as string | null, gifUrl: null as string | null,
};
const VIDEO = { ...DETAIL, playbackUrl: 'https://stream.test.local/bench.m3u8' };
const GIF = { ...DETAIL, gifUrl: 'https://media.test.local/bench.gif' };

function session(date: string, weight: number, reps: number, comments: [string, string][] = []) {
  return {
    workout_id: `w-${date}`, date, sets: 3, reps_per_set: [reps, reps, reps], weight_per_set_lbs: [weight, weight, weight],
    rpe: null, top_set: { weight_lbs: weight, reps }, est_1rm_lbs: null, volume_lbs: weight * reps * 3,
    coach_comments: comments.map(([coach_name, body]) => ({ coach_name, body })),
  };
}
const oct13 = session('2026-10-13', 155, 6, [['Sam', 'Bar speed looked good.']]);
const CASE1 = {
  best: { date: oct13.date, top_set: oct13.top_set },
  first: { date: '2026-09-22', top_set: { weight_lbs: 145, reps: 6 } },
  sessions: [oct13, session('2026-10-06', 150, 6), session('2026-09-29', 150, 5), session('2026-09-22', 145, 6)],
};
const TWO_COACHES = {
  best: { date: '2026-10-13', top_set: { weight_lbs: 155, reps: 6 } },
  first: { date: '2026-10-13', top_set: { weight_lbs: 155, reps: 6 } },
  sessions: [session('2026-10-13', 155, 6, [['Rowan Avery', 'Keep the elbows in.'], ['Sam', 'Good depth today.']])],
};

type Reply = { data: unknown } | { fail: unknown } | 'pending';
function serve(catalog: Reply, history: Reply = { data: CASE1 }) {
  const reply = (r: Reply) => (r === 'pending' ? new Promise(() => undefined)
    : 'fail' in r ? Promise.reject(r.fail) : Promise.resolve(ok(r.data)));
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) return reply(catalog);
    if (url.startsWith(HISTORY)) return reply(history);
    return Promise.reject(httpError(404));
  });
}

/** The bar as the screen leaves it: the test header draws the merged options' title and headerRight. */
let bar: NativeStackHeaderProps['options'] | null = null;
function TestBar({ options }: NativeStackHeaderProps) {
  bar = options;
  return (
    <View testID="bar">
      <Text testID="bar-title">{typeof options.title === 'string' ? options.title : ''}</Text>
      {options.headerRight ? options.headerRight({ canGoBack: true }) : null}
    </View>
  );
}
// The way in: 'modal' is ClientNavigator.tsx:549-562's one registration (both the library row and Watch in the live
// workout open it); 'push' is a plain stack screen, to show the screen sets the same bar under either presentation.
function screen(way: 'modal' | 'push' = 'modal', idOrSlug = 'seed:push-001') {
  const options = way === 'modal'
    ? { headerShown: true, title: 'Exercise', headerShadowVisible: false, presentation: 'modal' as const, header: TestBar }
    : { headerShown: true, header: TestBar };
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug }} options={options} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}
const flush = () => waitFor(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const flat = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as ViewStyle & TextStyle) ?? {}) as ViewStyle & TextStyle;
const edge = (st: ViewStyle, side: 'Top' | 'Bottom' | 'Left' | 'Right') => {
  const axis = side === 'Top' || side === 'Bottom' ? st.paddingVertical : st.paddingHorizontal;
  return st[`padding${side}` as const] ?? axis ?? st.padding;
};
const PLAY = 'Play demonstration';
/** The play control in the bar the screen sets (the native header config draws the same headerRight). */
const inBar = (view: { getByTestId: (id: string) => unknown }) => within(view.getByTestId('bar') as never);
// The jest preset's ScrollView mock keeps scrollTo on its prototype (clientFileStyleC150.test.tsx reads it the same way).
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;

beforeEach(() => {
  get.mockReset();
  scrollTo.mockClear();
  mockPlayer.play.mockReset();
  mockPlayer.listener = null;
  bar = null;
});

// ─── The bar (C2_detail rows 130-161: a bare back at cols 58-75, no title, a play triangle at cols 703-726) ─────

it.each(['modal', 'push'] as const)('the bar on the %s way in has no title and a back with no label (rows 130-161 hold no word)', async (way) => {
  serve({ data: DETAIL });
  const view = await screen(way);
  await view.findByTestId('exercise-detail-screen');
  await waitFor(() => expect(bar?.title).toBe(''));
  expect(bar?.headerBackButtonDisplayMode).toBe('minimal');
  expect(view.getByTestId('bar-title').props.children).toBe('');
  expect(view.queryByText('Exercise')).toBeNull();
  // The page keeps a spoken name: its own title is the screen's header.
  expect(view.getByText('Bench press').props.accessibilityRole).toBe('header');
});

it.each([
  ['a video', VIDEO, 'exercise-detail-player'],
  ['an animation only', GIF, 'exercise-detail-animation'],
] as const)('the play control shows at the bar\'s right with %s, 44 pt, spoken "Play demonstration" (cols 703-726)', async (_l, detail, demoId) => {
  serve({ data: detail });
  const view = await screen();
  await view.findByTestId(demoId);
  const play = await inBar(view).findByRole('button', { name: PLAY });
  const st = flat(play);
  expect(st.minHeight).toBeGreaterThanOrEqual(44);
  expect(st.minWidth).toBeGreaterThanOrEqual(44);
  const glyph = flat(within(play).getByText(/^[\uE000-\uF8FF]+$/));
  expect([glyph.color, glyph.fontSize]).toEqual([lightTokens.textPrimary, 21]);
});

it.each(['modal', 'push'] as const)('a play press on the %s way scrolls to the video and starts it (the player keeps its controls)', async (way) => {
  serve({ data: VIDEO });
  const view = await screen(way);
  const player = await view.findByTestId('exercise-detail-player');
  await fireEvent(player, 'layout', { nativeEvent: { layout: { x: 0, y: 612, width: 342, height: 192 } } });
  await fireEvent.press(await inBar(view).findByRole('button', { name: PLAY }));
  expect(scrollTo).toHaveBeenCalledWith({ y: 612, animated: true });
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(player.props.fullscreenOptions).toEqual({ enable: true });
  expect(mockPlayer.loop).toBe(false);
});

it('a play press with an animation only scrolls to it and starts nothing (no throw)', async () => {
  serve({ data: GIF });
  const view = await screen();
  const gif = await view.findByTestId('exercise-detail-animation');
  await fireEvent(gif, 'layout', { nativeEvent: { layout: { x: 0, y: 598, width: 342, height: 192 } } });
  await fireEvent.press(await inBar(view).findByRole('button', { name: PLAY }));
  expect(scrollTo).toHaveBeenCalledWith({ y: 598, animated: true });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('no play control while the page loads (KT-3: a drawn control with nothing to do is not drawn)', async () => {
  serve('pending');
  const view = await screen();
  await view.findByTestId('exercise-detail-loading');
  await flush();
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('no play control on the missing page (404 from the catalog and the library)', async () => {
  get.mockImplementation(() => Promise.reject(httpError(404)));
  const view = await screen('modal', '0025');
  await view.findByTestId('exercise-detail-missing');
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('no play control on the failed page; Retry still bumps the read and the play control comes with the video', async () => {
  get.mockRejectedValueOnce(httpError(500));
  const view = await screen();
  await view.findByTestId('exercise-detail-error');
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  serve({ data: VIDEO });
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  await view.findByTestId('exercise-detail-player');
  expect(await inBar(view).findByRole('button', { name: PLAY })).toBeTruthy();
});

it('no play control with no media (the no-demonstration line stays as main draws it)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  await view.findByTestId('exercise-detail-no-video');
  await flush();
  expect(view.getByText('No demonstration available for this exercise.')).toBeTruthy();
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('the play control goes when the video fails (statusChange error), with main\'s failed-media line', async () => {
  serve({ data: VIDEO });
  const view = await screen();
  await inBar(view).findByRole('button', { name: PLAY });
  await act(async () => { mockPlayer.listener?.({ status: 'error' }); });
  await view.findByTestId('exercise-detail-no-video');
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('the play control goes when the animation fails to load (the Image\'s onError)', async () => {
  serve({ data: GIF });
  const view = await screen();
  await inBar(view).findByRole('button', { name: PLAY });
  await fireEvent(view.getByTestId('exercise-detail-animation'), 'error');
  await view.findByTestId('exercise-detail-no-video');
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
});

// ─── The meta line (C2_detail rows 287-307: "Chest · Barbell", the body part and the equipment) ────────────────

it.each([
  ['both facts', { category: 'chest', equipment: ['barbell'] }, 'Chest · Barbell'],
  ['two-word equipment', { category: 'chest', equipment: ['body weight', 'bench'] }, 'Chest · Body weight'],
  ['the body part only', { category: 'core', equipment: [] }, 'Core'],
  ['the equipment only', { category: '', equipment: ['barbell'] }, 'Barbell'],
  ['the two equal (drawn once)', { category: 'cardio', equipment: ['Cardio'] }, 'Cardio'],
  ['neither: main\'s line exactly', { category: '', equipment: [], primaryMuscle: 'pectorals', difficulty: 'intermediate' }, 'pectorals · intermediate'],
  ['neither and nothing else', { category: '', equipment: [], primaryMuscle: '', difficulty: '' }, ''],
])('metaLine: %s', (_l, part, expected) => {
  expect(metaLine({ ...DETAIL, ...part })).toBe(expected);
});

it('the page draws the meta line "Chest · Barbell" under the title (rows 287-307), muted', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const meta = await view.findByText('Chest · Barbell');
  expect(flat(meta).color).toBe(lightTokens.textMuted);
  expect(view.queryByText('pectorals · chest')).toBeNull();
});

// ─── The closed numbers (each pinned to the drawn value; GOAL C2_detail_ios390_100 rows at 2x) ──────────────────

it('title: 14.5 pt under the bar (bar end 91 pt, ink row 212) and the drawn letter spacing (cols 50-335)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const scroll = await view.findByTestId('exercise-detail-screen');
  expect(flat({ props: { style: scroll.props.contentContainerStyle } }).paddingTop).toBe(spacing.sm);
  const title = flat(view.getByText('Bench press'));
  expect(title.letterSpacing).toBe(0);
  expect(title.fontSize).toBe(typography.h1.fontSize);
  expect(title.lineHeight).toBe(typography.h1.lineHeight);
  expect(flat(view.getByText('Chest · Barbell')).marginTop).toBe(0); // title ink 212 to meta ink 287
});

it('tiles: 1 pt under the meta line (meta baseline 307 to the first block 346), 14 pt padding top and bottom (rows 574-831)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const tiles = await view.findByTestId('exercise-history-tiles');
  expect(flat(tiles).marginTop).toBe(1);
  for (const id of ['exercise-history-best', 'exercise-history-since']) {
    const st = flat(view.getByTestId(id));
    expect([edge(st, 'Top'), edge(st, 'Bottom'), edge(st, 'Left'), edge(st, 'Right')]).toEqual([14, 14, spacing.lg, spacing.lg]);
  }
});

it('Since week 1 line: 102 pt from start to end centre (cols 440-646) plus the 10 pt end point, 2 pt under the number (rows 700-751)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const line = flat(await view.findByTestId('exercise-history-since-line'));
  expect(line.width).toBe(112);
  expect(line.marginTop).toBe(2);
});

it('YOUR HISTORY: its rule 3.5 pt under the eyebrow (rows 883-890), 18.5 pt under the tiles (831-868)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  await view.findByTestId('exercise-history');
  const head = flat(view.getByText('Your history'));
  expect(head.paddingBottom).toBe(0);
  expect(head.marginTop).toBe(spacing.lg);
  expect(head.marginBottom).toBe(0);
  // MUSCLES keeps the shared sectionHead (no drawing shows it).
  expect(flat(view.getByText('MUSCLES')).paddingBottom).toBe(spacing.xs);
});

it('rows: 10 pt from the rule to the line box (value cap row 926), strip on its drawn rows (976-999), 10 pt to the next rule', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const row = flat(await view.findByTestId('exercise-history-row-1'));
  expect([edge(row, 'Top'), edge(row, 'Bottom')]).toEqual([10, 10]);
  const strip = flat(view.getByTestId('exercise-history-strip-1', HIDDEN));
  expect([strip.marginTop, strip.marginBottom]).toEqual([6, 3]);
});

it('row value: Inter Medium 16 with proportional figures (cols 193-337; "1" at 193-203), the star 7 pt after it (337 to 351)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  const value = flat(await view.findByText('155 × 6 lb'));
  expect(value.fontVariant).toBeUndefined();
  expect([value.fontFamily, value.fontSize]).toEqual([typography.bodyMd.fontFamily, typography.bodyMd.fontSize]);
  expect(flat(view.getByTestId('exercise-history-value-0')).gap).toBe(6);
});

it('comment: 6 pt under the strip (999 to 1017), the next one spacing.sm under it; Cormorant 16 on 20 (pitch 1334 to 1374)', async () => {
  serve({ data: DETAIL }, { data: TWO_COACHES });
  const view = await screen();
  const first = flat(await view.findByText('Rowan Avery: Keep the elbows in.'));
  const second = flat(view.getByText('Sam: Good depth today.'));
  expect(first.marginTop).toBe(3);
  expect(second.marginTop).toBe(spacing.sm);
  expect([first.fontSize, first.lineHeight]).toEqual([16, 20]);
});

// ─── The round 1 lenses' unheld rules (LS-986R1 C3; LO-986R1 C1 to C3), each pinned so its mutation goes red ─────

const day = (date: string, weight: number, reps: number) => session(date, weight, reps);
const answerOf = (sessions: ReturnType<typeof session>[], best: { date: string; top_set: { weight_lbs: number; reps: number } },
  first: { date: string; top_set: { weight_lbs: number; reps: number } | null }) => ({ best, first, sessions });

it('LO-986R1 C1: the Since week 1 change in the drawn forest (C2_detail "+20 lb" rows 645-680, the data forest token), not ink', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  // This file's week 1 is Sep 22 at 145, so the change reads +10 lb.
  const change = await within(await view.findByTestId('exercise-history-since')).findByText('+10 lb');
  expect(flat(change).color).toBe(lightTokens.data.forest);
});

it('LS-986R1 C3: two rows on the best day with the best set: the star sits on one row only, the older', async () => {
  const a = { ...day('2026-10-13', 155, 6), workout_id: 'w-a' };
  const b = { ...day('2026-10-13', 155, 6), workout_id: 'w-b' };
  serve({ data: DETAIL }, { data: answerOf([a, b, day('2026-09-22', 145, 6)], { date: a.date, top_set: a.top_set }, { date: '2026-09-22', top_set: { weight_lbs: 145, reps: 6 } }) });
  const view = await screen();
  await view.findByTestId('exercise-history-row-2');
  expect(view.getAllByTestId('exercise-history-star')).toHaveLength(1);
  expect(within(view.getByTestId('exercise-history-row-1')).getByTestId('exercise-history-star')).toBeTruthy();
  expect(view.getAllByTestId(/^exercise-history-dot-/, HIDDEN).filter((d) => flat(d).backgroundColor === lightTokens.data.peak)).toHaveLength(1);
});

it('LS-986R1 C3, LO-986R1 C2: week 1 at body weight with two later weighted sessions draws no Since week 1 tile', async () => {
  const bw = day('2026-09-15', 0, 10);
  serve({ data: DETAIL }, { data: answerOf([day('2026-10-13', 155, 6), day('2026-10-06', 150, 6), bw],
    { date: '2026-10-13', top_set: { weight_lbs: 155, reps: 6 } }, { date: bw.date, top_set: bw.top_set }) });
  const view = await screen();
  await view.findByTestId('exercise-history-best');
  expect(view.queryByTestId('exercise-history-since')).toBeNull();
  expect(view.queryByText(/^[+\u2212]\d+ lb$/)).toBeNull();
});

it('LS-986R1 C3, LO-986R1 C3: the strip is hidden from screen readers (no dot or track without hidden elements)', async () => {
  serve({ data: DETAIL });
  const view = await screen();
  await view.findByTestId('exercise-history-row-0');
  expect(view.queryByTestId('exercise-history-dot-0')).toBeNull();
  expect(view.queryByTestId('exercise-history-track-0')).toBeNull();
  expect(view.getByTestId('exercise-history-dot-0', HIDDEN)).toBeTruthy();
});

it('LS-986R1 C3: Best ever is drawn as the server sends it, never recomputed from the rows (H2)', async () => {
  serve({ data: DETAIL }, { data: answerOf([day('2026-10-13', 155, 6), day('2026-10-06', 150, 6)],
    { date: '2025-08-01', top_set: { weight_lbs: 200, reps: 3 } }, { date: '2025-01-05', top_set: { weight_lbs: 100, reps: 5 } }) });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText('200 × 3')).toBeTruthy();
  expect(within(best).getByText('Aug 1')).toBeTruthy();
  expect(view.queryAllByTestId('exercise-history-star')).toHaveLength(0);
});

it('LS-986R1 C3: a history answer for a page run that was replaced (new route param) is dropped; the new run draws its own', async () => {
  const nav = createNavigationContainerRef<WorkoutStackParamList>();
  const pending: Record<string, (v: unknown) => void> = {};
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) {
      const id = decodeURIComponent(url.split('/').pop() ?? '');
      return Promise.resolve(ok({ ...DETAIL, id, name: id === 'seed:push-002' ? 'Incline press' : 'Bench press' }));
    }
    return new Promise((r) => { pending[decodeURIComponent(url.split('name=')[1] ?? '')] = r; });
  });
  const view = await render(
    <NavigationContainer ref={nav}>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: 'seed:push-001' }} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await view.findByText('Bench press');
  await waitFor(() => expect(pending['Bench press']).toBeDefined());
  await act(async () => { nav.dispatch(CommonActions.setParams({ idOrSlug: 'seed:push-002' })); });
  await view.findByText('Incline press');
  await waitFor(() => expect(pending['Incline press']).toBeDefined());
  await act(async () => { pending['Bench press'](ok(CASE1)); });
  await flush();
  expect(view.queryByTestId('exercise-history')).toBeNull();
  await act(async () => { pending['Incline press'](ok(TWO_COACHES)); });
  expect(await view.findByText('Sam: Good depth today.')).toBeTruthy();
  expect(view.queryByTestId('exercise-history-row-1')).toBeNull();
});
