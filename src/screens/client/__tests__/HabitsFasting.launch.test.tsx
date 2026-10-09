import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetHabits = jest.fn();
const mockGetLogs = jest.fn();
const mockCreateHabit = jest.fn();
const mockLogHabit = jest.fn();
const mockDeleteHabit = jest.fn();
const mockSaveCheckIn = jest.fn();
const mockGetCheckIns = jest.fn();
let mockSemanticColors: typeof import('../../../theme/tokens').lightTokens;
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
    delete: (...args: unknown[]) => mockDeleteHabit(...args),
  },
  checkInsApi: { list: (...args: unknown[]) => mockGetCheckIns(...args), save: (...args: unknown[]) => mockSaveCheckIn(...args) },
  fastingApi: {
    getHistory: (...args: unknown[]) => mockGetHistory(...args),
    start: (...args: unknown[]) => mockStartFast(...args),
    end: (...args: unknown[]) => mockEndFast(...args),
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({
    entitlementActive: true, status: 'active', confirmedActive: true, refreshEntitlement: jest.fn(),
  }),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').default,
    semanticColors: mockSemanticColors,
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
// The real scheduleFastingAlert runs, so Settings > Fasting alerts is checked
// by the app's own gate (utils/notifications.ts reads gp_client_settings).
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'notification-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
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

import HabitsScreen, { habitsSummary } from '../HabitsScreen';
import { radius } from '../../../theme/tokens';
import { makeStyles } from '../habits/styles';
import FastingScreen from '../FastingScreen';
import type { ApiHabitLog } from '../../../hooks/useApi';

let queryClient: QueryClient;
let logs: ApiHabitLog[];

beforeEach(() => {
  jest.clearAllMocks();
  mockSemanticColors = require('../../../theme/tokens').lightTokens;
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
  mockDeleteHabit.mockResolvedValue({ data: {} });
  mockSaveCheckIn.mockResolvedValue({ data: {} });
  mockGetCheckIns.mockResolvedValue({ data: [] });
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
    await fireEvent.press(screen.getByText('Add habit'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Drink 8 glasses of water'), 'Walk daily');
    await fireEvent.changeText(screen.getByLabelText('Habit target'), '3');
    await fireEvent.changeText(screen.getByLabelText('Habit unit'), 'times');
    await fireEvent.press(screen.getByText('Create habit'));
    await waitFor(() => expect(mockCreateHabit).toHaveBeenCalledWith({
      name: 'Walk daily', category: 'custom', target_value: 3, unit: 'times',
    }));
    expect(screen.queryByText('Icon')).toBeNull();
    expect(screen.queryByText('Color')).toBeNull();
  });

  it('ignores a second create tap while the first request is pending', async () => {
    let resolveCreate!: (value: { data: { id: string } }) => void;
    const pendingCreate = new Promise<{ data: { id: string } }>((resolve) => {
      resolveCreate = resolve;
    });
    mockCreateHabit.mockReturnValue(pendingCreate);
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add habit'));
    await fireEvent.changeText(screen.getByLabelText('Habit name'), 'Walk daily');
    await fireEvent.press(screen.getByText('Create habit'));
    await waitFor(() => expect(mockCreateHabit).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText(/^(Create|Creating) habit$/));
    expect(mockCreateHabit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating habit' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Creating habit' }).props.accessibilityState.busy).toBe(true);

    await act(async () => { resolveCreate({ data: { id: 'new-habit' } }); });
    await waitFor(() => expect(screen.queryByText('New habit')).toBeNull());
    await fireEvent.press(screen.getByText('Add habit'));
    expect(screen.getByLabelText('Habit name').props.value).toBe('');
    expect(screen.getByLabelText('Habit target').props.value).toBe('1');
    expect(screen.getByLabelText('Habit unit').props.value).toBe('times');
    expect(screen.getByRole('button', { name: 'Create habit' })).toBeDisabled();
  });

  it('re-enables create after a failed save, retaining the values for another attempt', async () => {
    let rejectCreate!: (reason: Error) => void;
    const pendingCreate = new Promise<{ data: { id: string } }>((_resolve, reject) => {
      rejectCreate = reject;
    });
    mockCreateHabit.mockReturnValueOnce(pendingCreate);
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add habit'));
    await fireEvent.changeText(screen.getByLabelText('Habit name'), 'Walk daily');
    await fireEvent.changeText(screen.getByLabelText('Habit target'), '3');
    await fireEvent.changeText(screen.getByLabelText('Habit unit'), 'times');
    await fireEvent.press(screen.getByText('Create habit'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating habit' })).toBeDisabled());
    await act(async () => { rejectCreate(new Error('Network unavailable')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create habit' })).toBeEnabled());
    expect(Alert.alert).toHaveBeenCalledWith("Couldn't create habit", expect.any(String));
    expect(screen.getByLabelText('Habit name').props.value).toBe('Walk daily');
    expect(screen.getByLabelText('Habit target').props.value).toBe('3');
    expect(screen.getByLabelText('Habit unit').props.value).toBe('times');
    expect(screen.getByRole('button', { name: 'Create habit' }).props.accessibilityState.busy).toBe(false);
    await fireEvent.press(screen.getByText('Create habit'));
    await waitFor(() => expect(mockCreateHabit).toHaveBeenCalledTimes(2));
    expect(mockCreateHabit).toHaveBeenLastCalledWith({
      name: 'Walk daily', category: 'custom', target_value: 3, unit: 'times',
    });
    await waitFor(() => expect(screen.queryByText('New habit')).toBeNull());
  });

  it.each(['', '   '])('does not submit a blank habit name (%p)', async (name) => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add habit'));
    await fireEvent.changeText(screen.getByLabelText('Habit name'), name);
    expect(screen.getByText('Create habit')).toBeDisabled();
    await fireEvent.press(screen.getByText('Create habit'));
    expect(mockCreateHabit).not.toHaveBeenCalled();
  });

  it('check-off shows the saved quantity, and undo persists zero and clears today', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    expect(screen.getByText('One habit waiting today.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Drink water'));
    await waitFor(() => expect(screen.getByText('8/8 glasses')).toBeTruthy());
    expect(screen.getByText('Done for today.')).toBeTruthy();
    expect(mockLogHabit).toHaveBeenLastCalledWith('water', {
      date: '2026-10-07', completed: true, value: 8,
    });
    expect(screen.getByTestId('habit-week-water-2').props.accessibilityLabel).toContain('completed');
    await fireEvent.press(screen.getByText('Drink water'));
    await waitFor(() => expect(screen.getByText('0/8 glasses')).toBeTruthy());
    expect(screen.getByText('One habit waiting today.')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('Habits did not load. Check your connection, then try again.')).toBeTruthy());
    expect(screen.queryByText('0%')).toBeNull();
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
  });

  it('shows a useful empty state for a new client', async () => {
    mockGetHabits.mockResolvedValue({ data: [] });
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('No habits yet.')).toBeTruthy());
  });

  it('keeps add/dismiss, long-press deletion, check-in editing/saving and tab return reachable', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    let scroll = screen.getByText('Drink water').parent;
    while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
    expect(scroll?.props.refreshControl).toBeTruthy();
    await act(async () => scroll?.props.refreshControl.props.onRefresh());
    expect(mockGetHabits.mock.calls.length).toBeGreaterThan(1);
    expect(mockGetLogs.mock.calls.length).toBeGreaterThan(1);
    expect(mockGetCheckIns.mock.calls.length).toBeGreaterThan(1);
    await fireEvent.press(screen.getByText('Add habit'));
    await fireEvent.press(screen.getByLabelText('Close new habit'));
    expect(screen.queryByText('New habit')).toBeNull();
    await fireEvent(screen.getByText('Drink water'), 'longPress');
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.some((button) => button.text === 'Cancel')).toBe(true);
    const deletion = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Delete');
    await act(async () => { deletion?.onPress?.(); });
    await waitFor(() => expect(mockDeleteHabit).toHaveBeenCalledWith('water'));
    await fireEvent.press(screen.getByText('Daily check-in'));
    expect(screen.queryByText('Saved for today. Change anything and update.')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Great'));
    await fireEvent.press(screen.getByLabelText('High'));
    await fireEvent.press(screen.getByLabelText('Increase sleep hours'));
    await fireEvent.press(screen.getByLabelText('Decrease sleep hours'));
    await fireEvent.changeText(screen.getByPlaceholderText("How's your day going? Anything noteworthy?"), 'Rested');
    await fireEvent.press(screen.getByText('Save check-in'));
    await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      mood: 5, energy: 4, sleep_hours: 7, notes: 'Rested',
    })));
    await fireEvent.press(screen.getByText('Habits'));
    expect(screen.getByText('Drink water')).toBeTruthy();
  });

  it('hydrates a saved check-in and keeps update reachable', async () => {
    mockGetCheckIns.mockResolvedValue({ data: [{ date: '2026-10-07', mood: 2, energy: 1, sleep_hours: 6, notes: 'Tired' }] });
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Daily check-in'));
    expect(screen.getByText('Saved for today. Change anything and update.')).toBeTruthy();
    expect(screen.getByLabelText('Bad').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByText('Update check-in'));
    await waitFor(() => expect(mockSaveCheckIn).toHaveBeenCalledWith(expect.objectContaining({ mood: 2, energy: 1, sleep_hours: 6, notes: 'Tired' })));
  });

  it('offers retry instead of an invented check-in when its read fails', async () => {
    mockGetCheckIns.mockRejectedValueOnce(new Error('Offline'));
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    await fireEvent.press(screen.getByText('Daily check-in'));
    expect(screen.getByText("Today's check-in did not load. Check your connection, then try again.")).toBeTruthy();
    expect(screen.queryByText('Save check-in')).toBeNull();
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
  });

  it('shows loading instead of guessed counts or an editable check-in before reads resolve', async () => {
    mockGetHabits.mockReturnValue(new Promise(() => {}));
    mockGetCheckIns.mockReturnValue(new Promise(() => {}));
    const screen = await renderHabits();
    expect(screen.getByLabelText('Loading habits')).toBeTruthy();
    expect(screen.queryByText('One habit waiting today.')).toBeNull();
    await fireEvent.press(screen.getByText('Daily check-in'));
    expect(screen.getByLabelText('Loading check-in')).toBeTruthy();
    expect(screen.queryByText('Save check-in')).toBeNull();
  });

  it('uses semantic colours and keeps the outlined check at 44 pt for a future dark palette', async () => {
    mockSemanticColors = require('../../../theme/tokens').darkTokens;
    const styles = makeStyles(require('../../../constants/colors').default, mockSemanticColors);
    expect(styles.checkCircle).toMatchObject({ width: 44, height: 44 });
    expect(styles.stepperBtn).toMatchObject({ width: 44, height: 44 });
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    expect(StyleSheet.flatten(screen.getByText('Drink water').props.style).color).toBe(mockSemanticColors.textPrimary);
    expect(StyleSheet.flatten(screen.getByText('Add habit').props.style).color).toBe(mockSemanticColors.accentText);
    await fireEvent.press(screen.getByText('Daily check-in'));
    expect(StyleSheet.flatten(screen.getByText('Save check-in').props.style).color).toBe(mockSemanticColors.textOnAccent);
  });
});

