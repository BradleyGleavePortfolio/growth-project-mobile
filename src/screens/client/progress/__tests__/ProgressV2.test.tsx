/**
 * C8 v2 PR 2b: the Progress page and Log weight behind clientProgressV2.
 * Every tap is pressed here; numbers follow the client's unit and the
 * server always gets pounds. Flag off, the existing ProgressScreen suites
 * keep covering the page as it was.
 */
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ProgressScreen from '../../ProgressScreen';
import { getTodayString } from '../../../../utils/date';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { lastWas, trendMove, trendSentence } from '../progressV2';
import type { WeightLog } from '../../../../types';

const today = getTodayString();
const DAY = 86_400_000;
const ago = (n: number, from = today) => new Date(Date.parse(`${from}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
let mockLogs: Array<{ id: string; date: string; weight_lbs: number }> = [];
let mockUser: { id: string; coach_id?: string; profile: Record<string, unknown> } = { id: 'u1', profile: {} };
let mockCoachless = false;
const mockLog = jest.fn(async (_body: unknown): Promise<unknown> => ({}));
const mockHistory = jest.fn(async (): Promise<unknown> => ({ data: { logs: mockLogs } }));
const mockNavigate = jest.fn();
const mockChart = jest.fn();
jest.mock('../../../../services/api', () => ({
  weightApi: { getHistory: () => mockHistory(), log: (body: unknown) => mockLog(body) },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientProgressV2: true, clientTimelineV2: true } }));
jest.mock('../../../../ui/haptics/haptics.service', () => {
  const fns: Record<string | symbol, jest.Mock> = {};
  return { HapticService: new Proxy(fns, { get: (t, k) => (t[k] ??= jest.fn()) }), setHapticsEnabled: jest.fn() };
});
jest.mock('../../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const tokens = require('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('../../../../components/progress/WeightTrendChartDark', () => (props: Record<string, unknown>) => {
  mockChart(props);
  return require('react').createElement(require('react-native').View, { testID: 'progress-weight-chart' });
});

const lastChart = () => mockChart.mock.calls[mockChart.mock.calls.length - 1][0];
const mount = async () => {
  const v = await render(<ProgressScreen />);
  await waitFor(() => expect(mockHistory).toHaveBeenCalled());
  return v;
};
beforeEach(() => {
  jest.clearAllMocks();
  mockLogs = [180, 178, 177, 176].map((w, i) => ({ id: String(i), date: `${ago([40, 20, 7, 1][i])}T00:00:00.000Z`, weight_lbs: w }));
  mockUser = { id: 'u1', coach_id: 'c1', profile: { target_weight_lbs: 170 } };
  mockCoachless = false;
});

it('flag on: the masthead, the trend, the period sentence and the tabs, in pounds', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
  expect(v.getByRole('header', { name: 'Your progress' })).toBeTruthy();
  expect(v.getByText(/^Since [A-Z][a-z]+ \d{1,2}$/)).toBeTruthy();
  expect(v.getByText(/^Down \d+\.\d lb in 30 days\.$/)).toBeTruthy();
  expect(lastChart()).toMatchObject({ unit: 'lb', period: '30D', goal: { value: 170 } });
  expect(v.queryByText("Today's food")).toBeNull();
  expect(v.queryByText(/in a row/)).toBeNull();
  await fireEvent.press(v.getByLabelText('Week'));
  expect(lastChart().period).toBe('7D');
  expect(v.getByText(/^Down \d+\.\d lb this week\.$/)).toBeTruthy();
  await fireEvent.press(v.getByLabelText('All'));
  expect(v.getByText(/^Down \d+\.\d lb since \w+, about \d+\.\d lb a week\.$/)).toBeTruthy();
  await fireEvent.press(v.getByLabelText('Month'));
  expect(lastChart().period).toBe('30D');
  expect(HapticService.selection).toHaveBeenCalledTimes(3);
});

it('a kg client sees kilograms everywhere; the server still gets pounds', async () => {
  mockUser.profile.weight_unit = 'kg';
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const v = await mount();
  await waitFor(() => expect(v.getByText('kg trend')).toBeTruthy());
  expect(lastChart().unit).toBe('kg');
  await fireEvent.press(v.getByLabelText('Log weight'));
  expect(v.getByLabelText('Weight in kilograms').props.value).toBe('79.8');
  await fireEvent.press(v.getByLabelText('0.1 kg more'));
  expect(v.getByLabelText('Weight in kilograms').props.value).toBe('79.9');
  await fireEvent.press(v.getByLabelText('Save weight log entry'));
  await waitFor(() => expect(v.getByText('Weigh-in saved')).toBeTruthy());
  expect(mockLog).toHaveBeenCalledWith({ weight_lbs: 176.15, date: today, notes: undefined });
  expect(v.getByText(/^79\.9 kg at \d{1,2}:\d{2} [ap]m\. Sam sees it\.$/)).toBeTruthy();
  expect(v.getByText('Trend down 0.1 kg')).toBeTruthy();
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('Weigh-in saved');
  expect(v.queryByTestId('log-weight-sheet')).toBeNull();
});

it('Log weight: prefilled, steppers, the last weigh-in, sharing line, close, validation, failure and one save per tap', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const v = await mount();
  await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Log weight'));
  expect(v.getByLabelText('Weight in pounds').props.value).toBe('176.0');
  expect(v.getByText(/^Today, \w+ \d+$/)).toBeTruthy();
  expect(v.getByText(/^\w+day was 176\.0 lb$/)).toBeTruthy();
  expect(v.getByText('Sam sees weigh-ins.')).toBeTruthy();
  await fireEvent.press(v.getByLabelText('0.1 lb less'));
  expect(v.getByLabelText('Weight in pounds').props.value).toBe('175.9');
  await fireEvent.press(v.getByLabelText('Close log weight modal'));
  expect(v.queryByTestId('log-weight-sheet')).toBeNull();

  await fireEvent.press(v.getByLabelText('Log weight'));
  await fireEvent.changeText(v.getByLabelText('Weight in pounds'), '20');
  await fireEvent.press(v.getByLabelText('Save weight log entry'));
  expect(alert).toHaveBeenLastCalledWith('Weight not saved', 'Enter a weight between 40 and 1,500 lb.');
  expect(HapticService.warning).toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();

  mockLog.mockRejectedValueOnce(new Error('offline'));
  await fireEvent.changeText(v.getByLabelText('Weight in pounds'), '175.5');
  await fireEvent.changeText(v.getByLabelText('Enter optional notes'), 'Morning');
  await fireEvent.press(v.getByLabelText('Save weight log entry'));
  await waitFor(() => expect(alert).toHaveBeenLastCalledWith("Couldn't log weight", 'offline'));
  expect(HapticService.error).toHaveBeenCalled();
  expect(v.getByTestId('log-weight-sheet')).toBeTruthy();

  let finish: (value: unknown) => void = () => undefined;
  mockLog.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await fireEvent.press(v.getByLabelText('Save weight log entry'));
  await fireEvent.press(v.getByLabelText('Saving'));
  expect(mockLog).toHaveBeenCalledTimes(2);
  expect(mockLog).toHaveBeenLastCalledWith({ weight_lbs: 175.5, date: today, notes: 'Morning' });
  finish({});
  await waitFor(() => expect(v.getByText(/^175\.5 lb at .+\. Sam sees it\.$/)).toBeTruthy());
});

it('coachless: the same page with no coach words', async () => {
  mockCoachless = true;
  mockUser = { id: 'u1', profile: {} };
  const v = await mount();
  await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Log weight'));
  expect(v.queryByText(/sees/)).toBeNull();
  await fireEvent.press(v.getByLabelText('Save weight log entry'));
  await waitFor(() => expect(v.getByText(/^176\.0 lb at \d{1,2}:\d{2} [ap]m\.$/)).toBeTruthy());
});

it('empty and failed reads say so; the Timeline and report rows open their pages', async () => {
  mockLogs = [];
  const v = await mount();
  await waitFor(() => expect(v.getByText('No weigh-ins yet. The first one sets the starting point.')).toBeTruthy());
  expect(v.queryByTestId('progress-weight-chart')).toBeNull();
  await fireEvent.press(v.getByTestId('progress-timeline'));
  expect(mockNavigate).toHaveBeenLastCalledWith('Timeline');
  await fireEvent.press(v.getByTestId('progress-report'));
  expect(mockNavigate).toHaveBeenLastCalledWith('Report');
  mockHistory.mockRejectedValueOnce(new Error('offline'));
  const f = await render(<ProgressScreen />);
  await waitFor(() => expect(f.getByText('The weight chart did not load. Pull down to try again.')).toBeTruthy());
});

describe('progressV2 words and numbers', () => {
  const log = (date: string, weight: number): WeightLog => ({ id: date, userId: 'u', coachId: '', date, weight, unit: 'lbs', createdAt: '' });
  it('up and down share one pattern; no change reads steady', () => {
    const day = '2026-10-14';
    expect(trendSentence([log(ago(3, day), 170), log(day, 172)], '7D', 'lb', day)).toBe('Up 0.2 lb this week.');
    expect(trendSentence([log(ago(3, day), 172), log(day, 170)], '7D', 'lb', day)).toBe('Down 0.2 lb this week.');
    expect(trendSentence([log(ago(3, day), 170), log(day, 170)], '30D', 'kg', day)).toBe('Steady in 30 days.');
    expect(trendSentence([log(day, 170)], '7D', 'lb', day)).toBeNull();
    expect([trendMove(0.3, 'lb'), trendMove(-0.3, 'lb'), trendMove(0.01, 'kg')]).toEqual(['Trend up 0.3 lb', 'Trend down 0.3 lb', 'Trend steady']);
  });
  it('names the last weigh-in by weekday within the week, by date after it', () => {
    expect(lastWas(log('2026-10-12', 169.1), 'lb', '2026-10-14')).toBe('Monday was 169.1 lb');
    expect(lastWas(log('2026-10-06', 169.1), 'kg', '2026-10-14')).toBe('October 6 was 76.7 kg');
    expect(lastWas(log('2026-10-14', 169.1), 'lb', '2026-10-14')).toBeNull();
  });
});
