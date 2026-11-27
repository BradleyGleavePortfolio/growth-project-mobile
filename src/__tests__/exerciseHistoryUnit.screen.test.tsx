/**
 * EXERCISE-HISTORY-UNIT-M: an exercise's page reads each set's stored unit (EXERCISE-HISTORY-UNIT-BE sends `unit` on
 * each session and inside each top set, best and first included), so a set stored in seconds reads in seconds in the
 * Best ever tile and in its Your history row: "BW × 60 sec", "30 lb × 40 sec", "0 lb × 45 sec" (owner #197-E10,
 * ctx#445 T07; the operator's R1). A set whose unit is 'reps', null, absent or anything else reads exactly as main
 * (b#1255's CONTRACT 6872975097: null is "not stored: do not guess"). The real ExerciseDetailScreen in a navigator;
 * only the HTTP client (services/api) is stood in, as workoutDetailM.screen.test.tsx does (its stand-ins copied here,
 * never imported). Cases are the job's test numbers.
 */
import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const HISTORY = '/workouts/exercise-history';
const NBSP = ' ';

function ok<T>(data: T): AxiosResponse<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as any };
}

const DETAIL = {
  id: 'seed:push-001', slug: 'seed:push-001', name: 'Bench press', primaryMuscle: 'chest', category: 'chest',
  difficulty: '', secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Lie flat on the bench.'],
  playbackUrl: null, gifUrl: null,
};
const PLANK = { ...DETAIL, id: 'seed:core-plank', slug: 'seed:core-plank', name: 'Plank', primaryMuscle: 'core',
  category: 'core', equipment: ['body weight'], instructions: ['Hold a straight line.'] };
const HOLD = { ...DETAIL, id: 'seed:carry-hold', slug: 'seed:carry-hold', name: 'Suitcase hold', primaryMuscle: 'core',
  category: 'core', equipment: ['dumbbell'], instructions: ['Hold one dumbbell at your side.'] };

/** The unit the server stored: 'absent' leaves the key out (an older server), anything else is sent as is. */
type Unit = 'reps' | 'seconds' | 'minutes' | null | 'absent';
function session(date: string, weight: number, count: number, unit: Unit, sets = 3) {
  const u = unit === 'absent' ? {} : { unit };
  return {
    workout_id: `w-${date}`, date, sets, reps_per_set: Array(sets).fill(count), weight_per_set_lbs: Array(sets).fill(weight),
    rpe: null, top_set: { weight_lbs: weight, reps: count, ...u }, est_1rm_lbs: null, volume_lbs: weight * count * sets,
    coach_comments: [] as Array<{ coach_name: string; body: string }>, ...u,
  };
}
type Session = ReturnType<typeof session>;
const point = (s: Session) => ({ date: s.date, top_set: s.top_set });
/** Newest first, as the server sends; week 1 is the oldest row. */
const answer = (sessions: Session[], best: Session) => ({
  best: point(best), first: point(sessions[sessions.length - 1]), sessions,
});
type Answer = ReturnType<typeof answer>;
/** The same answer with every unit key deleted (sessions, top sets, best and first). */
const withoutUnits = (a: Answer): Answer => JSON.parse(JSON.stringify(a, (k, v) => (k === 'unit' ? undefined : v)));

// E1: a 60-second plank her coach planned in seconds, one session of one set.
const plank = (unit: Unit) => session('2026-10-13', 0, 60, unit, 1);
// E2: a suitcase hold, 25 lb x 45 s in week 1 to 30 lb x 40 s today (the best: heaviest, then the longer hold).
const hold = (unit: Unit) => [
  session('2026-10-13', 30, 40, unit), session('2026-10-06', 30, 35, unit), session('2026-09-29', 30, 30, unit),
  session('2026-09-22', 25, 60, unit), session('2026-09-15', 25, 45, unit),
];
const HOLD_ROWS = ['30 lb × 40', '30 lb × 35', '30 lb × 30', '25 lb × 60', '25 lb × 45'].map((t) => `${t}${NBSP}sec`);
// E6: C2_detail's bench (case 1 of workoutDetailM) and case 7's body-weight shape.
const bench = (unit: Unit) => [
  session('2026-10-13', 155, 6, unit), session('2026-10-06', 150, 6, unit), session('2026-09-29', 150, 5, unit),
  session('2026-09-22', 145, 6, unit), session('2026-09-15', 135, 8, unit),
];
const bodyWeight = (unit: Unit) => [session('2026-10-13', 0, 12, unit), session('2026-10-06', 0, 10, unit)];

type Reply = { data: unknown };
function serve(history: Reply, catalog: Reply = { data: DETAIL }) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) return Promise.resolve(ok(catalog.data));
    if (url.startsWith(HISTORY)) return Promise.resolve(ok(history.data));
    return Promise.reject({ response: { status: 404 } });
  });
}
const historyCalls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(HISTORY));

