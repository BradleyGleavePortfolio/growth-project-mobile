/**
 * HEALTH-2 (owner #HEALTH-PAGES op 1, slice 2): the Metric detail of a daily total with a starter goal behind
 * featureFlags.healthPages, and its Share on SHARE-A's sheet. MOCK-HEALTH boards 5 (detail), 6 (share), 11 (offline).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockSamples: () => object = () => ({});
jest.mock('../../../../hooks/useWearableSamples', () => ({ useWearableSamples: () => mockSamples() }));
let mockOnline = true;
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', coach_id: 'coach-1' }) }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: async () => ({ data: { name: 'Sam Rivers' } }) } }));
let mockFlags = { healthPages: true, shareSendV1: true };
jest.mock('../../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
let mockParams: Record<string, unknown> = { metric: 'STEPS', bucket: 'HEALTH_FITNESS' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), error: jest.fn(), success: jest.fn() },
}));
jest.mock('../components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../components/ProviderOverlapChips', () => ({ __esModule: true, default: () => null }));
jest.mock('../charts/RevolutGlowChart', () => ({ __esModule: true, default: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/card.png') }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));

import MetricDetailScreen from '../MetricDetailScreen';
import { dayAverage, subLine } from '../MetricDetailV2';

const haptic = () => jest.requireMock('../../../../ui/haptics/haptics.service').HapticService;
const NOW = new Date();
const day = (ago: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - ago, 9);
// Today 3,200 so far; the 6 days before 8,000 7,000 9,000 6,000 7,500 8,100 (7,600 a day); the week before 7,000 a day.
const WEEK = [3200, 8000, 7000, 9000, 6000, 7500, 8100];
const value = (ago: number) => WEEK[ago] ?? (ago < 14 ? 7000 : 5000);
const steps = (agos: number[]) => ({
  metric: 'STEPS', unit: 'count', provider_used: 'APPLE_HEALTHKIT', sample_count: agos.length,
  samples: agos.map((ago) => ({ start_at: day(ago).toISOString(), end_at: day(ago).toISOString(), value: value(ago), provider: 'APPLE_HEALTHKIT' })),
});
const ALL = Array.from({ length: 30 }, (_, i) => i);
const mockRefetch = jest.fn(async () => ({ isError: true }));
const ok = (agos = ALL) => ({
  data: { bucket: 'HEALTH_FITNESS', window: {}, series: [steps(agos)], freshness: [] },
  isLoading: false, isError: false, error: null, dataUpdatedAt: Date.now(), refetch: mockRefetch,
});
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MetricDetailScreen />
  </QueryClientProvider>,
);
const short = (ago: number) => day(ago).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

beforeEach(() => {
  jest.clearAllMocks();
  [mockOnline, mockFlags, mockParams] = [true, { healthPages: true, shareSendV1: true }, { metric: 'STEPS', bucket: 'HEALTH_FITNESS' }];
  mockSamples = () => ok();
});

it.each([
  ['the flag is off', { healthPages: false, shareSendV1: true }, { metric: 'STEPS', bucket: 'HEALTH_FITNESS' }],
  ['a coach reads a client', { healthPages: true, shareSendV1: true }, { metric: 'STEPS', bucket: 'HEALTH_FITNESS', clientId: 'c1' }],
  ['a reading has no starter goal', { healthPages: true, shareSendV1: true }, { metric: 'RESTING_HEART_RATE', bucket: 'SLEEP_RECOVERY' }],
])('keeps the earlier Metric detail when %s', (_, flags, params) => {
  [mockFlags, mockParams] = [flags, params];
  show();
  expect(screen.getByTestId('metric-detail')).toBeTruthy();
  expect(screen.queryByTestId('metric-detail-v2')).toBeNull();
});

it('board 5, Week: the average a day not counting today, the week before, bars with the goal line, Goal and Recent days', () => {
  show();
  expect(screen.getByLabelText('Back to Health and sleep')).toBeTruthy();
  expect(screen.getByText('Health and sleep')).toBeTruthy();
  expect(screen.getByText('Average a day, not counting today')).toBeTruthy();
  expect(screen.getByText('7,600')).toBeTruthy();
  expect(screen.getByText('steps a day')).toBeTruthy();
  expect(screen.getByText('600 more a day than the week before')).toBeTruthy();
  expect(screen.getAllByTestId('week-step-bar')).toHaveLength(6);
  expect(screen.getByTestId('week-step-today')).toBeTruthy();
  expect(screen.getByTestId('week-step-goal')).toBeTruthy();
  expect(screen.getByText('Starter goal: 5,000 steps')).toBeTruthy();
  expect(screen.getByLabelText(/^Steps, last 7 days: .* 3,200 so far\. Starter goal 5,000\.$/)).toBeTruthy();
  expect(screen.getByText('Reached on 6 of 7 days with data')).toBeTruthy();
  expect(screen.getByText('From Apple Health')).toBeTruthy();
  const today = day(0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  expect(screen.getByLabelText(`${today}, 3,200 steps, so far`)).toBeTruthy();
  expect(screen.getAllByText(/^\d[\d,]* steps$/)).toHaveLength(8); // the goal and 7 days
});

it('Month: one selection haptic, 30 bars and the dates averaged', () => {
  show();
  fireEvent.press(screen.getByTestId('metric-range-month'));
  fireEvent.press(screen.getByTestId('metric-range-month'));
  expect(haptic().selection).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('metric-range-month').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getAllByTestId('week-step-bar')).toHaveLength(29);
  expect(screen.getByText(`${short(29)} to ${short(1)}`)).toBeTruthy();
  expect(screen.getByText(Math.round((45600 + 49000 + 16 * 5000) / 29).toLocaleString('en-US'))).toBeTruthy();
  expect(screen.getByText('Reached on 29 of 30 days with data')).toBeTruthy();
});

it('no reading in the days averaged: No sample yet, never 0, and no Share', () => {
  mockSamples = () => ok([0, 20]);
  show();
  expect(screen.getByText('No sample yet')).toBeTruthy();
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.queryByText(/a day than the week before/)).toBeNull();
  expect(screen.queryByTestId('metric-detail-share')).toBeNull();
  expect(screen.getAllByTestId('week-step-empty')).toHaveLength(6);
});

it('board 6: Share opens one sheet on a Last 7 days card with no Send (no server kind), soft haptic', async () => {
  show();
  fireEvent.press(screen.getByTestId('metric-detail-share'));
  expect(haptic().softImpact).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Share this card')).toBeTruthy();
  expect(screen.getByText('Last 7 days')).toBeTruthy();
  expect(screen.getByText('In this card: your steps for the last 7 days and your daily average.')).toBeTruthy();
  expect(screen.getByText('Not in it: your other health data or where you were.')).toBeTruthy();
  const date = day(0).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  expect(screen.getByText(`From Apple Health · ${date}`)).toBeTruthy();
  expect(screen.getByLabelText(`Picture of your card: Steps, last 7 days, 7,600 steps a day. From Apple Health · ${date}.`)).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Share outside the app' })).toHaveLength(1));
  expect(screen.queryByText(/^Send to/)).toBeNull();
  expect(screen.getByText("Opens your phone's share options with a picture of this card.")).toBeTruthy();
});

it('board 11, offline: the saved series with the warm saved-data card', () => {
  mockOnline = false;
  show();
  expect(screen.getByTestId('metric-detail-saved')).toBeTruthy();
  expect(screen.getByText(/^You're offline\. Showing your last synced data from .+\.$/)).toBeTruthy();
  expect(screen.getByText('7,600')).toBeTruthy();
});

it('a failed load is a calm error with Try again; a failed retry is the error haptic', async () => {
  mockSamples = () => ({ data: undefined, isLoading: false, isError: true, error: new Error('Network Error'), dataUpdatedAt: 0, refetch: mockRefetch });
  show();
  expect(screen.queryByTestId('metric-detail-share')).toBeNull();
  fireEvent.press(screen.getByTestId('metric-detail-error-state-retry'));
  await waitFor(() => expect(haptic().error).toHaveBeenCalledTimes(1));
});

it('dayAverage and subLine skip days with no reading and equal weeks', () => {
  expect(dayAverage([{ date: day(1), total: null }])).toBeNull();
  expect(dayAverage([{ date: day(2), total: 0 }, { date: day(1), total: null }])).toBe(0);
  const flat = ALL.map((ago) => ({ date: day(29 - ago), total: 5000 }));
  expect(subLine(flat, 'week')).toBeNull();
});
