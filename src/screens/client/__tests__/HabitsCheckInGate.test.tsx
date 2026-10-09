import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntitlementContextValue, EntitlementStatus } from '../../../entitlements/EntitlementProvider';

const mockGetHabits = jest.fn();
const mockGetLogs = jest.fn();
const mockLogHabit = jest.fn();
const mockGetCheckIns = jest.fn();
const mockSaveCheckIn = jest.fn();
const mockOpenPlans = jest.fn();
const mockMessageCoach = jest.fn();
const mockRefreshEntitlement = jest.fn(async () => false);
let mockEntitlement: EntitlementContextValue;
let mockCoachId: string | undefined;
let mockHidden: boolean;

jest.mock('../../../services/api', () => ({
  habitsApi: {
    getAll: (...args: unknown[]) => mockGetHabits(...args),
    getLogs: (...args: unknown[]) => mockGetLogs(...args),
    logHabit: (...args: unknown[]) => mockLogHabit(...args),
    create: jest.fn(),
    delete: jest.fn(),
  },
  checkInsApi: {
    list: (...args: unknown[]) => mockGetCheckIns(...args),
    save: (...args: unknown[]) => mockSaveCheckIn(...args),
  },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => mockEntitlement,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-gate', role: 'student', coach_id: mockCoachId }),
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../config/purchaseSurfaces', () => ({
  nonP2PPurchasesHidden: () => mockHidden,
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').default,
    semanticColors: require('../../../theme/tokens').lightTokens,
    tokens: require('../../../theme/tokens').default,
  }),
}));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'),
  getTodayString: () => '2026-10-08',
  getLocalWeekStart: () => '2026-10-05',
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanCompetencePill: false } }));
jest.mock('../../../components/roman/CompetencePill', () => () => null);
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

import HabitsScreen from '../HabitsScreen';

let queryClient: QueryClient;
const TODAY = '2026-10-08';
const REQUIREMENT = 'Daily check-ins need active coaching access.';
const savedRow = { date: TODAY, mood: 4, energy: 2, sleep_hours: 6.5, notes: 'A recorded check-in.' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockCoachId = 'coach-gate';
  mockHidden = false;
  mockEntitlement = {
    entitlementActive: true, status: 'active', checking: false, confirmedActive: true,
    refreshEntitlement: mockRefreshEntitlement, openPlans: mockOpenPlans,
    messageCoach: mockMessageCoach, paywallVisible: false, paywallMessage: null,
    dismissPaywall: jest.fn(),
  };
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  mockGetHabits.mockResolvedValue({ data: [{
    id: 'water', user_id: 'client-gate', name: 'Drink water', target_value: 1, unit: 'glass',
  }] });
  mockGetLogs.mockResolvedValue({ data: [] });
  mockLogHabit.mockResolvedValue({ data: {} });
  mockGetCheckIns.mockResolvedValue({ data: [] });
  mockSaveCheckIn.mockResolvedValue({ data: {} });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

const tree = () => <QueryClientProvider client={queryClient}><HabitsScreen /></QueryClientProvider>;

async function openCheckIn() {
  const screen = await render(tree());
  await fireEvent.press(screen.getByText('Daily check-in'));
  return screen;
}

function expectNoForm(screen: Awaited<ReturnType<typeof openCheckIn>>) {
  expect(screen.queryByText('How are you feeling?')).toBeNull();
  expect(screen.queryByText('How is your energy?')).toBeNull();
  expect(screen.queryByLabelText('Increase sleep hours')).toBeNull();
  expect(screen.queryByPlaceholderText('Anything worth noting about today')).toBeNull();
  expect(screen.queryByText('Save check-in')).toBeNull();
  expect(screen.queryByText('Update check-in')).toBeNull();
  expect(mockSaveCheckIn).not.toHaveBeenCalled();
}

// B1 (owner ruling 10-08 23:5x): check-ins are the client's own basic
// function, open to every client. A coached client with no package, a free
// package or a lapsed plan checks in whatever the entitlement check says.
const GATE_LINES = [
  REQUIREMENT, 'Choose a Plan', 'Your coach manages your access', 'Your access could not be checked',
  'Logging comes with coaching', 'This part comes with a coach',
];
it.each<[EntitlementStatus, boolean]>([
  ['inactive', false], ['inactive', true], ['unknown', false], ['loading', false], ['checking', false], ['unavailable', false],
])('a coached client checks in with no gate or access line while access is %s (hidden=%s)', async (status, hidden) => {
  mockHidden = hidden;
  mockEntitlement = {
    ...mockEntitlement, entitlementActive: status === 'inactive' ? false : null, status, confirmedActive: false,
  };
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  expect(mockGetCheckIns).toHaveBeenCalledWith({ from: TODAY, to: TODAY, limit: 1 });
  for (const line of GATE_LINES) expect(screen.queryByText(line)).toBeNull();
  for (const id of ['protected-screen-loading', 'protected-screen-paywall', 'protected-screen-coach-managed']) {
    expect(screen.queryByTestId(id)).toBeNull();
  }

  let scroll = screen.getByText('How are you feeling?').parent;
  while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
  await act(async () => scroll?.props.refreshControl.props.onRefresh());
  expect(mockGetCheckIns).toHaveBeenCalledTimes(2);
  expect(mockRefreshEntitlement).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('Habits'));
  await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
  await fireEvent.press(screen.getByText('Drink water'));
  await waitFor(() => expect(mockLogHabit).toHaveBeenCalledWith('water', {
    date: TODAY, completed: true, value: 1,
  }));
});

