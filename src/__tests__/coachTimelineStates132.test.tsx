import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { coachApi } from '../services/api';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { TimelineTab } from '../screens/coach/client-detail/TimelineTab';
import { WeeklySummaryTab } from '../screens/coach/client-detail/WeeklySummaryTab';
import type { TimelineEvent, WeekSummary } from '../screens/coach/client-detail/types';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('../services/api', () => ({ coachApi: { getClientTimeline: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

const read = coachApi.getClientTimeline as jest.Mock;
const emptyData = { meals: [], workouts: [], weights: [], checkIns: [] };
const event: TimelineEvent = {
  id: 'checkin-test', type: 'checkin', title: 'Check-in', subtitle: 'Mood: 3/5',
  date: '2026-10-08T09:00:00', icon: 'chatbubble-ellipses', iconColor: testColors.primary,
  checkIn: { id: 'checkin-test', coachId: 'coach-test', reviewed: false },
};
const week: WeekSummary = {
  weekStart: '2026-10-05', weekEnd: '2026-10-11', weekLabel: 'Oct 5 – Oct 11',
  totalCalories: 300, totalProtein: 30, totalWeightMoved: 3375, workoutCount: 1, latestWeight: 180,
};

beforeEach(() => {
  jest.clearAllMocks();
  read.mockReset().mockResolvedValue({ data: emptyData });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(['timeline', 'weekly'] as const)('%s separates a failed read from verified empty data and recovers on retry', async (tab) => {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  const load = () => tab === 'timeline'
    ? result.current.loadTimeline(30) : result.current.loadWeeklySummaries(30);
  read.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  await act(async () => { await load(); });
  const state = () => tab === 'timeline'
    ? { loading: result.current.timelineLoading, error: result.current.timelineError }
    : { loading: result.current.weeklyLoading, error: result.current.weeklyError };
  expect(state()).toEqual({
    loading: false,
    error: `${tab === 'timeline' ? 'Timeline' : 'Weekly summary'} could not load. Check your connection, then try again.`,
  });
  await act(async () => { await load(); });
  expect(state()).toEqual({ loading: false, error: null });
  expect(read).toHaveBeenLastCalledWith('client-test', 30);
  expect(result.current.timeline).toEqual([]);
  expect(result.current.weekSummaries).toEqual([]);
});

it.each(['timeline', 'weekly'] as const)('%s stays loading during a read and also handles an API error payload', async (tab) => {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  let resolve!: (value: { data: { error: string } }) => void;
  read.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  let pending!: Promise<void>;
  await act(async () => {
    pending = tab === 'timeline' ? result.current.loadTimeline(7) : result.current.loadWeeklySummaries(7);
  });
  expect(tab === 'timeline' ? result.current.timelineLoading : result.current.weeklyLoading).toBe(true);
  await act(async () => { resolve({ data: { error: 'Synthetic API error' } }); await pending; });
  expect(tab === 'timeline' ? result.current.timelineError : result.current.weeklyError)
    .toBe(`${tab === 'timeline' ? 'Timeline' : 'Weekly summary'} could not load. Try again in a moment.`);
  expect(tab === 'timeline' ? result.current.timelineLoading : result.current.weeklyLoading).toBe(false);
});

it('Timeline renders loading, failed, verified empty and populated states without losing review or retry', async () => {
  const reload = jest.fn();
  const review = jest.fn(async () => undefined);
  const props = { events: [], days: 7, onLoad: reload, viewerId: 'coach-test', onMarkReviewed: review };
  const view = await render(<TimelineTab {...props} loading />);
  expect(view.getByLabelText('Loading timeline')).toBeTruthy();
  expect(view.queryByText(/No activity/)).toBeNull();
  await view.rerender(<TimelineTab {...props} error="Timeline could not load. Try again in a moment." />);
  expect(view.getByText('Timeline could not load. Try again in a moment.')).toBeTruthy();
  expect(view.queryByText(/No activity/)).toBeNull();
  const before = reload.mock.calls.length;
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(reload).toHaveBeenCalledTimes(before + 1);
  await view.rerender(<TimelineTab {...props} />);
  expect(view.getByText('No activity in the last 7 days')).toBeTruthy();
  await view.rerender(<TimelineTab {...props} events={[event]} />);
  await fireEvent.press(view.getByLabelText('Mark check-in reviewed'));
  expect(review).toHaveBeenCalledWith('checkin-test');
});

it('Weekly renders loading, failed, verified empty and populated states without losing disclosure or retry', async () => {
  const retry = jest.fn();
  const toggle = jest.fn();
  const props = { summaries: [], days: 90, expandedWeeks: new Set<string>(), onToggleWeek: toggle, onRetry: retry };
  const view = await render(<WeeklySummaryTab {...props} loading />);
  expect(view.getByLabelText('Loading weekly summary')).toBeTruthy();
  expect(view.queryByText(/No data/)).toBeNull();
  await view.rerender(<WeeklySummaryTab {...props} error="Weekly summary could not load. Try again in a moment." />);
  expect(view.getByText('Weekly summary could not load. Try again in a moment.')).toBeTruthy();
  expect(view.queryByText(/No data/)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(<WeeklySummaryTab {...props} />);
  expect(view.getByText('No data in the last 90 days')).toBeTruthy();
  await view.rerender(<WeeklySummaryTab {...props} summaries={[week]} />);
  expect(view.getByText('3,375')).toBeTruthy();
  await fireEvent.press(view.getByText(week.weekLabel));
  expect(toggle).toHaveBeenCalledWith(week.weekStart);
  await view.rerender(<WeeklySummaryTab {...props} summaries={[week]} expandedWeeks={new Set([week.weekStart])} />);
  expect(view.getByText('3,375 lb')).toBeTruthy();
});
