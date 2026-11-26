/**
 * REFINE-986R2 (fix round 2 on m#986): the bar's play control is drawn only where a press does something a client
 * can see or hear (LS-986R2 B1 = LO-986R2 C4). An animation counts as something to go to only while the client's
 * history is drawn above it (PLAY-1); a video always counts. The control's spoken name says what the press does:
 * "Play demonstration" for a video, "Show demonstration" for an animation (PLAY-2). Also the two set rules no test
 * held (LS-986R2 N2, N4). The real ExerciseDetailScreen in a navigator; only the HTTP client (services/api) and the
 * video player are mocked at their edge, as refine986.screen.test.tsx mocks them.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
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
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const HISTORY = '/workouts/exercise-history';
const PLAY = 'Play demonstration';
const SHOW = 'Show demonstration';

function ok<T>(data: T): AxiosResponse<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as any };
}
const httpError = (status: number) => ({ response: { status } });

// Fictional rows in the shape the /exercises fallback maps (exerciseCatalog.ts fromLibrary).
const DETAIL = {
  id: 'seed:push-001', slug: 'seed:push-001', name: 'Bench press', primaryMuscle: 'pectorals', category: 'chest',
  difficulty: '', secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Lie flat on the bench.'],
  playbackUrl: null as string | null, gifUrl: null as string | null,
};
const VIDEO = { ...DETAIL, playbackUrl: 'https://stream.test.local/bench.m3u8' };
const GIF = { ...DETAIL, gifUrl: 'https://media.test.local/bench.gif' };

function session(date: string, weight: number, reps: number) {
  return {
    workout_id: `w-${date}`, date, sets: 3, reps_per_set: [reps, reps, reps], weight_per_set_lbs: [weight, weight, weight],
    rpe: null, top_set: { weight_lbs: weight, reps } as { weight_lbs: number; reps: number } | null, est_1rm_lbs: null,
    volume_lbs: weight * reps * 3, coach_comments: [],
  };
}
const oct13 = session('2026-10-13', 155, 6);
const point = (s: ReturnType<typeof session>) => ({ date: s.date, top_set: s.top_set });
// The server's answer for an exercise the client has never logged.
const NONE = { best: null, first: null, sessions: [] };
const ONE = { best: point(oct13), first: point(oct13), sessions: [oct13] };
const FOUR = {
  best: point(oct13),
  first: { date: '2026-09-22', top_set: { weight_lbs: 145, reps: 6 } },
  sessions: [oct13, session('2026-10-06', 150, 6), session('2026-09-29', 150, 5), session('2026-09-22', 145, 6)],
};
// Two answers the history draws nothing for (exerciseHistoryStyleC.tsx: best with a top set and at least one session).
const NO_TOP_SET = { best: { date: oct13.date, top_set: null }, first: null, sessions: [{ ...oct13, top_set: null }] };
const BEST_NO_SESSION = { best: point(oct13), first: point(oct13), sessions: [] };

type Reply = { data: unknown } | { fail: unknown } | 'pending' | Promise<unknown>;
function serve(catalog: Reply, history: Reply = { data: FOUR }) {
  const reply = (r: Reply) => (r === 'pending' ? new Promise(() => undefined)
    : r instanceof Promise ? r
      : 'fail' in r ? Promise.reject(r.fail) : Promise.resolve(ok(r.data)));
  get.mockImplementation((url: string) => {
    if (url.startsWith('/exercise-catalog/')) return reply(catalog);
    if (url.startsWith(HISTORY)) return reply(history);
    return Promise.reject(httpError(404));
  });
}
/** An answer the test sends when it chooses. */
function later() {
  let send: (data: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve) => { send = (data) => resolve(ok(data)); });
  return { promise, send };
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
// 'modal' is ClientNavigator.tsx's one registration (the library row and Watch in the live workout both open it).
function screen() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: 'seed:push-001' }}
          options={{ headerShown: true, title: 'Exercise', headerShadowVisible: false, presentation: 'modal', header: TestBar }}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}
