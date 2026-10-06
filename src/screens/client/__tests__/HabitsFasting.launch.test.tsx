import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetHabits = jest.fn();
const mockGetLogs = jest.fn();
const mockCreateHabit = jest.fn();
const mockLogHabit = jest.fn();
const mockGetHistory = jest.fn();
const mockStartFast = jest.fn();
const mockEndFast = jest.fn();
const mockUser = { id: 'client-1', email: 'client@example.test' };

jest.mock('../../../services/api', () => ({
  habitsApi: {
    getAll: (...args: unknown[]) => mockGetHabits(...args),
    getLogs: (...args: unknown[]) => mockGetLogs(...args),
    create: (...args: unknown[]) => mockCreateHabit(...args),
    logHabit: (...args: unknown[]) => mockLogHabit(...args),
    delete: jest.fn(async () => undefined),
  },
  checkInsApi: { list: jest.fn(async () => ({ data: [] })) },
  fastingApi: {
    getHistory: (...args: unknown[]) => mockGetHistory(...args),
    start: (...args: unknown[]) => mockStartFast(...args),
    end: (...args: unknown[]) => mockEndFast(...args),
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').default,
    semanticColors: require('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'),
  getTodayString: () => '2026-10-07',
  getLocalWeekStart: () => '2026-10-05',
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanCompetencePill: false } }));
jest.mock('../../../components/roman/CompetencePill', () => () => null);
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../../utils/notifications', () => ({
  scheduleFastingAlert: jest.fn(async () => 'notification-1'),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Warning: 'warning', Success: 'success' },
}));
jest.mock('../../../components/FadeInView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: import('react').ReactNode }) => React.createElement(View, null, children);
});

import HabitsScreen from '../HabitsScreen';
import FastingScreen from '../FastingScreen';
import type { ApiHabitLog } from '../../../hooks/useApi';

let queryClient: QueryClient;
let logs: ApiHabitLog[];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  logs = [];
  mockGetHabits.mockResolvedValue({
    data: [{
      id: 'water', user_id: 'client-1', name: 'Drink water', target_value: 8, unit: 'glasses',
      logs: [
        { date: '2026-10-05T00:00:00.000Z', completed: true },
        { date: '2026-10-06T00:00:00.000Z', completed: true },
      ],
    }],
  });
  mockGetLogs.mockImplementation(async () => ({ data: logs }));
  mockLogHabit.mockImplementation(async (id: string, data: { date: string; completed: boolean; value: number }) => {
    logs = [{ id: 'log-1', habit_id: id, user_id: 'client-1', ...data }];
    return { data: logs[0] };
  });
  mockCreateHabit.mockResolvedValue({ data: { id: 'new-habit' } });
  mockGetHistory.mockResolvedValue({ data: [] });
  mockStartFast.mockResolvedValue({ data: {} });
  mockEndFast.mockResolvedValue({ data: {} });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

const renderHabits = () => render(
  <QueryClientProvider client={queryClient}><HabitsScreen /></QueryClientProvider>,
);