describe('Fasting — production protocol and completed status', () => {
  beforeEach(() => AsyncStorage.clear());
  const ALERT_KEY = 'fasting:scheduled_notification_id:client-1';
  const alertTimes = () => jest.mocked(Notifications.scheduleNotificationAsync).mock.calls
    .map(([request]) => new Date((request.trigger as { date: Date | number }).date).getTime());
  const runningFast = (hoursAgo: number, protocol = '16:8') => mockGetHistory.mockResolvedValue({ data: [{
    id: 'active', start_time: new Date(Date.now() - hoursAgo * 3600000).toISOString(), end_time: null, protocol,
  }] });

  it.each([12, 16, 18, 20, 24])('restores the selected %ih target on reopen', async (hours) => {
    mockGetHistory.mockResolvedValue({ data: [{
      id: 'active', start_time: new Date(Date.now() - 2 * 3600000).toISOString(),
      end_time: null, protocol: `${hours}:${24 - hours}`,
    }] });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText(`${hours}h`)).toBeTruthy());
    expect(screen.getByText('2h 00m')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('Recent fasts')).toBeTruthy());
    expect(mockEndFast).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fasting-completed-count').props.children).toBe(0);
    expect(screen.getByText('12h target · Ended early')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('2 days in a row with a completed fast')).toBeTruthy());
    expect(screen.getByTestId('fasting-completed-count').props.children).toBe(2);
    expect(screen.getByText('Average, recent fasts')).toBeTruthy();
    expect(screen.getByText('A fast counts as completed at 90 percent of its target.')).toBeTruthy();
    expect(screen.getAllByText('12h target · Completed')).toHaveLength(2);
  });

  // B-552-SOL-131-1 (LN-SOL-B-131 @ f41ea9b1): the stats come from the newest 50 fasts only
  // (fastingApi.getHistory(50)), so the average says "recent fasts", never "all fasts".
  it('B-552-SOL-131-1: the average is labelled recent fasts, read from the newest 50 only', async () => {
    const start = new Date();
    start.setHours(8, 0, 0, 0);
    start.setDate(start.getDate() - 3);
    mockGetHistory.mockResolvedValue({ data: [{
      id: 'older', start_time: start.toISOString(), protocol: '16:8',
      end_time: new Date(start.getTime() + 16 * 3600000).toISOString(),
    }] });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('Average, recent fasts')).toBeTruthy());
    expect(mockGetHistory).toHaveBeenCalledWith(50);
    expect(screen.queryByText(/all fasts/i)).toBeNull();
  });

  it('one day with a completed fast is not called a run or a program day', async () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    mockGetHistory.mockResolvedValue({ data: [{
      id: 'yesterday', start_time: start.toISOString(), protocol: '12:12',
      end_time: new Date(start.getTime() + 12 * 3600000).toISOString(),
    }] });
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('12h target · Completed')).toBeTruthy());
    expect(screen.getByTestId('fasting-completed-count').props.children).toBe(1);
    expect(screen.queryByText(/in a row|^Day \d/)).toBeNull();
  });

  it('starting a fast schedules the end alert while Fasting Alerts is on (the default)', async () => {
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByLabelText('Start fast')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Start fast'));
    await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1));
    expect(Math.abs(alertTimes()[0] - (Date.now() + 16 * 3600000))).toBeLessThan(60000);
    await waitFor(async () => expect(await AsyncStorage.getItem(ALERT_KEY)).toBe('notification-1'));
  });

  it('starting a fast schedules nothing when Fasting Alerts is off', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ fastingAlerts: false, waterGoalOz: 100 }));
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByLabelText('Start fast')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Start fast'));
    await waitFor(() => expect(mockStartFast).toHaveBeenCalledWith({ protocol: '16:8' }));
    // The reload after the start runs once the alert step has finished.
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledTimes(2));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(ALERT_KEY)).toBeNull();
  });

  it('ending a fast cancels its scheduled end alert', async () => {
    await AsyncStorage.setItem(ALERT_KEY, 'notification-1');
    runningFast(15);
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByLabelText('End fast')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('End fast'));
    await waitFor(() => expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1'));
    expect(mockEndFast).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(ALERT_KEY)).toBeNull();
  });

  it('a running fast reads in hours and minutes, with a progress bar and a forest End fast', async () => {
    runningFast(2);
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('2h 00m')).toBeTruthy());
    expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).toBeNull();
    expect(screen.getByLabelText('Fasting progress')).toBeTruthy();
    const end = StyleSheet.flatten(screen.getByLabelText('End fast').props.style);
    expect(end.backgroundColor).toBe(mockSemanticColors.accent);
    expect(end.backgroundColor).not.toBe(require('../../../constants/colors').default.error);
    // Serif only for the hero number; Inter for what is read.
    expect(StyleSheet.flatten(screen.getByText('2h 00m').props.style).fontFamily).toBe('CormorantGaramond_400Regular');
    expect(StyleSheet.flatten(screen.getByText('Started').props.style).fontFamily).toBe('Inter_400Regular');
  });

  it('keeps every action: a failed load offers Try again, and pull to refresh reloads', async () => {
    mockGetHistory.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByText('Fasting history did not load.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByLabelText('Start fast')).toBeTruthy());
    expect(screen.getByText('Each fast you end is saved here.')).toBeTruthy();
    expect(screen.queryByTestId('fasting-completed-count')).toBeNull();
    await act(async () => { await screen.getByTestId('fasting-scroll').props.refreshControl.props.onRefresh(); });
    expect(mockGetHistory).toHaveBeenCalledTimes(3);
  });
});

