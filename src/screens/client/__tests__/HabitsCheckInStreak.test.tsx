// ROMAN-EXTRAS-M (#161-2 op 1): Roman's streak line on the Daily check-in tab counts the server's check-in streak.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { romanStreak } from '../../../lib/roman/copy';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { featureFlags } from '../../../config/featureFlags';

const mockGetCheckIns = jest.fn();
const mockSaveCheckIn = jest.fn();

jest.mock('../../../services/api', () => ({
  habitsApi: { getAll: jest.fn(async () => ({ data: [] })), getLogs: jest.fn(async () => ({ data: [] })), logHabit: jest.fn(), create: jest.fn(), delete: jest.fn() },
  checkInsApi: { list: (...a: unknown[]) => mockGetCheckIns(...a), save: (...a: unknown[]) => mockSaveCheckIn(...a) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, status: 'active', checking: false, confirmedActive: true, refreshEntitlement: jest.fn(), openPlans: jest.fn(), messageCoach: jest.fn(), paywallVisible: false, paywallMessage: null, dismissPaywall: jest.fn() }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-s', role: 'student', coach_id: 'coach-s', firstName: 'Ava' }),
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').default,
    semanticColors: require('../../../theme/tokens').lightTokens,
    tokens: require('../../../theme/tokens').default,
  }),
}));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-21', getLocalWeekStart: () => '2026-10-19' }));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanCompetencePill: false, romanChat: true, romanStreakBackendLive: true } }));
jest.mock('../../../components/roman/CompetencePill', () => () => null);
jest.mock('../../../components/roman/RomanAvatar', () => (p: { crop: string }) => {
  const { Text } = require('react-native');
  return require('react').createElement(Text, { testID: 'streak-avatar' }, p.crop);
});
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

import HabitsScreen from '../HabitsScreen';

const mockFlags = featureFlags as unknown as Record<string, boolean>;

const row = (days: number, milestone: number | null) => ({ date: '2026-10-21', mood: 4, energy: 3, sleep_hours: 7, notes: null, streak: { days, milestone } });
let client: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockFlags, { romanChat: true, romanStreakBackendLive: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  mockGetCheckIns.mockResolvedValue({ data: [] });
});
afterEach(() => client.clear());

async function saveOn(days: number, milestone: number | null) {
  const success = jest.spyOn(HapticService, 'success').mockResolvedValue(undefined);
  const s = await render(<QueryClientProvider client={client}><HabitsScreen initialTab="checkin" /></QueryClientProvider>);
  await waitFor(() => expect(s.getByText('Save check-in')).toBeTruthy());
  mockSaveCheckIn.mockResolvedValue({ data: row(days, milestone) });
  mockGetCheckIns.mockResolvedValue({ data: [row(days, milestone)] });
  await fireEvent.press(s.getByText('Save check-in'));
  await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalled());
  return { s, success };
}

it('on the seventh day running, Roman\u2019s line takes the place of "Check-in saved"', async () => {
  const { s, success } = await saveOn(7, 7);
  await waitFor(() => expect(s.getByTestId('checkin-streak')).toBeTruthy());
  expect(s.getByText(romanStreak({ tier: 7, firstName: 'Ava', mode: 'celebration' }))).toBeTruthy();
  expect(s.getByTestId('streak-avatar').props.children).toBe('smile');
  expect(s.getByTestId('checkin-streak').props.accessibilityLiveRegion).toBe('polite');
  expect(s.queryByText('Check-in saved')).toBeNull();
  expect(success).toHaveBeenCalledTimes(1);
});

it('a day that is not 3, 7 or 30 keeps "Check-in saved"', async () => {
  const { s, success } = await saveOn(4, null);
  await waitFor(() => expect(s.getByText('Check-in saved')).toBeTruthy());
  expect(s.queryByTestId('checkin-streak')).toBeNull();
  expect(success).not.toHaveBeenCalled();
});

it('opening the tab on the third day shows Roman\u2019s measured line from today\u2019s check-in', async () => {
  mockGetCheckIns.mockResolvedValue({ data: [row(3, 3)] });
  const s = await render(<QueryClientProvider client={client}><HabitsScreen initialTab="checkin" /></QueryClientProvider>);
  await waitFor(() => expect(s.getByTestId('checkin-streak')).toBeTruthy());
  expect(s.getByText(romanStreak({ tier: 3, firstName: 'Ava', mode: 'default' }))).toBeTruthy();
  expect(s.getByTestId('streak-avatar').props.children).toBe('neutral');
});

it('stays hidden until the server streak is live', async () => {
  mockFlags.romanStreakBackendLive = false;
  const { s, success } = await saveOn(30, 30);
  await waitFor(() => expect(s.getByText('Check-in saved')).toBeTruthy());
  expect(s.queryByTestId('checkin-streak')).toBeNull();
  expect(success).not.toHaveBeenCalled();
});
