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
  expect(screen.queryByText('Energy level')).toBeNull();
  expect(screen.queryByLabelText('Increase sleep hours')).toBeNull();
  expect(screen.queryByPlaceholderText("How's your day going? Anything noteworthy?")).toBeNull();
  expect(screen.queryByText('Save check-in')).toBeNull();
  expect(screen.queryByText('Update check-in')).toBeNull();
  expect(mockSaveCheckIn).not.toHaveBeenCalled();
}

it.each([false, true])('explains inactive access before editing and uses the existing recovery action (hidden=%s)', async (hidden) => {
  mockHidden = hidden;
  mockEntitlement = { ...mockEntitlement, entitlementActive: false, status: 'inactive', confirmedActive: false };
  // A previous package's cached row must not replace the access explanation.
  queryClient.setQueryData(['check-ins', 'day', TODAY], savedRow);
  const screen = await openCheckIn();
  expect(screen.getByText(REQUIREMENT)).toBeTruthy();
  expect(screen.getByText(hidden ? 'Your coach manages your access' : 'Choose a Plan')).toBeTruthy();
  expectNoForm(screen);
  expect(screen.queryByText('Saved.')).toBeNull();
  expect(mockGetCheckIns).not.toHaveBeenCalled();

  let scroll = screen.getByText(REQUIREMENT).parent;
  while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
  expect(scroll?.props.refreshControl).toBeTruthy();
  await act(async () => scroll?.props.refreshControl.props.onRefresh());
  expect(mockGetCheckIns).not.toHaveBeenCalled();
  expect(mockRefreshEntitlement).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId(hidden ? 'protected-screen-message-coach' : 'protected-screen-view-plans'));
  expect(hidden ? mockMessageCoach : mockOpenPlans).toHaveBeenCalledTimes(1);
  expect(hidden ? mockOpenPlans : mockMessageCoach).not.toHaveBeenCalled();
  if (hidden) expect(screen.queryByText('View Plans')).toBeNull();

  await fireEvent.press(screen.getByText('Habits'));
  await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
  expect(screen.getByText('Add habit')).toBeTruthy();
  await fireEvent.press(screen.getByText('Drink water'));
  await waitFor(() => expect(mockLogHabit).toHaveBeenCalledWith('water', {
    date: TODAY, completed: true, value: 1,
  }));
});

it.each([false, true])('a coachless client can enter a code, not message an absent coach (hidden=%s)', async (hidden) => {
  mockHidden = hidden;
  mockCoachId = undefined;
  mockEntitlement = { ...mockEntitlement, entitlementActive: false, status: 'inactive', confirmedActive: false };
  const screen = await openCheckIn();
  expect(screen.getByText(REQUIREMENT)).toBeTruthy();
  expect(screen.getByText('Logging comes with coaching')).toBeTruthy();
  expectNoForm(screen);
  expect(screen.queryByText('Message your coach')).toBeNull();
  expect(screen.queryByText('View Plans')).toBeNull();
  await fireEvent.press(screen.getByText('Enter a coach code'));
  expect(mockMessageCoach).toHaveBeenCalledTimes(1);
  expect(mockOpenPlans).not.toHaveBeenCalled();
  expect(mockGetCheckIns).not.toHaveBeenCalled();
});

it.each<EntitlementStatus>(['unknown', 'loading', 'checking'])('waits for confirmed access without fetching check-ins (%s)', async (status) => {
  mockEntitlement = { ...mockEntitlement, entitlementActive: null, status, confirmedActive: false };
  const screen = await openCheckIn();
  expect(screen.getByTestId('protected-screen-loading')).toBeTruthy();
  expectNoForm(screen);
  expect(screen.queryByText('Choose a Plan')).toBeNull();
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
  expect(mockGetCheckIns).not.toHaveBeenCalled();
});

it('an unavailable access check offers retry, and newly confirmed access enables the form and read', async () => {
  mockEntitlement = {
    ...mockEntitlement, entitlementActive: null, status: 'unavailable', confirmedActive: false,
  };
  const screen = await openCheckIn();
  expect(screen.getByText('Your access could not be checked')).toBeTruthy();
  expectNoForm(screen);
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
  expect(mockGetCheckIns).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('protected-screen-try-again'));
  expect(mockRefreshEntitlement).toHaveBeenCalledTimes(1);

  mockEntitlement = { ...mockEntitlement, entitlementActive: true, status: 'active', confirmedActive: true };
  await screen.rerender(tree());
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  expect(mockGetCheckIns).toHaveBeenCalledWith({ from: TODAY, to: TODAY, limit: 1 });
  expect(screen.queryByText('Your access could not be checked')).toBeNull();
});

it('keeps mood, energy, sleep, notes and save reachable for active access', async () => {
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Great'));
  await fireEvent.press(screen.getByLabelText('High'));
  await fireEvent.press(screen.getByLabelText('Increase sleep hours'));
  await fireEvent.changeText(screen.getByPlaceholderText("How's your day going? Anything noteworthy?"), 'Slept well.');
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
  expect(screen.getByPlaceholderText("How's your day going? Anything noteworthy?").props.value).toBe(savedRow.notes);
  expect(screen.getByText('6.5h')).toBeTruthy();
  await fireEvent.press(screen.getByText('Update check-in'));
  await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalledWith(savedRow));
});

it('retains check-in read retry and visible save failure instead of silently dropping notes', async () => {
  mockGetCheckIns.mockRejectedValueOnce(new Error('Check-in read unavailable'));
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText("Today's check-in could not be loaded.")).toBeTruthy());
  await fireEvent.press(screen.getByText('Retry check-in'));
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  mockSaveCheckIn.mockRejectedValueOnce(new Error('Check-in service unavailable'));
  await fireEvent.changeText(screen.getByPlaceholderText("How's your day going? Anything noteworthy?"), 'Keep these notes.');
  await fireEvent.press(screen.getByText('Save check-in'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
    "Couldn't save check-in", 'Check-in service unavailable',
  ));
  expect(screen.getByPlaceholderText("How's your day going? Anything noteworthy?").props.value).toBe('Keep these notes.');
  expect(screen.queryByText('Check-in saved')).toBeNull();
});

it.each<EntitlementStatus>(['checking', 'unavailable'])('retains the existing confirmed-active recheck policy (%s)', async (status) => {
  mockEntitlement = { ...mockEntitlement, entitlementActive: null, status, confirmedActive: true };
  const screen = await openCheckIn();
  await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  expect(mockGetCheckIns).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(REQUIREMENT)).toBeNull();
});
