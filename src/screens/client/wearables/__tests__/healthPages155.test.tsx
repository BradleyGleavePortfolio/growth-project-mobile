/**
 * HEALTH-1 (owner #HEALTH-PAGES op 1): the Fitness tab of Health and sleep
 * behind featureFlags.healthPages, off in every build profile. MOCK-HEALTH
 * boards 3 (populated), 8 (no device), 9 (partial), 10 to 12 (loading,
 * offline, error) and the coach line.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockSamples: (p: { bucket: string }) => object = () => ({});
jest.mock('../../../../hooks/useWearableSamples', () => ({ useWearableSamples: (p: { bucket: string }) => mockSamples(p) }));
let mockConnections: object[] | undefined;
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => ({ data: mockConnections, refetch: jest.fn() }),
}));
let mockOnline = true;
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
let mockUser: { id?: string; coach_id?: string } | null = null;
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
let mockCoachName: string | null | undefined = 'Sam Rivers';
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: async () => ({ data: { name: mockCoachName } }) } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const mockSelection = jest.fn();
const mockErrorHaptic = jest.fn();
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: () => mockSelection(), error: () => mockErrorHaptic(), softImpact: jest.fn() },
}));
jest.mock('../components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import HealthFitnessTab, { savedAt } from '../HealthFitnessTab';
import type { GetSamplesParams } from '../../../../api/wearablesSamplesApi';

const { wearableSamplesQueryKey } = jest.requireActual('../../../../hooks/useWearableSamples') as typeof import('../../../../hooks/useWearableSamples');

const NOW = new Date();
const at = (ago: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - ago, 9).toISOString();
const series = (metric: string, days: Array<[number, number]>) => ({
  metric, unit: 'count', provider_used: 'APPLE_HEALTHKIT', sample_count: days.length,
  samples: days.map(([ago, value]) => ({ start_at: at(ago), end_at: at(ago), value, provider: 'APPLE_HEALTHKIT' })),
});
const mockRefetch = jest.fn(async () => ({ isError: true }));
const ok = (s: object[]) => ({
  data: { bucket: 'HEALTH_FITNESS', window: {}, series: s, freshness: [] },
  isLoading: false, isError: false, isRefetching: false, dataUpdatedAt: Date.now(), refetch: mockRefetch,
});
const LINKED = [{ provider: 'APPLE_HEALTHKIT', status: 'connected', last_synced_at: new Date(Date.now() - 5 * 60_000).toISOString() }];
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const show = (client = newClient()) =>
  render(
    <QueryClientProvider client={client}>
      <HealthFitnessTab />
    </QueryClientProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  [mockOnline, mockUser, mockConnections] = [true, null, LINKED];
  mockCoachName = 'Sam Rivers';
});

it('is off in every EAS build profile through the real flag reader', () => {
  type Profile = { extends?: string; env?: Record<string, string> };
  const eas = require('../../../../../eas.json') as { build: Record<string, Profile> };
  const envOf = (name?: string): Record<string, string> => (name ? { ...envOf(eas.build[name].extends), ...(eas.build[name].env ?? {}) } : {});
  const saved = process.env.EXPO_PUBLIC_FF_HEALTH_PAGES;
  try {
    for (const name of Object.keys(eas.build)) {
      const value = envOf(name).EXPO_PUBLIC_FF_HEALTH_PAGES;
      if (value === undefined) delete process.env.EXPO_PUBLIC_FF_HEALTH_PAGES;
      else process.env.EXPO_PUBLIC_FF_HEALTH_PAGES = value;
      jest.isolateModules(() => expect(jest.requireActual('../../../../config/featureFlags').featureFlags.healthPages).toBe(false));
    }
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_FF_HEALTH_PAGES;
    else process.env.EXPO_PUBLIC_FF_HEALTH_PAGES = saved;
  }
});

it('board 3: today toward starter goals, the device row and seven bars with today open', async () => {
  const week: Array<[number, number]> = [[0, 6412], [1, 8213], [2, 7000], [3, 9100], [4, 4800], [5, 10200], [6, 7600]];
  mockSamples = (p) => ok(p.bucket === 'SLEEP_RECOVERY' ? [] : [series('STEPS', week), series('ACTIVE_ENERGY_KCAL', [[0, 214]])]);
  await show();
  expect(screen.getByLabelText('Steps, 6,412 steps. Starter goal: 5,000 steps').props.accessibilityValue)
    .toEqual({ min: 0, max: 5000, now: 5000 });
  expect(screen.getByLabelText('Active energy, 214 kcal. Starter goal: 250 kcal')).toBeTruthy();
  expect(screen.getByLabelText('Exercise minutes, No sample yet. Starter goal: 20 min')).toBeTruthy();
  expect(screen.getAllByTestId('week-step-bar')).toHaveLength(6);
  expect(screen.getByTestId('week-step-today')).toBeTruthy();
  expect(screen.queryByText('No data')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Connected devices, Apple Health, last synced 5m ago'));
  expect(mockNavigate).toHaveBeenLastCalledWith('Connections', undefined);
  await fireEvent.press(screen.getByTestId('health-week-steps'));
  expect(mockNavigate).toHaveBeenLastCalledWith('WearableMetricDetail', { metric: 'STEPS', bucket: 'HEALTH_FITNESS' });
  expect(mockSelection).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('health-coach-line')).toBeNull();
});

it('board 8: no device yet says No sample yet, never zero, and offers Connect Apple Health', async () => {
  mockSamples = () => ok([]);
  mockConnections = [];
  await show();
  expect(screen.getAllByText('No sample yet')).toHaveLength(3);
  expect(screen.queryByText(/^0/)).toBeNull();
  expect(screen.queryByTestId('week-step-bars')).toBeNull();
  await fireEvent.press(screen.getByText('Connect Apple Health'));
  expect(mockNavigate).toHaveBeenLastCalledWith('Connections', undefined);
});

it('board 9: missing days are dashed slots with a No data key; a coached client gets the coach line', async () => {
  mockSamples = (p) => ok(p.bucket === 'SLEEP_RECOVERY' ? [] : [series('STEPS', [[0, 1200], [2, 7000], [5, 6100]])]);
  mockUser = { coach_id: 'coach-1' };
  await show();
  expect(screen.getAllByTestId('week-step-empty')).toHaveLength(4);
  expect(screen.getByText('No data')).toBeTruthy();
  expect(screen.getByText('No heart rate from Apple Health yet. A watch that writes to Apple Health adds it.')).toBeTruthy();
  expect(await screen.findByText('Sam can see the activity your devices bring in.')).toBeTruthy();
});

it.each(['', '   ', null, undefined, 'Your coach', ' Your coach '])('hides the coach line without a first name (%s)', async (name) => {
  mockSamples = () => ok([series('STEPS', [[0, 500]])]);
  mockUser = { id: 'self', coach_id: 'coach-1' };
  mockCoachName = name;
  const client = newClient();
  await show(client);
  await waitFor(() => expect(client.getQueryState(['wearables', 'coach-name', 'coach-1'])?.status).toBe('success'));
  expect(screen.queryByTestId('health-coach-line')).toBeNull();
});

it.each([null, 0, 500])('shows So far only when today has a reading (%s), including a real zero', async (total) => {
  mockSamples = (p) => ok(p.bucket === 'SLEEP_RECOVERY' ? [] : [
    series('STEPS', total == null ? [[1, 800]] : [[0, total], [1, 800]]),
  ]);
  await show();
  expect(Boolean(screen.queryByText('So far'))).toBe(total != null);
  expect(Boolean(screen.queryByTestId('week-step-today'))).toBe(total != null);
  const label = screen.getByTestId('week-step-bars').props.accessibilityLabel as string;
  expect(label).toContain(total == null ? 'No data' : `${total} so far`);
  if (total == null) expect(label).not.toContain('so far');
});

it('offline in a later hour restores the newest own Fitness and heart data with its saved time', async () => {
  mockOnline = false;
  mockUser = { id: 'self' };
  mockSamples = () => ({ data: undefined, isLoading: false, isError: false, refetch: mockRefetch, dataUpdatedAt: 0 });
  const before = newClient();
  const hour = 60 * 60_000;
  const oldEnd = Math.floor(Date.now() / hour) * hour;
  const params: GetSamplesParams = {
    bucket: 'HEALTH_FITNESS', from: new Date(oldEnd - 30 * 24 * hour).toISOString(),
    to: new Date(oldEnd).toISOString(), granularity: 'day',
  };
  const saved = oldEnd - 20 * 60_000;
  const fitness = { ...ok([series('STEPS', [[0, 975]])]).data, user_id: 'self' };
  before.setQueryData(wearableSamplesQueryKey({ ...params, from: at(35), to: at(2) }), {
    ...ok([series('STEPS', [[0, 100]])]).data, user_id: 'self',
  }, { updatedAt: saved - hour });
  before.setQueryData(wearableSamplesQueryKey(params), fitness, { updatedAt: saved });
  before.setQueryData(wearableSamplesQueryKey({ ...params, bucket: 'SLEEP_RECOVERY', metric: 'RESTING_HEART_RATE_BPM' }), {
    ...ok([series('RESTING_HEART_RATE_BPM', [[0, 55]])]).data, user_id: 'self',
  }, { updatedAt: saved });
  const client = newClient();
  hydrate(client, dehydrate(before));
  await show(client);
  expect(screen.getByLabelText('Steps, 975 steps. Starter goal: 5,000 steps')).toBeTruthy();
  expect(screen.getByText('55')).toBeTruthy();
  expect(screen.getByText(`You're offline. Showing your last synced data from ${savedAt(saved)}.`)).toBeTruthy();
  expect(screen.queryByTestId('health-fitness-error')).toBeNull();
});

it.each([
  { user_id: 'other' }, { clientId: 'other' }, { metric: 'STEPS' }, { bucket: 'SLEEP_RECOVERY' },
  { granularity: 'raw' }, { preferredOnly: false }, { providers: ['HEALTH_CONNECT'] }, { timezone: 'UTC' },
])('does not reuse another identity or a differently scoped saved query (%j)', async (overrides) => {
  mockOnline = false;
  mockUser = { id: 'self' };
  mockSamples = () => ({ data: undefined, isLoading: false, isError: false, refetch: mockRefetch });
  const client = newClient();
  const { user_id = 'self', ...scope } = overrides;
  const params = { bucket: 'HEALTH_FITNESS', from: at(30), to: at(1), granularity: 'day', ...scope } as GetSamplesParams;
  client.setQueryData(wearableSamplesQueryKey(params), { ...ok([series('STEPS', [[0, 975]])]).data, user_id });
  await show(client);
  expect(screen.getByTestId('health-fitness-error')).toBeTruthy();
  expect(screen.queryByTestId('health-fitness-saved')).toBeNull();
  expect(screen.queryByText('975')).toBeNull();
});

it('boards 10 to 12: loading, offline with saved data, error with Try again', async () => {
  mockSamples = () => ({ data: undefined, isLoading: true, isError: false, refetch: mockRefetch });
  const loading = await show();
  expect(screen.getByLabelText('Loading your fitness overview')).toBeTruthy();
  await loading.unmount();
  mockOnline = false;
  mockSamples = () => ok([series('STEPS', [[0, 500]])]);
  const offline = await show();
  expect(screen.getByText(/^You're offline\. Showing your last synced data from \d/)).toBeTruthy();
  await offline.unmount();
  mockOnline = true;
  mockSamples = () => ({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch });
  await show();
  expect(screen.getByText('The health server did not answer just now. Your data is safe. Try again.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(mockErrorHaptic).toHaveBeenCalledTimes(1));
  expect(savedAt(new Date(2026, 9, 16, 9).getTime(), new Date(2026, 9, 17, 10))).toBe('October 16');
});
