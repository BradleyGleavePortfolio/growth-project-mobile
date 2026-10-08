import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import WidgetsScreen from '../WidgetsScreen';
import * as Notifications from 'expo-notifications';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockStart = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));
jest.mock('../../../services/api', () => ({ fastingApi: { start: (...args: unknown[]) => mockStart(...args) } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', email: 'client@example.test' }) }));
// The real scheduleFastingAlert runs, so Settings > Fasting alerts is checked
// by the app's own gate (utils/notifications.ts reads gp_client_settings).
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'notification-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../../../constants/colors').default, semanticColors: require('../../../theme/tokens').lightTokens }),
}));

const confirmStart = async () => {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  expect(buttons?.map((b) => b.text)).toEqual(['Cancel', 'Start']);
  await act(async () => { await buttons?.find((b) => b.text === 'Start')?.onPress?.(); });
};

describe('Shortcuts (WidgetsScreen): every action still works', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStart.mockResolvedValue({ data: {} });
  });

  it('Back goes back and Quick log opens the food log', async () => {
    const screen = await render(<WidgetsScreen />);
    expect(screen.getByText('Shortcuts')).toBeTruthy();
    expect(screen.getByText('Open the food log')).toBeTruthy();
    expect(screen.queryByText('Open the food log from anywhere')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Quick log'));
    expect(mockNavigate).toHaveBeenCalledWith('Log');
  });

  it('Start fast starts 16:8, schedules the same end alert, and opens the timer', async () => {
    const screen = await render(<WidgetsScreen />);
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    expect(mockStart).toHaveBeenCalledWith({ protocol: '16:8' });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const { trigger } = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0];
    const at = new Date((trigger as { date: Date | number }).date).getTime();
    expect(Math.abs(at - (Date.now() + 16 * 3600000))).toBeLessThan(60000);
    expect(await AsyncStorage.getItem('fasting:scheduled_notification_id:client-1')).toBe('notification-1');
    expect(mockNavigate).toHaveBeenCalledWith('Fast');
  });

  it('Start fast schedules nothing when Fasting Alerts is off', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ fastingAlerts: false, waterGoalOz: 100 }));
    const screen = await render(<WidgetsScreen />);
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Fast');
  });

  it('a failed start says so and neither schedules nor navigates', async () => {
    mockStart.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    const screen = await render(<WidgetsScreen />);
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith(
      'Could not start fast', 'The fast did not start. Check the connection and try again.',
    ));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenCalledWith('Fast');
  });
});