const tree = (frame?: { width: number; height: number }) => {
  const nav = (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: 'seed:push-001' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
  return frame ? (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, ...frame }, insets: { top: 20, bottom: 0, left: 0, right: 0 } }}>
      {nav}
    </SafeAreaProvider>
  ) : nav;
};
const screen = (frame?: { width: number; height: number }) => render(tree(frame));
/** Lets the history read settle (its promise chain is a few microtasks long). */
const flush = () => waitFor(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

type Host = { type: unknown; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | string | null | undefined) => {
    if (!n || typeof n === 'string') return;
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host);
  return out;
}
/** Every Text's words and every spoken label under the history, in order. */
function words(root: unknown): string[] {
  return hosts(root).flatMap((n) => [
    ...(n.type === 'Text' ? [`text ${JSON.stringify(n.props.children)}`] : []),
    ...(typeof n.props.accessibilityLabel === 'string' ? [`label ${n.props.accessibilityLabel}`] : []),
  ]);
}
// StyleWorkouts.guard.test.tsx:82-89 (its textProblems check, copied): Text that cannot grow with the phone's text size.
function textProblems(root: unknown) {
  const inButton = new Set<Host>();
  hosts(root).filter((n) => n.props.accessibilityRole === 'button').forEach((b) => hosts(b).forEach((n) => inButton.add(n)));
  return hosts(root).filter((n) => n.type === 'Text' && !inButton.has(n) && JSON.stringify(n.children) !== '[""]'
    && (n.props.numberOfLines || n.props.adjustsFontSizeToFit || n.props.allowFontScaling === false))
    .map((n) => JSON.stringify(n.children));
}
/** The one Text (no nested Text) whose words are exactly `text`. */
const oneText = (root: unknown, text: string) =>
  hosts(root).filter((n) => n.type === 'Text' && n.props.children === text);

beforeEach(() => {
  get.mockReset();
});

it('1 E1: a 60-second plank reads BW × 60 sec, spoken "body weight by 60 seconds", in the tile and its row, with the star, "1 set" and no Since week 1', async () => {
  const s = plank('seconds');
  serve({ data: answer([s], s) }, { data: PLANK });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText(`BW × 60${NBSP}sec`)).toBeTruthy();
  expect(within(best).getByLabelText('body weight by 60 seconds')).toBeTruthy();
  const row = view.getByTestId('exercise-history-row-0');
  expect(within(row).getByText(`BW × 60${NBSP}sec`)).toBeTruthy();
  expect(within(row).getByLabelText('body weight by 60 seconds')).toBeTruthy();
  expect(within(row).getByTestId('exercise-history-star')).toBeTruthy();
  expect(within(row).getByText('1 set')).toBeTruthy();
  expect(view.queryByTestId('exercise-history-since')).toBeNull();
});

it('2 E2: a loaded hold reads 30 lb × 40 sec in the tile, each row its own "{w} lb × {n} sec" with no trailing lb; Since week 1 as main', async () => {
  const rows = hold('seconds');
  serve({ data: answer(rows, rows[0]) }, { data: HOLD });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  const since = view.getByTestId('exercise-history-since');
  // Since week 1 reads weights only: main's words (green at the base).
  expect(within(since).getByText('+5 lb')).toBeTruthy();
  expect(within(since).getByText('on your top set')).toBeTruthy();
  expect(view.getByLabelText('Top set, week 1 to today: 25 to 30 lb')).toBeTruthy();
  // The tile and the rows (red at the base).
  expect(within(best).getByText(`30 lb × 40${NBSP}sec`)).toBeTruthy();
  expect(within(best).getByLabelText('30 pounds by 40 seconds')).toBeTruthy();
  const texts = [0, 1, 2, 3, 4].map((i) => {
    const value = view.getByTestId(`exercise-history-value-${i}`);
    return hosts(value).filter((n) => n.type === 'Text').map((n) => n.props.children as string);
  });
  expect(texts.map((t) => t[0])).toEqual(HOLD_ROWS);
  texts.flat().forEach((t) => expect(t).not.toMatch(/ lb$/));
});

it('3 E3: a timed set of a weighted exercise at 0 (a barbell) reads 0 lb × 45 sec, spoken "0 pounds by 45 seconds", never BW', async () => {
  const s = session('2026-10-13', 0, 45, 'seconds', 2);
  serve({ data: answer([s], s) }, { data: DETAIL });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText(`0 lb × 45${NBSP}sec`)).toBeTruthy();
  expect(within(best).getByLabelText('0 pounds by 45 seconds')).toBeTruthy();
  const row = view.getByTestId('exercise-history-row-0');
  expect(within(row).getByText(`0 lb × 45${NBSP}sec`)).toBeTruthy();
  expect(within(row).getByLabelText('0 pounds by 45 seconds')).toBeTruthy();
  expect(view.queryByText(/^BW/)).toBeNull();
});

