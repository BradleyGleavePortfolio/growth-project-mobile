import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import WidgetsScreen from '../WidgetsScreen';
import { scheduleFastingAlert } from '../../../utils/notifications';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockStart = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));
jest.mock('../../../services/api', () => ({ fastingApi: { start: (...args: unknown[]) => mockStart(...args) } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', email: 'client@example.test' }) }));
jest.mock('../../../utils/notifications', () => ({ scheduleFastingAlert: jest.fn(async () => 'notification-1') }));
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
    const at = jest.mocked(scheduleFastingAlert).mock.calls[0][0].getTime();
    expect(Math.abs(at - (Date.now() + 16 * 3600000))).toBeLessThan(60000);
    expect(await AsyncStorage.getItem('fasting:scheduled_notification_id:client-1')).toBe('notification-1');
    expect(mockNavigate).toHaveBeenCalledWith('Fast');
  });

  it('Start fast schedules nothing when Fasting Alerts is off', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ fastingAlerts: false, waterGoalOz: 100 }));
    const screen = await render(<WidgetsScreen />);
    await act(async () => { await Promise.resolve(); });
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    expect(scheduleFastingAlert).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Fast');
  });

  it('a failed start says so and neither schedules nor navigates', async () => {
    mockStart.mockRejectedValue(new Error('A fast is already in progress.'));
    const screen = await render(<WidgetsScreen />);
    await fireEvent.press(screen.getByText('Start fast'));
    await confirmStart();
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Could not start fast', 'A fast is already in progress.'));
    expect(scheduleFastingAlert).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
