/**
 * TimelineScreen.test.tsx — Phase 7B
 *
 * Tests the TimelineScreen component in isolation using mocked
 * timelineApi and react-native testing utilities.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import TimelineScreen from '../screens/client/TimelineScreen';
import * as timelineApiModule from '../services/timelineApi';
import type { TimelineEvent, TimelineResponse } from '../services/timelineApi';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../services/timelineApi', () => ({
  fetchTimeline: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockFetch = timelineApiModule.fetchTimeline as jest.MockedFunction<
  typeof timelineApiModule.fetchTimeline
>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEIGHT_EVENT: TimelineEvent = {
  id: 'ev_weight_1',
  lane: 'body',
  eventType: 'weight_logged',
  at: '2025-10-01T08:00:00.000Z',
  title: 'Weighed in at 185.0 lb',
  body: 'Trend 185.4 lb',
  metadata: { weightLbs: 185.0, trendLbs: 185.4 },
};

const STREAK_EVENT: TimelineEvent = {
  id: 'ev_win_1',
  lane: 'win',
  eventType: 'checkin_streak_milestone',
  at: '2025-10-08T09:00:00.000Z',
  title: '7-day check-in streak reached',
  body: '7 consecutive days of check-ins completed.',
  metadata: { streakDays: 7, threshold: 7 },
};

const MISS_EVENT: TimelineEvent = {
  id: 'ev_friction_1',
  lane: 'friction',
  eventType: 'missed_checkin',
  at: '2025-10-25T09:00:00.000Z',
  title: '3 missed check-ins',
  body: 'Check-in not submitted. Logged for honest record.',
  metadata: { consecutiveMisses: 3 },
};

const FULL_RESPONSE: TimelineResponse = {
  events: [STREAK_EVENT, WEIGHT_EVENT, MISS_EVENT],
  nextCursor: null,
  total: 3,
};

const EMPTY_RESPONSE: TimelineResponse = {
  events: [],
  nextCursor: null,
  total: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function renderScreen() {
  return await render(<TimelineScreen />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TimelineScreen', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  // ── Loading and rendering ──────────────────────────────────────────────────

  it('renders lane filter chips: All, Body, Wins, Friction; no Coach chip (#TIMELINE-COACH op 1)', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { getByText, queryByText } = await renderScreen();

    await waitFor(() => {
      expect(getByText('All')).toBeTruthy();
      expect(getByText('Body')).toBeTruthy();
      expect(getByText('Wins')).toBeTruthy();
      expect(getByText('Friction')).toBeTruthy();
    });
    expect(queryByText('Coach')).toBeNull();
  });

  it('renders event titles from API response', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { getByText } = await renderScreen();

    await waitFor(() => {
      expect(getByText('7-day check-in streak reached')).toBeTruthy();
      expect(getByText('Weighed in at 185.0 lb')).toBeTruthy();
      expect(getByText('3 missed check-ins')).toBeTruthy();
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it('shows empty state copy when API returns 0 events', async () => {
    mockFetch.mockResolvedValue(EMPTY_RESPONSE);
    const { getByText } = await renderScreen();

    await waitFor(() => {
      expect(
        getByText(
          'No entries match these filters.',
        ),
      ).toBeTruthy();
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────

  it('shows error state and retry button on API failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network request failed'));
    const { getByText } = await renderScreen();

    await waitFor(() => {
      expect(getByText('Could not load timeline')).toBeTruthy();
      expect(getByText('Retry')).toBeTruthy();
    });
  });

  it('retries API call when Retry is pressed', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(EMPTY_RESPONSE);

    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('Retry')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByText('Retry'));
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  // ── Lane filter chips ─────────────────────────────────────────────────────

  it('calls API with the correct lane when a single chip is pressed', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('Body')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByText('Body'));
    });

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(lastCall?.lanes).toEqual(['body']);
    });
  });

  it('names the three lanes when All is selected, so no server sends coach notes', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('All')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByText('All'));
    });

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(lastCall?.lanes).toEqual(['body', 'win', 'friction']);
    });
  });

  it('preserves every lane filter, real event dates and cursor paging', async () => {
    mockFetch.mockResolvedValue({ ...FULL_RESPONSE, nextCursor: 'next-page' });
    const screen = await renderScreen();
    expect(await screen.findByLabelText('Wins lane: 7-day check-in streak reached. 8 Oct 2025')).toBeTruthy();
    for (const [label, lane] of [['Wins', 'win'], ['Friction', 'friction']]) {
      await fireEvent.press(screen.getByText('All'));
      await fireEvent.press(screen.getByText(label));
      expect(mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[0]?.lanes).toEqual([lane]);
    }
    mockFetch.mockResolvedValue(EMPTY_RESPONSE);
    await fireEvent(screen.getByLabelText('Transformation timeline'), 'endReached');
    expect(mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[0]?.cursor).toBe('next-page');
  });

  // ── Pull to refresh ────────────────────────────────────────────────────────

  it('triggers a fresh API call on pull-to-refresh', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { getByLabelText } = await renderScreen();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const list = getByLabelText('Transformation timeline');
    await act(async () => {
      await fireEvent(list, 'refresh');
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  // ── No PTM risk_score ──────────────────────────────────────────────────────

  it('renders event cards without exposing any risk_score values', async () => {
    mockFetch.mockResolvedValue(FULL_RESPONSE);
    const { toJSON } = await renderScreen();

    // v14: the rendered tree returned by `toJSON()` now carries circular
    // internal references (e.g. fiber `_owner`), so a plain `JSON.stringify`
    // throws "Converting circular structure to JSON". Use a circular-safe
    // replacer that drops only the back-references while preserving every
    // serializable prop/child string — the contract (no risk_score text leaks
    // into the tree) is unchanged.
    const safeStringify = (value: unknown): string => {
      const seen = new WeakSet<object>();
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return undefined;
          seen.add(val);
        }
        return val;
      });
    };

    await waitFor(() => {
      const tree = safeStringify(toJSON());
      expect(tree).not.toMatch(/risk_score/i);
      expect(tree).not.toMatch(/riskScore/i);
    });
  });

  // ── Screen title header ────────────────────────────────────────────────────

  it('renders the screen title "Timeline"', async () => {
    mockFetch.mockResolvedValue(EMPTY_RESPONSE);
    const { getAllByText } = await renderScreen();

    await waitFor(() => {
      const titles = getAllByText('Timeline');
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });
  });
});