// CLIENT-POLISH-134 item 5 (B22/B24): check-ins are open to a client with no
// coach server-side (b#888), so the check-in is never gated for them.
it.each([false, true])('a coachless client checks in without a gate or an access line (hidden=%s)', async (hidden) => {
  mockHidden = hidden;
  mockCoachId = undefined;
  mockEntitlement = { ...mockEntitlement, entitlementActive: false, status: 'inactive', confirmedActive: false };
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('How are you feeling?')).toBeTruthy());
  expect(mockGetCheckIns).toHaveBeenCalled();
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
  for (const line of ['Logging comes with coaching', 'This part comes with a coach', 'Choose a Plan', 'Your coach manages your access']) {
    expect(screen.queryByText(line)).toBeNull();
  }
  expect(screen.queryByText('Enter a coach code')).toBeNull();
});

it('keeps mood, energy, sleep, notes and save reachable for active access', async () => {
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Great'));
  await fireEvent.press(screen.getByLabelText('High'));
  await fireEvent.press(screen.getByLabelText('Increase sleep hours'));
  await fireEvent.changeText(screen.getByPlaceholderText('Anything worth noting about today'), 'Slept well.');
  await fireEvent.press(screen.getByText('Save check-in'));
  await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalledWith({
    date: TODAY, mood: 5, energy: 4, sleep_hours: 7.5, notes: 'Slept well.',
  }));
  await waitFor(() => expect(screen.getByText('Check-in saved')).toBeTruthy());
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
});

it('hydrates and updates an existing check-in without changing the accepted payload', async () => {
  mockGetCheckIns.mockResolvedValue({ data: [savedRow] });
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Update check-in')).toBeTruthy());
  expect(screen.getByPlaceholderText('Anything worth noting about today').props.value).toBe(savedRow.notes);
  expect(screen.getByText('6.5h')).toBeTruthy();
  await fireEvent.press(screen.getByText('Update check-in'));
  await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalledWith(savedRow));
});

it('retains check-in read retry and visible save failure instead of silently dropping notes', async () => {
  mockGetCheckIns.mockRejectedValueOnce(new Error('Check-in read unavailable'));
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText("Today's check-in did not load. Check your connection, then try again.")).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  mockSaveCheckIn.mockRejectedValueOnce(new Error('Check-in service unavailable'));
  await fireEvent.changeText(screen.getByPlaceholderText('Anything worth noting about today'), 'Keep these notes.');
  await fireEvent.press(screen.getByText('Save check-in'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
    "Couldn't save check-in", 'Check-in service unavailable',
  ));
  expect(screen.getByPlaceholderText('Anything worth noting about today').props.value).toBe('Keep these notes.');
  expect(screen.queryByText('Check-in saved')).toBeNull();
});

it.each<EntitlementStatus>(['checking', 'unavailable'])('retains the existing confirmed-active recheck policy (%s)', async (status) => {
  mockEntitlement = { ...mockEntitlement, entitlementActive: null, status, confirmedActive: true };
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  expect(mockGetCheckIns).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
});
