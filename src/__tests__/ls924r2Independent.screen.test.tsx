/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * Independent LS-924R2 review probes. Test-only; never merge this branch.
 */
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { coachApi } from '../services/api';
import { TimelineTab } from '../screens/coach/client-detail/TimelineTab';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { newestWorkoutsFirst, mapCoachWorkoutSessions } from '../utils/workout/workoutLogging';
import { testColors } from '../screens/client/wearables/recoveryTestColors';
import type { TimelineEvent } from '../screens/coach/client-detail/types';

jest.mock('../services/api', () => ({
  coachApi: { getClientTimeline: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn(),
}));

const read = coachApi.getClientTimeline as jest.Mock;
const event = (date: string): TimelineEvent => ({
  id: 'probe', type: 'workout', title: 'Probe workout', subtitle: '30 min',
  date, icon: 'barbell', iconColor: testColors.primary,
});

beforeEach(() => {
  jest.useFakeTimers();
  read.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each([
  ['spring-forward yesterday', '2026-03-09T00:01:00-07:00', '2026-03-08T23:59:00-07:00', 'Yesterday'],
  ['fall-back yesterday', '2026-11-02T00:01:00-08:00', '2026-11-01T23:59:00-08:00', 'Yesterday'],
  ['spring-forward six days', '2026-03-10T00:01:00-07:00', '2026-03-04T23:59:00-08:00', '6 days ago'],
  ['fall-back six days', '2026-11-03T00:01:00-08:00', '2026-10-28T23:59:00-07:00', '6 days ago'],
  ['same local day', '2026-11-03T23:59:00-08:00', '2026-11-03T00:01:00-08:00', 'Today'],
  ['future local day', '2026-11-03T23:59:00-08:00', '2026-11-04T00:01:00-08:00', 'Nov 4'],
  ['year boundary', '2027-01-01T00:01:00-08:00', '2026-12-31T23:59:00-08:00', 'Yesterday'],
])('calendar labels: %s', async (_name, now, at, label) => {
  jest.setSystemTime(new Date(now));
  const view = await render(<TimelineTab events={[event(at)]} days={7} onLoad={() => undefined} />);
  expect(view.getByText(label)).toBeTruthy();
  expect(view.queryByText(/^-?\d+ days ago$/)?.props.children ?? label).not.toBe('-1 days ago');
});

it('the helper keeps all 128 rows, stable identities and frozen input across rotations', () => {
  const rows = Array.from({ length: 128 }, (_, i) => Object.freeze({
    id: String(i).padStart(3, '0'),
    date: `2026-11-${String(1 + Math.floor(i / 8)).padStart(2, '0')}T00:00:00.000Z`,
    // Two rows at each save instant exercise the id tie-break.
    created_at: new Date(Date.UTC(2026, 11, 1, 0, Math.floor(i / 2))).toISOString(),
    exercises: [],
  }));
  const expected = [...rows].reverse();
  for (let n = 0; n < 32; n += 1) {
    const rotated = Object.freeze([...rows.slice(n), ...rows.slice(0, n)]);
    const result = newestWorkoutsFirst(rotated);
    expect(result).toEqual(expected);
    expect(result).not.toBe(rotated);
    expect(result.every((row, i) => row === expected[i])).toBe(true);
    expect(rotated).toEqual([...rows.slice(n), ...rows.slice(0, n)]);
    expect(mapCoachWorkoutSessions([...rotated]).map((s) => s.id)).toEqual(expected.map((s) => s.id));
  }
});

it('the helper places undated local-day rows and unreadable times without dropping data', () => {
  const rows = [
    { id: 'unknown', created_at: 'not-a-time' },
    { id: 'mon-b', date: '2026-11-02', created_at: 'not-a-time' },
    { id: 'sun', created_at: '2026-11-02T07:59:00.000Z' },
    { id: 'mon-a', date: '2026-11-02', created_at: 'not-a-time' },
    { id: 'mon-new', created_at: '2026-11-03T07:59:00.000Z' },
  ];
  expect(newestWorkoutsFirst(rows).map((r) => r.id)).toEqual([
    'mon-new', 'mon-b', 'mon-a', 'sun', 'unknown',
  ]);
});

it('the Timeline preserves each non-workout slice order inside its calendar-day class', async () => {
  read.mockResolvedValue({ data: {
    meals: [{ id: 'meal', date: '2026-11-02', food_item: { calories: 100 } }],
    workouts: [
      { id: 'old', date: '2026-11-01', created_at: '2026-11-03T17:00:00Z' },
      { id: 'new', date: '2026-11-02', created_at: '2026-11-02T19:00:00Z' },
    ],
    weights: [
      { id: 'w-b', date: '2026-11-02', weight_lbs: 180 },
      { id: 'w-a', date: '2026-11-02', weight_lbs: 181 },
    ],
    checkIns: [
      { id: 'c-b', date: '2026-11-02' },
      { id: 'c-a', date: '2026-11-02' },
    ],
  } });
  const { result } = await renderHook(() => useClientDetailData('probe-client', testColors));
  await act(async () => { await result.current.loadTimeline(30); });
  expect(result.current.timeline.map((e) => e.id)).toEqual([
    'food_2026-11-02', 'workout_new', 'weight_w-b', 'weight_w-a',
    'checkin_c-b', 'checkin_c-a', 'workout_old',
  ]);
  expect(read).toHaveBeenCalledWith('probe-client', 30);
});
