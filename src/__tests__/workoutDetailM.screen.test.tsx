/**
 * WORKOUT-DETAIL-M: an exercise's page shows the client's own history from the server (GET /workouts/exercise-history,
 * TRAIN-BE2) as the picked C1 Style C v2 C2_detail draws it: Best ever, Since week 1, and each session with its strip
 * and the coach's comments. Every other history state (loading, failed, none) draws nothing of it, and the page's own
 * loading, missing and failed states are main's. The real ExerciseDetailScreen in a navigator; only the HTTP client
 * (services/api) is mocked, as w3ExerciseDetailMissing918.screen.test.tsx mocks it. Cases are the job's numbers.
 */
process.env.TZ = 'America/Los_Angeles';

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AxiosResponse } from 'axios';

jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) => ReactLib.createElement(View, { testID: props.testID }),
  };
});
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, addListener: () => ({ remove: () => undefined }) }),
  VideoView: 'VideoView',
}));
let mockDark = false;
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('../theme/tokens');
    return { semanticColors: mockDark ? t.darkTokens : t.lightTokens };
  },
}));
jest.mock('../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get, defaults: { baseURL: 'http://test.local/api' } }, get };
});

import api from '../services/api';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { darkTokens, lightTokens } from '../theme/tokens';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const HISTORY = '/workouts/exercise-history';
// The strip is hidden from screen readers (question 4); its parts are found with hidden elements included.
const HIDDEN = { includeHiddenElements: true } as const;

function ok<T>(data: T): AxiosResponse<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as any };
}
const httpError = (status: number) => ({ response: { status } });
const noAnswer = { message: 'Network Error' };
const timeout = { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };

const DETAIL = {
  id: 'seed:push-001', slug: 'seed:push-001', name: 'Bench press', primaryMuscle: 'chest', category: 'chest',
  difficulty: '', secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Lie flat on the bench.'],
  playbackUrl: null, gifUrl: null,
};

type Comment = [string, string];
function session(date: string, weight: number, reps: number, comments: Comment[] = [], sets = 3) {
  return {
    workout_id: `w-${date}`, date, sets, reps_per_set: Array(sets).fill(reps), weight_per_set_lbs: Array(sets).fill(weight),
    rpe: null, top_set: reps >= 1 ? { weight_lbs: weight, reps } : null, est_1rm_lbs: null, volume_lbs: weight * reps * sets,
    coach_comments: comments.map(([coach_name, body]) => ({ coach_name, body })),
  };
}
type Session = ReturnType<typeof session>;
const point = (s: Session) => ({ date: s.date, top_set: s.top_set });
const answer = (sessions: Session[], best: Session | null, first?: ReturnType<typeof point> | null) => ({
  best: best ? point(best) : null,
  first: first === undefined ? (sessions.length ? point(sessions[sessions.length - 1]) : null) : first,
  sessions,
});

const BAR_SPEED = 'Sam: Bar speed looked good.';
const PAUSE = 'Sam: Try a one-second pause next week.';
// Case 1: C2_detail's four rows plus the week 1 its line starts from.
const c1 = {
  oct13: session('2026-10-13', 155, 6, [['Sam', 'Bar speed looked good.']]),
  oct6: session('2026-10-06', 150, 6),
  sep29: session('2026-09-29', 150, 5, [['Sam', 'Try a one-second pause next week.']]),
  sep22: session('2026-09-22', 145, 6),
  sep15: session('2026-09-15', 135, 8),
};
const CASE1 = answer([c1.oct13, c1.oct6, c1.sep29, c1.sep22, c1.sep15], c1.oct13);
// Case 2: the best (Oct 6, 160 x 5) is not the newest; Sep 29 lifted the same weight for fewer reps.
const best2 = session('2026-10-06', 160, 5);
const CASE2 = answer([c1.oct13, best2, session('2026-09-29', 160, 3), c1.sep22, c1.sep15], best2);
const NONE = { best: null, first: null, sessions: [] };

type Reply = { data: unknown } | { fail: unknown } | 'pending';
function serve(history: Reply, catalog: Reply = { data: DETAIL }) {
  const reply = (r: Reply) => (r === 'pending' ? new Promise(() => undefined)
    : 'fail' in r ? Promise.reject(r.fail) : Promise.resolve(ok(r.data)));
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) return reply(catalog);
    if (url.startsWith(HISTORY)) return reply(history);
    return Promise.reject(httpError(404));
  });
}
const historyCalls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(HISTORY));

