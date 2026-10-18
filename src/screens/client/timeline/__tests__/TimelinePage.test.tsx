/**
 * TIMELINE T1: the Style C Timeline page. One card a day, newest first; weigh-ins and wins only (no coach
 * row, #TIMELINE-COACH op 1); a plain grey "No check-in" (#TIMELINE-MISSED op 1); loading, empty,
 * offline and error states (boards 14-15).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TimelineEvent, TimelineResponse } from '../../../../services/timelineApi';
import { lightTokens } from '../../../../theme/tokens';

const mockFetch = jest.fn<Promise<TimelineResponse>, [Record<string, unknown>]>();
jest.mock('../../../../services/timelineApi', () => ({ fetchTimeline: (q: Record<string, unknown>) => mockFetch(q) }));
let mockOnline = true;
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockOnline, isInternetReachable: null }),
  isEffectivelyOnline: (s: { isOnline: boolean }) => s.isOnline,
}));
const mockNav = { navigate: jest.fn(), setOptions: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));

import TimelinePage, { TIMELINE_COPY, dayHeading, groupByDay } from '../TimelinePage';

const pad = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const ev = (id: string, over: Partial<TimelineEvent>): TimelineEvent =>
  ({ id, lane: 'win', eventType: 'checkin_streak_milestone', at: today.toISOString(), title: id, metadata: {}, ...over }) as TimelineEvent;
const WEIGH = ev('w1', {
  lane: 'body', eventType: 'weight_logged', at: `${todayKey}T00:00:00.000Z`,
  title: 'Weighed in at 82.4 kg', body: 'Trend 82.9 kg', metadata: { weightLbs: 181.7, trendLbs: 182.8 },
});
const STREAK = ev('s1', { title: '7 days of check-ins in a row' });
const MISSED = ev('m1', {
  lane: 'friction', eventType: 'missed_checkin', at: new Date(today.getTime() - 3 * 86400000).toISOString(), title: 'No check-in',
});
const page = (events: TimelineEvent[], nextCursor: string | null = null): TimelineResponse => ({ events, nextCursor, total: events.length });
const noAnswer = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const refused = Object.assign(new Error('Request failed'), { response: { status: 500 } });

beforeEach(() => {
  mockFetch.mockReset();
  mockNav.navigate.mockClear();
  mockNav.setOptions.mockClear();
  mockOnline = true;
});

describe('day helpers', () => {
  it('heads days in en-US: Today with its date, the year only when it is not this year', () => {
    const now = new Date(2026, 9, 17, 9);
    expect(dayHeading('2026-10-17', now)).toEqual({ title: 'Today', date: 'Saturday, October 17' });
    expect(dayHeading('2026-10-16', now)).toEqual({ title: 'Friday, October 16' });
    expect(dayHeading('2025-12-31', now)).toEqual({ title: 'Wednesday, December 31, 2025' });
  });

  it('a weigh-in keeps its calendar day; days run newest first', () => {
    const days = groupByDay([
      ev('a', { eventType: 'weight_logged', lane: 'body', at: '2026-10-16T00:00:00.000Z' }),
      ev('b', { at: new Date(2026, 9, 17, 8).toISOString() }),
      ev('c', { at: new Date(2026, 9, 16, 23, 30).toISOString() }),
    ]);
    expect(days.map((d) => [d.day, d.rows.map((r) => r.id)])).toEqual([['2026-10-17', ['b']], ['2026-10-16', ['a', 'c']]]);
  });
});

describe('TimelinePage', () => {
  it('loading: the forest masthead and a named skeleton', async () => {
    mockFetch.mockReturnValue(new Promise<TimelineResponse>(() => undefined));
    await render(<TimelinePage />);
    expect(screen.getByLabelText(TIMELINE_COPY.loading)).toBeTruthy();
    expect(screen.getByText(TIMELINE_COPY.title).props.accessibilityRole).toBe('header');
    expect(screen.getByText(TIMELINE_COPY.subline)).toBeTruthy();
    expect(mockNav.setOptions).toHaveBeenCalledWith({
      headerStyle: { backgroundColor: lightTokens.surface.masthead }, headerTintColor: lightTokens.textOnAccent,
    });
  });

  it('one card a day: weigh-ins and wins in the server words, a grey No check-in, no coach row', async () => {
    mockFetch.mockResolvedValue(page([STREAK, WEIGH, MISSED]));
    await render(<TimelinePage />);
    await waitFor(() => expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy());
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Trend 82.9 kg')).toBeTruthy();
    expect(screen.getByLabelText('Weighed in at 82.4 kg. Trend 82.9 kg')).toBeTruthy();
    expect(screen.getByText('7 days of check-ins in a row')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('No check-in').props.style).color).toBe(lightTokens.data.missed);
    expect(screen.queryByText(/Sam|coach|wrote to you/i)).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith({ sinceDays: 365, limit: 20, lanes: ['body', 'win', 'friction'] });
  });

  it('empty: one sentence, and Log weight opens the weigh-in sheet on Progress', async () => {
    mockFetch.mockResolvedValue(page([]));
    await render(<TimelinePage />);
    await waitFor(() => expect(screen.getByText(TIMELINE_COPY.empty)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('timeline-log-weight'));
    expect(mockNav.navigate).toHaveBeenCalledWith('Progress', { logWeightAt: expect.any(Number) });
  });

  it('error: what failed and Try again; no answer adds what to do', async () => {
    mockFetch.mockRejectedValueOnce(refused).mockRejectedValueOnce(noAnswer).mockResolvedValue(page([WEIGH]));
    await render(<TimelinePage />);
    await waitFor(() => expect(screen.getByText(TIMELINE_COPY.failed)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('timeline-error-retry'));
    await waitFor(() => expect(screen.getByText(`${TIMELINE_COPY.failed} ${TIMELINE_COPY.noAnswer}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('timeline-error-retry'));
    await waitFor(() => expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy());
  });

  it('offline: loaded days stay with one line, and the newer days load back online', async () => {
    mockFetch.mockResolvedValueOnce(page([WEIGH])).mockRejectedValueOnce(noAnswer).mockResolvedValue(page([STREAK, WEIGH]));
    await render(<TimelinePage />);
    await waitFor(() => expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy());
    expect(screen.queryByTestId('timeline-offline')).toBeNull();
    await act(async () => {
      await fireEvent(screen.getByTestId('timeline-page'), 'refresh');
    });
    await waitFor(() => expect(screen.getByText(TIMELINE_COPY.offline)).toBeTruthy());
    expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy();
    mockOnline = false;
    await screen.rerender(<TimelinePage />);
    mockOnline = true;
    await screen.rerender(<TimelinePage />);
    await waitFor(() => expect(screen.getByText('7 days of check-ins in a row')).toBeTruthy());
    expect(screen.queryByTestId('timeline-offline')).toBeNull();
  });

  it('older days page in once, and a failed page retries in place', async () => {
    mockFetch
      .mockResolvedValueOnce(page([WEIGH], 'c1'))
      .mockRejectedValueOnce(noAnswer)
      .mockResolvedValue(page([WEIGH, MISSED]));
    await render(<TimelinePage />);
    await waitFor(() => expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy());
    await fireEvent(screen.getByTestId('timeline-page'), 'endReached');
    await waitFor(() => expect(screen.getByTestId('timeline-more-error')).toBeTruthy());
    expect(screen.getByText(`${TIMELINE_COPY.failed} ${TIMELINE_COPY.noAnswer}`)).toBeTruthy();
    // Older days failed, not newer ones: no offline line, and the loaded days stay.
    expect(screen.queryByTestId('timeline-offline')).toBeNull();
    expect(screen.getByText('Weighed in at 82.4 kg')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('timeline-more-error-retry'));
    await waitFor(() => expect(screen.getByText('No check-in')).toBeTruthy());
    expect(mockFetch).toHaveBeenLastCalledWith({ sinceDays: 365, limit: 20, lanes: ['body', 'win', 'friction'], cursor: 'c1' });
    expect(screen.getAllByText('Weighed in at 82.4 kg')).toHaveLength(1);
  });
});