type View_ = Awaited<ReturnType<typeof screen>>;
const flush = () => waitFor(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const inBar = (view: View_) => within(view.getByTestId('bar'));
/** The control, whatever it is called: null when the bar draws none. */
const control = (view: View_) => inBar(view).queryByTestId('exercise-detail-play');
/** The rule itself: on an animation page the control is in the bar exactly when the history is drawn on the page. */
function expectFollowsHistory(view: View_, drawn: boolean) {
  expect(!!view.queryByTestId('exercise-history')).toBe(drawn);
  expect(!!control(view)).toBe(drawn);
  expect(!!bar?.headerRight).toBe(drawn);
}
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;

beforeEach(() => {
  get.mockReset();
  scrollTo.mockClear();
  mockPlayer.play.mockReset();
  mockPlayer.listener = null;
  bar = null;
});

// ─── A. The control over media and history ──────────────────────────────────────────────────────────────────────

const HISTORIES: [string, Reply, boolean][] = [
  ['no session yet (the server answers with none)', { data: NONE }, false],
  ['the history read still pending', 'pending', false],
  ['the history read failed', { fail: httpError(500) }, false],
  ['a best with no top set', { data: NO_TOP_SET }, false],
  ['a best set and no session', { data: BEST_NO_SESSION }, false],
  ['one session', { data: ONE }, true],
  ['four sessions', { data: FOUR }, true],
];

it.each(HISTORIES)('an animation with %s: the control is in the bar exactly when the history is drawn above it', async (_l, history, drawn) => {
  serve({ data: GIF }, history);
  const view = await screen();
  await view.findByTestId('exercise-detail-animation');
  if (drawn) await view.findByTestId('exercise-history');
  await flush();
  expectFollowsHistory(view, drawn);
});

it.each(HISTORIES)('a video with %s: the control stays, and a press starts the video', async (_l, history) => {
  serve({ data: VIDEO }, history);
  const view = await screen();
  await view.findByTestId('exercise-detail-player');
  await flush();
  await fireEvent.press(inBar(view).getByRole('button', { name: PLAY }));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it('an animation while the history read is pending draws no control; once it answers with rows the control comes', async () => {
  const history = later();
  serve({ data: GIF }, history.promise);
  const view = await screen();
  await view.findByTestId('exercise-detail-animation');
  await flush();
  expectFollowsHistory(view, false);
  await act(async () => { history.send(FOUR); });
  await view.findByTestId('exercise-history');
  await waitFor(() => expect(control(view)).toBeTruthy());
  expectFollowsHistory(view, true);
});

it('no media: no control, with history rows above the no-demonstration line too', async () => {
  serve({ data: DETAIL }, { data: FOUR });
  const view = await screen();
  await view.findByTestId('exercise-history');
  await flush();
  expect(view.getByTestId('exercise-detail-no-video')).toBeTruthy();
  expect(control(view)).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('after the animation fails to load the control goes, with history rows on the page too', async () => {
  serve({ data: GIF }, { data: FOUR });
  const view = await screen();
  await view.findByTestId('exercise-history');
  await waitFor(() => expect(control(view)).toBeTruthy());
  await fireEvent(view.getByTestId('exercise-detail-animation'), 'error');
  await view.findByTestId('exercise-detail-no-video');
  expect(view.getByTestId('exercise-history')).toBeTruthy();
  expect(control(view)).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('after the video fails the control goes, with history rows on the page too', async () => {
  serve({ data: VIDEO }, { data: FOUR });
  const view = await screen();
  await view.findByTestId('exercise-history');
  await waitFor(() => expect(control(view)).toBeTruthy());
  await act(async () => { mockPlayer.listener?.({ status: 'error' }); });
  await view.findByTestId('exercise-detail-no-video');
  expect(control(view)).toBeNull();
  expect(bar?.headerRight).toBeUndefined();
});

it('Retry from the failed page to an animation page: no control while it loads, none until the history answers, then the control', async () => {
  get.mockRejectedValueOnce(httpError(500));
  const view = await screen();
  await view.findByTestId('exercise-detail-error');
  expect(control(view)).toBeNull();
  const catalog = later();
  const history = later();
  serve(catalog.promise, history.promise);
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  await view.findByTestId('exercise-detail-loading');
  await flush();
  expect(control(view)).toBeNull();
  await act(async () => { catalog.send(GIF); });
  await view.findByTestId('exercise-detail-animation');
  await flush();
  expectFollowsHistory(view, false);
  await act(async () => { history.send(FOUR); });
  await view.findByTestId('exercise-history');
  await waitFor(() => expect(control(view)).toBeTruthy());
  expectFollowsHistory(view, true);
});

// ─── B. The name says what the press does ───────────────────────────────────────────────────────────────────────

it('an animation\'s control is the button "Show demonstration", never "Play demonstration"; a press brings the animation into view and plays nothing', async () => {
  serve({ data: GIF }, { data: FOUR });
  const view = await screen();
  const gif = await view.findByTestId('exercise-detail-animation');
  await view.findByTestId('exercise-history');
  await fireEvent(gif, 'layout', { nativeEvent: { layout: { x: 0, y: 598, width: 342, height: 192 } } });
  const show = await inBar(view).findByRole('button', { name: SHOW });
  expect(show.props.testID).toBe('exercise-detail-play');
  expect(view.queryByRole('button', { name: PLAY })).toBeNull();
  await fireEvent.press(show);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith({ y: 598, animated: true });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('a video\'s control is the button "Play demonstration", never "Show demonstration"', async () => {
  serve({ data: VIDEO }, { data: FOUR });
  const view = await screen();
  await view.findByTestId('exercise-detail-player');
  const play = await inBar(view).findByRole('button', { name: PLAY });
  expect(play.props.testID).toBe('exercise-detail-play');
  expect(view.queryByRole('button', { name: SHOW })).toBeNull();
});

// ─── F. Two set rules no test held (LS-986R2 N2, N4) ────────────────────────────────────────────────────────────

it('LS-986R2 N2: an exercise listed with a dumbbell and body weight reads "BW × 12" at 0 lb and its number once loaded', async () => {
  const loaded = session('2026-10-13', 20, 10);
  const unloaded = session('2026-10-06', 0, 12);
  serve({ data: { ...DETAIL, name: 'Split squat', category: 'upper legs', equipment: ['dumbbell', 'body weight'] } },
    { data: { best: point(loaded), first: point(unloaded), sessions: [loaded, unloaded] } });
  const view = await screen();
  expect(within(await view.findByTestId('exercise-history-row-1')).getByText('BW × 12')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-row-1')).getByLabelText('body weight by 12')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-row-0')).getByText('20 × 10 lb')).toBeTruthy();
  expect(within(view.getByTestId('exercise-history-best')).getByText('20 × 10')).toBeTruthy();
  expect(view.queryByText(/^0 × 12/)).toBeNull();
});

it('LS-986R2 N4: a barbell exercise at 0 lb reads "0 × 10" on the tile, "0 × 10 lb" on the row, spoken "0 pounds by 10"', async () => {
  const empty = session('2026-10-13', 0, 10);
  serve({ data: DETAIL }, { data: { best: point(empty), first: point(empty), sessions: [empty] } });
  const view = await screen();
  const tile = within(await view.findByTestId('exercise-history-best')).getByText('0 × 10');
  expect(tile.props.accessibilityLabel).toBe('0 pounds by 10');
  const row = within(view.getByTestId('exercise-history-row-0')).getByText('0 × 10 lb');
  expect(row.props.accessibilityLabel).toBe('0 pounds by 10');
  expect(view.queryByText(/BW/)).toBeNull();
  expect(view.queryByLabelText(/body weight/)).toBeNull();
});