function screen(idOrSlug = 'seed:push-001', modal = false) {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug }}
          options={modal ? { headerShown: true, title: 'Exercise', headerShadowVisible: false, presentation: 'modal' } : undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}
/** Lets the history read settle (its promise chain is a few microtasks long). */
const flush = () => waitFor(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const texts = (node: { props: { children?: unknown } }) => within(node as never).queryAllByText(/./).map((n) => n.props.children);
type Inst = { type: unknown; props: Record<string, unknown>; children: (Inst | string)[] };
/** The page's drawn shape: every host element's type, testID and words, in order (no navigator keys). */
function shape(root: Inst): string[] {
  const out: string[] = [];
  const walk = (n: Inst | string) => {
    if (typeof n === 'string') { out.push(`"${n}"`); return; }
    if (typeof n.type === 'string') out.push(`${n.type}#${String(n.props.testID ?? '')}`);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}
const bg = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}).backgroundColor;

beforeEach(() => {
  get.mockReset();
  mockDark = false;
});

it('case 1: Best ever 155 x 6 on Oct 13, Since week 1 +20 lb ending gold, five rows newest first with the star on Oct 13 and Sam under Oct 13 and Sep 29', async () => {
  serve({ data: CASE1 });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText('Best ever')).toBeTruthy();
  expect(within(best).getByText('155 × 6')).toBeTruthy();
  expect(within(best).getByText('Oct 13')).toBeTruthy();
  expect(bg(best)).toBe(lightTokens.surface.masthead);

  const since = view.getByTestId('exercise-history-since');
  expect(within(since).getByText('Since week 1')).toBeTruthy();
  expect(within(since).getByText('+20 lb')).toBeTruthy();
  expect(within(since).getByText('on your top set')).toBeTruthy();
  expect(bg(since)).toBe(lightTokens.surface.sage);
  expect(view.getByLabelText('Top set, week 1 to today: 135 to 155 lb')).toBeTruthy();
  expect(bg(view.getByTestId('exercise-history-since-end'))).toBe(lightTokens.data.peak);

  expect(view.getByText('Your history')).toBeTruthy();
  const rows = [0, 1, 2, 3, 4].map((i) => view.getByTestId(`exercise-history-row-${i}`));
  expect(view.queryByTestId('exercise-history-row-5')).toBeNull();
  expect(rows.map((r) => within(r).getAllByText(/^(Oct|Sep) \d+$/)[0].props.children))
    .toEqual(['Oct 13', 'Oct 6', 'Sep 29', 'Sep 22', 'Sep 15']);
  expect(rows.map((r) => within(r).getByText(/ lb$/).props.children))
    .toEqual(['155 × 6 lb', '150 × 6 lb', '150 × 5 lb', '145 × 6 lb', '135 × 8 lb']);
  rows.forEach((r) => expect(within(r).getByText('3 sets')).toBeTruthy());

  expect(view.getAllByTestId('exercise-history-star')).toHaveLength(1);
  expect(within(rows[0]).getByTestId('exercise-history-star')).toBeTruthy();
  expect(within(rows[0]).getByLabelText('Best ever')).toBeTruthy();
  expect(bg(within(rows[0]).getByTestId('exercise-history-dot-0', HIDDEN))).toBe(lightTokens.data.peak);
  [1, 2, 3, 4].forEach((i) => expect(bg(within(rows[i]).getByTestId(`exercise-history-dot-${i}`, HIDDEN))).toBe(lightTokens.data.moss));

  expect(within(rows[0]).getByText(BAR_SPEED)).toBeTruthy();
  expect(within(rows[2]).getByText(PAUSE)).toBeTruthy();
  [1, 3, 4].forEach((i) => expect(within(rows[i]).queryByText(/^Sam: /)).toBeNull());
  expect(view.getAllByText(/^Sam: /)).toHaveLength(2);
});

