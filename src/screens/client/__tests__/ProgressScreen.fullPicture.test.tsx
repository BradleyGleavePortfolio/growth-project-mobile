/**
 * ProgressScreen — "The full picture" frame (REDO-PROGRESS-133 PR C;
 * design-targets/mobile/progress-details/luxury.jpg): serif title, Since
 * overline, the Body numbers, the one forest action inline (no FAB), the
 * report as a quiet foot link, and WEIGH-KB-128 U12 (Start and Change from
 * the first weigh-in ever, not the period's first).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { radius } from '../../../theme/tokens';

const DAY = 86400000;
function day(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00.000Z`;
}
// Every weigh-in; the period read returns the ones inside its window.
let mockAll: Array<{ id: string; date: string; weight_lbs: number; notes?: string }> = [];
let mockHeightCm: number | null = null;
const mockGetHistory = jest.fn(async (days: number) => ({
  data: { logs: mockAll.filter((l) => Date.now() - new Date(l.date).getTime() <= days * DAY), height_cm: mockHeightCm },
}));
let mockDaily: () => Promise<{ data: Record<string, number> }> = async () => ({ data: {} });
jest.mock('../../../services/api', () => ({
  weightApi: { getHistory: (days: number) => mockGetHistory(days), log: jest.fn(async () => ({})) },
  logApi: { getDaily: () => mockDaily() },
}));
let mockTargets: Record<string, number> | null = null;
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => mockTargets }));
let mockProfile: Record<string, unknown> = {};
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user-1', profile: mockProfile }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: { romanFirstPaymentBodyweightPolish: false },
}));

import ProgressScreen from '../ProgressScreen';
import { formatChange, formatSince } from '../../../components/progress/progressFormat';

beforeEach(() => {
  mockNavigate.mockClear();
  mockGetHistory.mockClear();
  mockAll = [
    { id: 'a', date: day(80), weight_lbs: 196 },
    { id: 'b', date: day(20), weight_lbs: 185 },
    { id: 'c', date: day(1), weight_lbs: 183, notes: 'After a long run.' },
  ];
  mockHeightCm = null;
  mockTargets = null;
  mockProfile = { target_weight_lbs: 175 };
  mockDaily = async () => ({ data: { total_calories: 1240, total_protein_g: 98, total_carbs_g: 120, total_fat_g: 41 } });
});

async function screen() {
  const utils = await render(<ProgressScreen />);
  await waitFor(() => expect(utils.getByTestId('progress-body-numbers')).toBeTruthy());
  await waitFor(() => expect(utils.queryByText('Weight')).toBeTruthy());
  return utils;
}

describe('The full picture (progress-details reference)', () => {
  it('opens with the serif title and the Since overline from the first weigh-in', async () => {
    const { getByText } = await screen();
    expect(getByText('The full picture').props.accessibilityRole).toBe('header');
    await waitFor(() => expect(getByText(formatSince(day(80).slice(0, 10)) as string)).toBeTruthy());
  });

  it('uses sentence-case overlines, never the old Title Case cards', async () => {
    const { getByText, queryByText } = await screen();
    for (const t of ['Body', 'Weight trend', 'Recent weigh-ins', "Today's food"]) expect(getByText(t)).toBeTruthy();
    for (const t of ['Body Stats', 'Recent Entries', 'Weight Trend', 'Goal Progress']) expect(queryByText(t)).toBeNull();
  });

  it('has no floating button: Log weight is the inline forest action and opens the sheet', async () => {
    const { getByTestId, getByLabelText } = await screen();
    const button = getByTestId('progress-log-weight');
    expect(within(getByTestId('progress-screen-scroll')).getByTestId('progress-log-weight')).toBe(button);
    expect(StyleSheet.flatten(button.props.style).position).not.toBe('absolute');
    expect(StyleSheet.flatten(button.props.style).borderRadius).toBe(radius.button);
    await fireEvent.press(getByLabelText('Log weight'));
    expect(getByTestId('log-weight-sheet')).toBeTruthy();
  });

  it('keeps the report link and the period tabs', async () => {
    const { getByLabelText } = await screen();
    await fireEvent.press(getByLabelText('View progress report'));
    expect(mockNavigate).toHaveBeenCalledWith('Report');
    await fireEvent.press(getByLabelText('Show 90D period'));
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith(90));
    expect(getByLabelText('Show 90D period').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('serif numbers never clip: line height at least 1.2 x the size', async () => {
    const { getByTestId } = await screen();
    const style = StyleSheet.flatten(getByTestId('progress-weight-change').props.style);
    expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(1.2);
  });
});

describe('Truthful numbers (WEIGH-KB-128 U12)', () => {
  it('U12: Start and Change come from the first weigh-in ever, not the 30-day window', async () => {
    const { getByText, getByTestId } = await screen();
    await waitFor(() => expect(getByText('196')).toBeTruthy());
    expect(getByTestId('progress-weight-change').props.children).toBe('\u221213');
    expect(mockGetHistory).toHaveBeenCalledWith(30);
    expect(mockGetHistory).toHaveBeenCalledWith(3650);
  });

  it('U12: the line under the chart reads only the period', async () => {
    const { getByText } = await screen();
    await waitFor(() => expect(getByText('Down 2 lb')).toBeTruthy());
    expect(getByText('over the last 30 days')).toBeTruthy();
  });

  it('one day of weigh-ins names no run (never "1 days in a row")', async () => {
    const { getByText, queryByText } = await screen();
    // The Since overline lands in the same update as the run count.
    await waitFor(() => expect(getByText(formatSince(day(80).slice(0, 10)) as string)).toBeTruthy());
    expect(queryByText(/in a row/)).toBeNull();
  });

  it('two days in a row name the run', async () => {
    mockAll = [mockAll[0], mockAll[1], { id: 'd', date: day(2), weight_lbs: 184 }, mockAll[2]];
    const { findByText } = await screen();
    expect(await findByText('2 days in a row with a weigh-in')).toBeTruthy();
  });

  it('a new client sees one calm line and the action, not an empty chart', async () => {
    mockAll = [];
    mockProfile = {};
    const { findByText, queryByLabelText, getByLabelText } = await render(<ProgressScreen />);
    expect(await findByText('No weigh-ins yet. The first one sets the starting point.')).toBeTruthy();
    expect(await findByText('The trend appears after two weigh-ins.')).toBeTruthy();
    expect(queryByLabelText('Show 7D period')).toBeNull();
    expect(getByLabelText('Log weight')).toBeTruthy();
  });
});

describe('progressFormat', () => {
  it('formats the change with a true minus and the Since line', () => {
    expect(formatChange(-1.6)).toBe('\u22121.6');
    expect(formatChange(2)).toBe('+2');
    expect(formatChange(0.01)).toBe('0');
    expect(formatSince('2026-02-12', new Date(2026, 9, 8))).toBe('Since 12 February');
    expect(formatSince('2025-02-12', new Date(2026, 9, 8))).toBe('Since 12 February 2025');
    expect(formatSince('not a date')).toBeNull();
  });
});
