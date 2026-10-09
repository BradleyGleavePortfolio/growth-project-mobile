/**
 * ProgressScreen — the weight trend redrawn to progress-details/luxury.jpg
 * (REDO-PROGRESS-133 PR A): an overline section instead of a cream box, text
 * tabs with an underline, a static line with dashed guides, and one sentence
 * underneath that reads only the selected period. "All" asks for every
 * weigh-in, not the last 365 days.
 */
import React from 'react';
import { Dimensions } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const DAY = 86400000;
function day(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00.000Z`;
}
let mockAll: Array<{ id: string; date: string; weight_lbs: number }> = [];
const mockGetHistory = jest.fn(async (days: number) => ({
  data: { logs: mockAll.filter((l) => Date.now() - new Date(l.date).getTime() <= days * DAY), height_cm: null },
}));
jest.mock('../../../services/api', () => ({
  weightApi: { getHistory: (days: number) => mockGetHistory(days), log: jest.fn(async () => ({})) },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user-1' }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: { romanFirstPaymentBodyweightPolish: false },
}));

import ProgressScreen from '../ProgressScreen';
import { formatWeight, periodSummary } from '../../../components/progress/progressFormat';

beforeEach(() => {
  mockGetHistory.mockClear();
  mockAll = [
    { id: 'a', date: day(200), weight_lbs: 196 },
    { id: 'b', date: day(20), weight_lbs: 185 },
    { id: 'c', date: day(1), weight_lbs: 183 },
  ];
});

describe('Weight trend (progress-details reference)', () => {
  it('opens with a sentence-case overline, not a Title Case card title', async () => {
    const { findByText, queryByText } = await render(<ProgressScreen />);
    expect(await findByText('Weight trend')).toBeTruthy();
    expect(queryByText('Weight Trend')).toBeNull();
  });

  it('reads the period in one sentence under the line', async () => {
    const { findByText, getByText } = await render(<ProgressScreen />);
    expect(await findByText('Down 2 lb')).toBeTruthy();
    expect(getByText('over the last 30 days')).toBeTruthy();
  });

  it('marks the active tab and asks for every weigh-in on All', async () => {
    const { findByLabelText, getByLabelText, findByText } = await render(<ProgressScreen />);
    expect((await findByLabelText('Show 30D period')).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await fireEvent.press(getByLabelText('Show All period'));
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith(3650));
    expect(mockGetHistory).not.toHaveBeenCalledWith(365);
    expect(await findByText('Down 13 lb')).toBeTruthy();
    expect(getByLabelText('Show All period').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('says plainly when the period has too few weigh-ins', async () => {
    mockAll = [{ id: 'c', date: day(1), weight_lbs: 183 }];
    const one = await render(<ProgressScreen />);
    expect(await one.findByText('One weigh-in in this period. The line appears after the second.')).toBeTruthy();
  });

  it('says plainly when the period has none', async () => {
    mockAll = [{ id: 'a', date: day(200), weight_lbs: 196 }];
    const { findByText, queryByText } = await render(<ProgressScreen />);
    expect(await findByText('No weigh-ins in this period.')).toBeTruthy();
    expect(queryByText('Log your weight to see your chart')).toBeNull();
  });

  it.each([[360, 800], [390, 844]])('draws inside the 24 pt gutters at %ix%i', async (width, height) => {
    const spy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale: 1 });
    const { findByTestId } = await render(<ProgressScreen />);
    const chart = await findByTestId('progress-weight-chart-legacy');
    expect(chart.props.width).toBe(width - 48 - 36);
    expect(chart.props.accessibilityLabel).toBe('Weight trend line chart, 185 to 183 pounds');
    spy.mockRestore();
  });
});

describe('progressFormat', () => {
  it('formats weights and the period sentence', () => {
    expect(formatWeight(183)).toBe('183');
    expect(formatWeight(182.44)).toBe('182.4');
    expect(periodSummary(185, 183, '7D', null)).toEqual({ headline: 'Down 2 lb', detail: 'over the last 7 days' });
    expect(periodSummary(183, 184.5, '90D', null)).toEqual({ headline: 'Up 1.5 lb', detail: 'over the last 90 days' });
    expect(periodSummary(183, 183, 'All', 'Since 12 February')).toEqual({ headline: 'Steady', detail: 'since 12 February' });
    expect(periodSummary(190, 183, 'All', null).detail).toBe('since the first weigh-in');
  });
});