it('4 E4: a one-second set reads BW × 1 sec, spoken "body weight by 1 second"', async () => {
  const s = session('2026-10-13', 0, 1, 'seconds', 1);
  serve({ data: answer([s], s) }, { data: PLANK });
  const view = await screen();
  const best = await view.findByTestId('exercise-history-best');
  expect(within(best).getByText(`BW × 1${NBSP}sec`)).toBeTruthy();
  expect(within(best).getByLabelText('body weight by 1 second')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-row-0')).getByLabelText('body weight by 1 second')).toBeTruthy();
});

describe('5 E6: a unit of reps, null, absent or anything else reads exactly as main, every word and label', () => {
  const shapes: Array<[string, (u: Unit) => Session[], typeof DETAIL, string]> = [
    ['the C2_detail bench', bench, DETAIL, '155 × 6'],
    ['the body-weight shape', bodyWeight, PLANK, 'BW × 12'],
  ];
  const units: Unit[] = ['reps', null, 'absent', 'minutes'];
  it.each(shapes.flatMap(([name, make, detail, tile]) => units.map((u) => [String(u), name, u, make, detail, tile] as const)))(
    'unit %s on %s',
    async (_label, _name, unit, make, detail, tile) => {
      const rows = make(unit);
      const a = answer(rows, rows[0]);
      serve({ data: a }, { data: detail });
      const view = await screen();
      await view.findByTestId('exercise-history-best');
      const got = words(view.getByTestId('exercise-history'));
      await view.unmount();

      get.mockReset();
      serve({ data: withoutUnits(a) }, { data: detail });
      const plain = await screen();
      await plain.findByTestId('exercise-history-best');
      const main = words(plain.getByTestId('exercise-history'));

      expect(main).toContain(`text ${JSON.stringify(tile)}`);
      expect(got).toEqual(main);
      expect(got.join('\n')).not.toMatch(/sec/);
    },
  );
});

it('6 E5: one name logged three ways (seconds, reps, none stored): each row reads its own unit; the tile reads best\'s own; one star where main puts it', async () => {
  const mixed = [
    session('2026-10-13', 20, 45, 'seconds'), session('2026-10-06', 25, 8, 'reps'), session('2026-09-29', 20, 10, null),
  ];
  for (const bestAt of [1, 0]) {
    const a = answer(mixed, mixed[bestAt]);
    serve({ data: withoutUnits(a) }, { data: HOLD });
    const plain = await screen();
    await plain.findByTestId('exercise-history-best');
    const mainStar = [0, 1, 2].findIndex((i) =>
      within(plain.getByTestId(`exercise-history-row-${i}`)).queryByTestId('exercise-history-star'));
    await plain.unmount();

    get.mockReset();
    serve({ data: a }, { data: HOLD });
    const view = await screen();
    const best = await view.findByTestId('exercise-history-best');
    // The star (green at the base): one, on main's row.
    expect(view.getAllByTestId('exercise-history-star')).toHaveLength(1);
    expect(within(view.getByTestId(`exercise-history-row-${mainStar}`)).getByTestId('exercise-history-star')).toBeTruthy();
    expect(mainStar).toBe(bestAt);
    // The rows' text (the timed row is red at the base).
    const rowText = (i: number) => hosts(view.getByTestId(`exercise-history-value-${i}`))
      .filter((n) => n.type === 'Text').map((n) => n.props.children)[0];
    expect([0, 1, 2].map(rowText)).toEqual([`20 lb × 45${NBSP}sec`, '25 × 8 lb', '20 × 10 lb']);
    expect(within(view.getByTestId('exercise-history-row-1')).getByLabelText('25 pounds by 8')).toBeTruthy();
    expect(within(view.getByTestId('exercise-history-row-2')).getByLabelText('20 pounds by 10')).toBeTruthy();
    // The tile reads the best's own unit.
    expect(within(best).getByText(bestAt === 0 ? `20 lb × 45${NBSP}sec` : '25 × 8')).toBeTruthy();
    await view.unmount();
    get.mockReset();
  }
});

it('7 size: at 320 x 568 nothing under the history clamps or shrinks text, and each timed value is one Text joined by a no-break space', async () => {
  const rows = hold('seconds');
  serve({ data: answer(rows, rows[0]) }, { data: HOLD });
  const view = await screen({ width: 320, height: 568 });
  await view.findByTestId('exercise-history-best');
  const history = view.getByTestId('exercise-history');
  expect(textProblems(history)).toEqual([]);
  expect(oneText(view.getByTestId('exercise-history-best'), `30 lb × 40${NBSP}sec`)).toHaveLength(1);
  HOLD_ROWS.forEach((t, i) => expect(oneText(view.getByTestId(`exercise-history-value-${i}`), t)).toHaveLength(1));
  // "sec" never starts a line of its own: no plain space before it anywhere.
  expect(words(history).join('\n')).not.toMatch(/ sec/);
});

it('8 the request is main\'s: one read of /workouts/exercise-history by the page\'s name, nothing else', async () => {
  const rows = hold('seconds');
  serve({ data: answer(rows, rows[0]) }, { data: HOLD });
  const view = await screen();
  await view.findByTestId('exercise-history-best');
  await flush();
  expect(historyCalls()).toEqual([`${HISTORY}?name=Suitcase%20hold`]);
  expect(get.mock.calls.map((c) => String(c[0])).filter((u) => !u.startsWith('/exercise-catalog/') && !u.startsWith(HISTORY)))
    .toEqual([]);
});