describe('REDO-HABITS-CAL-COMM-133 Habits page', () => {
  const flat = (n: { props: { style?: unknown } }) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
  const forest = (screen: Awaited<ReturnType<typeof renderHabits>>) =>
    (screen.queryAllByRole('button') as { props: { style?: unknown } }[]).filter((b) => flat(b).backgroundColor === mockSemanticColors.accent);

  it('says the day in one sentence', () => {
    expect([habitsSummary(0, 3), habitsSummary(2, 3), habitsSummary(3, 3), habitsSummary(1, 1), habitsSummary(4, 12)]).toEqual([
      'Three habits waiting today.', 'Two of three done today.', 'All three done today.', 'Done for today.', 'Four of 12 done today.',
    ]);
  });

  it('no fixed top gap under the native header; serif headline; one rounded forest button, only on check-in', async () => {
    const screen = await renderHabits();
    await waitFor(() => expect(screen.getByText('Drink water')).toBeTruthy());
    expect(flat(screen.getByTestId('habits-screen')).paddingTop).toBe(0);
    const title = flat(screen.getByText('Habits & check-in'));
    expect(title.fontFamily).toMatch(/^CormorantGaramond/);
    expect(Number(title.lineHeight)).toBeGreaterThanOrEqual(1.2 * Number(title.fontSize));
    expect(screen.getByTestId('habits-tab-habits').props.accessibilityState).toMatchObject({ selected: true });
    expect(forest(screen)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('habits-tab-checkin'));
    await waitFor(() => expect(screen.getByText('Save check-in')).toBeTruthy());
    expect(forest(screen)).toHaveLength(1);
    expect(flat(forest(screen)[0]).borderRadius).toBe(radius.button);
  });
});