it('case 1 and question 6: the tiles and Your history sit under the title and meta, above the demonstration and MUSCLES', async () => {
  serve({ data: CASE1 });
  const view = await screen();
  await view.findByTestId('exercise-history');
  const order = texts(view.getByTestId('exercise-detail-screen')).filter((t) => typeof t === 'string');
  const at = (s: string) => order.indexOf(s);
  expect(at('Bench press')).toBe(0);
  expect(at('Best ever')).toBeGreaterThan(at('Bench press'));
  expect(at('Your history')).toBeGreaterThan(at('Best ever'));
  expect(at('No demonstration available for this exercise.')).toBeGreaterThan(at('Your history'));
  expect(at('MUSCLES')).toBeGreaterThan(at('No demonstration available for this exercise.'));
});

it('case 2: the star on the best (Oct 6, 160 x 5) only; Since week 1 from week 1 to the newest (+20 lb), its end moss', async () => {
  serve({ data: CASE2 });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText('160 × 5')).toBeTruthy();
  expect(within(best).getByText('Oct 6')).toBeTruthy();
  expect(view.getAllByTestId('exercise-history-star')).toHaveLength(1);
  expect(within(view.getByTestId('exercise-history-row-1')).getByTestId('exercise-history-star')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-since')).getByText('+20 lb')).toBeTruthy();
  expect(view.getByLabelText('Top set, week 1 to today: 135 to 155 lb')).toBeTruthy();
  expect(bg(view.getByTestId('exercise-history-since-end'))).toBe(lightTokens.data.moss);
  expect(bg(view.getByTestId('exercise-history-dot-1', HIDDEN))).toBe(lightTokens.data.peak);
  [0, 2, 3, 4].forEach((i) => expect(bg(view.getByTestId(`exercise-history-dot-${i}`, HIDDEN))).toBe(lightTokens.data.moss));
});

it('case 3: one session shows Best ever and one row, and no Since week 1 tile', async () => {
  serve({ data: answer([c1.oct13], c1.oct13) });
  const view = await screen();
  expect(within(await view.findByTestId('exercise-history-best')).getByText('155 × 6')).toBeTruthy();
  expect(view.queryByTestId('exercise-history-since')).toBeNull();
  expect(view.queryByText('Since week 1')).toBeNull();
  expect(view.getByTestId('exercise-history-row-0')).toBeTruthy();
  expect(view.queryByTestId('exercise-history-row-1')).toBeNull();
});

async function pageWith(history: Reply) {
  get.mockClear();
  serve(history);
  const view = await screen();
  await view.findByTestId('exercise-detail-screen');
  await waitFor(() => expect(historyCalls()).toHaveLength(1));
  await flush();
  return view;
}

let mainShape: string[] = [];
it('case 5 (pending): while the history read is out, the page is main\'s page', async () => {
  const view = await pageWith('pending');
  mainShape = shape(view.getByTestId('exercise-detail-screen') as unknown as Inst);
  expect(mainShape.filter((x) => x.includes('exercise-history'))).toEqual([]);
  expect(mainShape).toEqual(expect.arrayContaining(['"Bench press"', '"MUSCLES"', '"Lie flat on the bench."']));
});

it.each([
  ['case 4: no session', { data: NONE }],
  ['case 5: a server error', { fail: httpError(500) }],
  ['case 5: a timeout', { fail: timeout }],
  ['case 5: no network', { fail: noAnswer }],
] as [string, Reply][])('%s draws exactly the page as it was, and none of the history words', async (_l, reply) => {
  const view = await pageWith(reply);
  expect(view.queryByTestId('exercise-history')).toBeNull();
  for (const word of ['Best ever', 'Since week 1', 'Your history', 'on your top set']) expect(view.queryByText(word)).toBeNull();
  expect(mainShape.length).toBeGreaterThan(0);
  expect(shape(view.getByTestId('exercise-detail-screen') as unknown as Inst)).toEqual(mainShape);
});

it('case 5: the catalog failure keeps its words and Retry, and a Retry of the page reads both again', async () => {
  let catalogTries = 0;
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) {
      catalogTries += 1;
      return catalogTries === 1 ? Promise.reject(httpError(500)) : Promise.resolve(ok(DETAIL));
    }
    if (url.startsWith(HISTORY)) return Promise.resolve(ok(CASE1));
    return Promise.reject(httpError(404));
  });
  const view = await screen();
  expect(await view.findByText('Exercise details did not load. Check your connection and try again.')).toBeTruthy();
  expect(historyCalls()).toEqual([]);
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('exercise-history-best')).toBeTruthy();
  expect(historyCalls()).toEqual([`${HISTORY}?name=Bench%20press`]);
});