describe('Habits — production DTO, check-off and server history', () => {
  it('adds a habit using only fields accepted by the production CreateHabitDto', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add New Habit'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Drink 8 glasses of water'), 'Walk daily');
    await fireEvent.press(screen.getByText('Add Habit'));
    await waitFor(() => expect(mockCreateHabit).toHaveBeenCalledWith({
      name: 'Walk daily', category: 'custom', target_value: 1, unit: 'times',
    }));
    expect(screen.queryByText('Icon')).toBeNull();
    expect(screen.queryByText('Color')).toBeNull();
  });

  it('check-off shows the saved quantity, and undo persists zero and clears today', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Drink water'));
    await waitFor(() => expect(screen.getByText('8/8 glasses')).toBeTruthy());
    expect(mockLogHabit).toHaveBeenLastCalledWith('water', {
      date: '2026-10-07', completed: true, value: 8,
    });
    expect(screen.getByTestId('habit-week-water-2').props.accessibilityLabel).toContain('completed');
    await fireEvent.press(screen.getByText('Drink water'));
    await waitFor(() => expect(screen.getByText('0/8 glasses')).toBeTruthy());
    expect(mockLogHabit).toHaveBeenLastCalledWith('water', {
      date: '2026-10-07', completed: false, value: 0,
    });
    expect(screen.getByTestId('habit-week-water-2').props.accessibilityLabel).toContain('not completed');
  });

  it('shows recorded consecutive days in the week indicators', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    expect(screen.getByTestId('habit-week-water-0').props.accessibilityLabel).toBe('M: completed');
    expect(screen.getByTestId('habit-week-water-1').props.accessibilityLabel).toBe('T: completed');
    expect(screen.getByTestId('habit-week-water-2').props.accessibilityLabel).toBe('W: not completed');
  });

  it('shows a load failure and retry, not an empty 0% progress claim', async () => {
    mockGetHabits.mockRejectedValueOnce(new Error('Network unavailable'));
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Habits could not be loaded.')).toBeTruthy());
    expect(screen.queryByText('0%')).toBeNull();
    await fireEvent.press(screen.getByText('Retry habits'));
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
  });

  it('shows a useful empty state for a new client', async () => {
    mockGetHabits.mockResolvedValue({ data: [] });
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('No habits yet. Add a daily habit to start tracking.')).toBeTruthy());
  });
});

describe('Fasting — production protocol and completed status', () => {
  it.each([12, 16, 18, 20, 24])('restores the selected %ih target on reopen', async (hours) => {
    mockGetHistory.mockResolvedValue({ data: [{
      id: 'active', start_time: new Date(Date.now() - 2 * 3600000).toISOString(),
      end_time: null, protocol: `${hours}:${24 - hours}`,
    }] });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText(`${hours}h`)).toBeTruthy());
    expect(screen.getByText(/02:00:\d{2}/)).toBeTruthy();
  });

  it('starting 12:12 sends the protocol and shows the same server-backed target', async () => {
    mockStartFast.mockImplementation(async (data: { protocol: string }) => {
      mockGetHistory.mockResolvedValue({ data: [{
        id: 'active', start_time: new Date().toISOString(), end_time: null, protocol: data.protocol,
      }] });
      return { data: {} };
    });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('12:12')).toBeTruthy());
    await fireEvent.press(screen.getByText('12:12'));
    await fireEvent.press(screen.getByLabelText('Start fast'));
    await waitFor(() => expect(screen.getByText('12h')).toBeTruthy());
    expect(mockStartFast).toHaveBeenCalledWith({ protocol: '12:12' });
  });

  it('ending early saves history without awarding a completion', async () => {
    const session = {
      id: 'early', start_time: new Date(Date.now() - 600000).toISOString(),
      end_time: null as string | null, protocol: '12:12',
    };
    mockGetHistory.mockImplementation(async () => ({ data: [{ ...session }] }));
    mockEndFast.mockImplementation(async () => {
      session.end_time = new Date().toISOString();
      return { data: { ...session } };
    });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByLabelText('End fast')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('End fast'));
    const alert = jest.mocked(Alert.alert).mock.calls.at(-1);
    expect(alert?.[1]).toContain('saved in history, but will not count as completed');
    const endAnyway = alert?.[2]?.find((button) => button.text === 'End anyway');
    await act(async () => { await endAnyway?.onPress?.(); });
    await waitFor(() => expect(screen.getByText('Recent Fasts')).toBeTruthy());
    expect(mockEndFast).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fasting-completed-count').props.children).toBe(0);
    expect(screen.getByText('12h target')).toBeTruthy();
  });

  it('counts consecutive qualifying days, excluding a short ended fast today', async () => {
    const sessions = [0, 1, 2].map((daysAgo) => {
      const start = new Date();
      start.setHours(12, 0, 0, 0);
      start.setDate(start.getDate() - daysAgo);
      return {
        id: `day-${daysAgo}`, start_time: start.toISOString(), protocol: '12:12',
        end_time: new Date(start.getTime() + (daysAgo === 0 ? 1 : 11) * 3600000).toISOString(),
      };
    });
    mockGetHistory.mockResolvedValue({ data: sessions });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('Day 2')).toBeTruthy());
    expect(screen.getByTestId('fasting-completed-count').props.children).toBe(2);
  });
});
