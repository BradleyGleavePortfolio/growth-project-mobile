/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * COACH-DAY-ORDER-M: the coach's phone shows a workout on the day it was done.
 * Timeline and weekly summary pick the day from the workout's own `date`, never
 * the moment the phone saved it; every list of a client's workouts reads newest
 * first in one order (day, then save time, then id), the order the server gives
 * its timeline slices (backend coach.service.ts at d0982a09, b#1213). Inside one
 * day the timeline keeps the server's order: meals, workouts, weights, check-ins.
 * The device is in Pacific time; it is Tuesday Nov 3 2026, 10:00 (PST).
 */
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import api from '../services/api';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { TimelineTab } from '../screens/coach/client-detail/TimelineTab';
import { mapCoachWorkoutSessions } from '../utils/workout/workoutLogging';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: () => instance } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));
jest.mock('../components/coach/ai-entry/AdjustForClient', () => ({ AdjustForClientEntry: () => null }));
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => ({ data: null, isLoading: false, isError: false, refetch: jest.fn() }),
}));

type Row = Record<string, unknown>;
const workout = (id: string, date: string | undefined, created_at: string): Row => ({
  id, workout_name: `Workout ${id}`, ...(date ? { date } : {}), created_at, duration_minutes: 30, exercises: [],
});
let timeline: Row = {};
let summary: Row = {};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-03T18:00:00.000Z')); // Tuesday 10:00 PST
  timeline = { meals: [], workouts: [], weights: [], checkIns: [] };
  summary = { profile: null, client_name: 'Test client', today: { entries: [] }, recent_workouts: [], weight_logs: [] };
  (api.get as jest.Mock).mockReset().mockImplementation(async (url: string) => ({
    data: url.includes('/timeline') ? timeline : summary,
  }));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function loadTimeline() {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadTimeline(7); });
  return result.current.timeline;
}

async function weeks() {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadWeeklySummaries(30); });
  return result.current.weekSummaries.map((w) => [w.weekStart, w.workoutCount]);
}

describe('a workout done yesterday and saved today', () => {
  // Done Monday Nov 2, the phone saved it Tuesday 09:00 PST.
  const late = workout('late', '2026-11-02T00:00:00.000Z', '2026-11-03T17:00:00.000Z');

  it('shows under yesterday on the Timeline', async () => {
    timeline = { ...timeline, workouts: [late] };
    const events = await loadTimeline();
    const view = await render(<TimelineTab events={events} onLoad={() => undefined} days={7} />);
    expect(view.getByText('Yesterday')).toBeTruthy();
    expect(view.queryByText('Today')).toBeNull();
  });

  it("counts in yesterday's week on the weekly summary", async () => {
    // Saved Monday 08:00 for a workout done Sunday Nov 1: Sunday's week, not Monday's.
    timeline = { ...timeline, workouts: [workout('sun', '2026-11-01T00:00:00.000Z', '2026-11-02T16:00:00.000Z')] };
    expect(await weeks()).toEqual([['2026-10-26', 1]]);
  });
});

it('a workout saved at 23:59 on Sunday stays in that week, with or without its own date', async () => {
  // 23:59 PST Sunday Nov 1 is 07:59 UTC Monday.
  timeline = { ...timeline, workouts: [
    workout('dated', '2026-11-01T00:00:00.000Z', '2026-11-02T07:59:00.000Z'),
    workout('undated', undefined, '2026-11-02T07:59:00.000Z'),
  ] };
  expect(await weeks()).toEqual([['2026-10-26', 2]]);
});

it("an evening workout reads by calendar day: last night's 22:00 workout is Yesterday at 10:00", async () => {
  timeline = { ...timeline, workouts: [workout('eve', '2026-11-02T00:00:00.000Z', '2026-11-03T06:00:00.000Z')] };
  const events = await loadTimeline();
  const view = await render(<TimelineTab events={events} onLoad={() => undefined} days={7} />);
  expect(view.getByText('Yesterday')).toBeTruthy();
  expect(view.queryByText('Today')).toBeNull();
});

it("inside one day the Timeline keeps the server's order: meals, workouts (newest save, then id), weights, check-ins", async () => {
  timeline = {
    meals: [
      { id: 'm-tue', date: '2026-11-03T00:00:00.000Z', quantity_multiplier: 1, food_item: { calories: 100 } },
      { id: 'm-mon', date: '2026-11-02T00:00:00.000Z', quantity_multiplier: 1, food_item: { calories: 200 } },
    ],
    // The server's own order (date, created_at, id, newest first) shuffled: the phone sorts.
    workouts: [
      workout('eve', '2026-11-02T00:00:00.000Z', '2026-11-03T06:00:00.000Z'), // Monday 22:00, saved the same day
      workout('tie-a', '2026-11-02T00:00:00.000Z', '2026-11-02T15:00:00.000Z'), // Monday 07:00
      workout('late', '2026-11-02T00:00:00.000Z', '2026-11-03T17:00:00.000Z'), // done Monday, saved Tuesday
      workout('tie-b', '2026-11-02T00:00:00.000Z', '2026-11-02T15:00:00.000Z'), // same save moment as tie-a
    ],
    weights: [{ id: 'w1', date: '2026-11-02T00:00:00.000Z', weight_lbs: 180 }],
    checkIns: [{ id: 'c1', date: '2026-11-02T00:00:00.000Z', mood: 3 }],
  };
  expect((await loadTimeline()).map((e) => e.id)).toEqual([
    'food_2026-11-03',
    'food_2026-11-02', 'workout_late', 'workout_eve', 'workout_tie-b', 'workout_tie-a', 'weight_w1', 'checkin_c1',
  ]);
});

describe('recent_workouts read in one stable order: day, then save time, then id', () => {
  // The summary sends its newest saves first (orderBy created_at desc).
  const recent = [
    workout('late', '2026-11-01T00:00:00.000Z', '2026-11-03T17:00:00.000Z'), // Sunday, saved Tuesday
    workout('undated', undefined, '2026-11-03T07:30:00.000Z'), // no date: the day it was saved, Monday 23:30 PST
    workout('b', '2026-11-02T00:00:00.000Z', '2026-11-02T20:00:00.000Z'),
    workout('a', '2026-11-02T00:00:00.000Z', '2026-11-02T20:00:00.000Z'), // ties with b on day and save time
    workout('old', '2026-10-30T00:00:00.000Z', '2026-10-30T20:00:00.000Z'),
  ];
  const ORDER = ['undated', 'b', 'a', 'late', 'old'];

  it('the Workouts tab lists them newest day first', async () => {
    expect(mapCoachWorkoutSessions(recent).map((s) => s.id)).toEqual(ORDER);
    expect(mapCoachWorkoutSessions([...recent].reverse()).map((s) => s.id)).toEqual(ORDER);
    summary = { ...summary, recent_workouts: recent };
    const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
    await act(async () => { await result.current.loadData(); });
    expect(result.current.workoutSessions.map((s) => s.id)).toEqual(ORDER);
    expect(mapCoachWorkoutSessions(recent).find((s) => s.id === 'undated')?.day).toBe('2026-11-02');
  });

  // CLIENT-FILE-DAYS-M: the peek no longer names the last workout; its Workouts row is the client file's week
  // (screens/coach/__tests__/ClientPeekWeek196.test.tsx).
});