it.each([
  ['missing (404 on catalog and fallback)', [httpError(404), httpError(404)], 'exercise-detail-missing'],
  ['failed (500)', [httpError(500)], 'exercise-detail-error'],
])('case 6: the catalog read %s shows main\'s state and asks for no history', async (_l, failures, testID) => {
  for (const f of failures) get.mockRejectedValueOnce(f);
  const view = await screen();
  expect(await view.findByTestId(testID)).toBeTruthy();
  await flush();
  expect(historyCalls()).toEqual([]);
  expect(view.queryByTestId('exercise-history')).toBeNull();
});

it('case 7: a body-weight exercise reads BW x 12, with no Since week 1', async () => {
  const s13 = session('2026-10-13', 0, 12);
  serve({ data: answer([s13, session('2026-10-06', 0, 10)], s13) });
  const view = await screen();
  expect(within(await view.findByTestId('exercise-history-best')).getByText('BW × 12')).toBeTruthy();
  expect(view.queryByTestId('exercise-history-since')).toBeNull();
  expect(within(view.getByTestId('exercise-history-row-0')).getByText('BW × 12')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-row-1')).getByText('BW × 10')).toBeTruthy();
  expect(view.getAllByLabelText('body weight by 12').length).toBeGreaterThan(0);
});

it('case 8: two comments from two coaches (one former) both show under the session, oldest first, each with its name', async () => {
  const s = session('2026-10-13', 155, 6, [['Rowan Former', 'Keep the elbows in.'], ['Sam', 'Good depth today.']]);
  serve({ data: answer([s], s) });
  const view = await screen();
  const row = await view.findByTestId('exercise-history-row-0');
  const lines = within(row).getAllByText(/: /).map((n) => n.props.children);
  expect(lines).toEqual(['Rowan Former: Keep the elbows in.', 'Sam: Good depth today.']);
});

it.each([
  ['a seed id', 'seed:push-001', 'Bench press', 'name=Bench%20press'],
  ['a name with an ampersand and spaces around it', '0025', '  Curl & press ', 'name=Curl%20%26%20press'],
])('case 9: the request for %s is GET /workouts/exercise-history with the page name only', async (_l, idOrSlug, name, query) => {
  serve({ data: CASE1 }, { data: { ...DETAIL, id: idOrSlug, name } });
  const view = await screen(idOrSlug);
  await view.findByTestId('exercise-history');
  expect(historyCalls()).toEqual([`${HISTORY}?${query}`]);
  const sent = get.mock.calls.filter((c) => String(c[0]).startsWith(HISTORY));
  expect(sent.every((c) => c.length === 1)).toBe(true);
  expect(historyCalls()[0]).not.toMatch(/exercise_id|user|routine|manual|ex_/);
});

it('case 10: the rows and the Best ever date read the calendar day in Los Angeles (never the UTC midnight)', async () => {
  serve({ data: CASE1 });
  const view = await screen();
  expect(within(await view.findByTestId('exercise-history-best')).getByText('Oct 13')).toBeTruthy();
  expect(view.queryByText('Oct 12')).toBeNull();
  expect(view.getAllByLabelText('October 13').length).toBeGreaterThan(0);
});

it('case 11: a long name and a 60-character comment wrap whole; tiles wrap rather than clip; nothing new is pressable', async () => {
  const LONG_NAME = 'Single-arm dumbbell row on incline bench';
  const LONG_COMMENT = 'Brace hard before every rep and keep the shoulder blade low.';
  expect([LONG_NAME.length, LONG_COMMENT.length]).toEqual([40, 60]);
  const s = session('2026-10-13', 155, 6, [['Sam', LONG_COMMENT]]);
  serve({ data: answer([s, c1.sep15], s) }, { data: { ...DETAIL, name: LONG_NAME } });
  const view = await screen();
  const section = await view.findByTestId('exercise-history');
  expect(view.getByText(LONG_NAME)).toBeTruthy();
  expect(view.getByText(`Sam: ${LONG_COMMENT}`)).toBeTruthy();
  const all = within(section).queryAllByText(/./);
  expect(all.filter((n) => n.props.numberOfLines || n.props.adjustsFontSizeToFit || n.props.allowFontScaling === false)).toEqual([]);
  expect(within(section).queryAllByRole('button')).toEqual([]);
  const tiles = StyleSheet.flatten(view.getByTestId('exercise-history-tiles').props.style as ViewStyle);
  expect(tiles.flexWrap).toBe('wrap');
  for (const id of ['exercise-history-best', 'exercise-history-since']) {
    const st = StyleSheet.flatten(view.getByTestId(id).props.style as ViewStyle);
    expect(st.width).toBeUndefined();
    expect(st.height).toBeUndefined();
    expect(typeof st.minWidth).toBe('number');
  }
});

it('case 12: dark takes the dark tokens and the Best ever tile keeps surface.masthead', async () => {
  mockDark = true;
  serve({ data: CASE1 });
  const view = await screen();
  expect(bg(await view.findByTestId('exercise-history-best'))).toBe(darkTokens.surface.masthead);
  expect(bg(view.getByTestId('exercise-history-since'))).toBe(darkTokens.surface.sage);
  const date = within(view.getByTestId('exercise-history-row-1')).getByText('Oct 6');
  expect((StyleSheet.flatten(date.props.style as TextStyle) ?? {}).color).toBe(darkTokens.textMuted);
  expect(bg(view.getByTestId('exercise-history-track-1', HIDDEN))).toBe(darkTokens.data.trackLight);
});

it('case 13: opened as the modal over the live workout, the page shows the same history; the route keeps its modal', async () => {
  serve({ data: CASE1 });
  const view = await screen('seed:push-001', true);
  expect(within(await view.findByTestId('exercise-history-best')).getByText('155 × 6')).toBeTruthy();
  expect(view.getByText(BAR_SPEED)).toBeTruthy();
  const nav = fs.readFileSync(path.join(__dirname, '../navigation/ClientNavigator.tsx'), 'utf8');
  expect(nav).toMatch(/name="ExerciseDetail"[\s\S]{0,700}presentation: 'modal'/);
});

it('H4: a timed exercise (a 60-second plank) draws what the server sends, BW x 60, with no unit guessed', async () => {
  const plank = session('2026-10-13', 0, 60, [], 1);
  serve({ data: answer([plank], plank) });
  const view = await screen();
  expect(within(await view.findByTestId('exercise-history-best')).getByText('BW × 60')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-row-0')).getByText('1 set')).toBeTruthy();
  expect(view.queryByText(/sec/)).toBeNull();
});

it('H5: 100 sessions draw as plain rows (no list inside the scroll), with week 1 older than every row', async () => {
  const sessions = Array.from({ length: 100 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 13) - i * 86400000).toISOString().slice(0, 10);
    return session(d, 150 + (i === 0 ? 5 : 0), 5);
  });
  serve({ data: answer(sessions, sessions[0], { date: '2025-01-05', top_set: { weight_lbs: 100, reps: 5 } }) });
  const view = await screen();
  await view.findByTestId('exercise-history-row-99');
  const section = shape(view.getByTestId('exercise-history') as unknown as Inst);
  expect(section.filter((x) => x.startsWith('RCTScrollView'))).toEqual([]);
  const parts = fs.readFileSync(path.join(__dirname, '../screens/client/workouts/exerciseHistoryStyleC.tsx'), 'utf8');
  expect(parts).not.toMatch(/FlatList|SectionList|VirtualizedList/);
  expect(view.getByLabelText('Top set, week 1 to today: 100 to 155 lb')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-since')).getByText('+55 lb')).toBeTruthy();
});

it('H6: a page closed before the history answers never draws it, and the next page reads its own', async () => {
  let resolveFirst: (v: unknown) => void = () => undefined;
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) return Promise.resolve(ok(DETAIL));
    return new Promise((r) => { resolveFirst = r; });
  });
  const first = await screen();
  await first.findByTestId('exercise-detail-screen');
  first.unmount();
  await act(async () => { resolveFirst(ok(CASE1)); });
  serve({ data: answer([c1.oct13], c1.oct13) });
  const next = await screen();
  await next.findByTestId('exercise-history-row-0');
  expect(next.queryByTestId('exercise-history-row-1')).toBeNull();
});
