import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import NotificationPreferencesScreen, {
  workoutRemindersFromServer,
} from '../NotificationPreferencesScreen';
import { notificationsApi } from '../../../services/api';

// C05 item 7 — Settings > Notifications > Workout reminders (default on).

jest.mock('../../../services/api', () => ({
  notificationsApi: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
  },
}));

jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F4F1EA',
      surface: '#FFFFFF',
      border: '#E0DDD8',
      primary: '#2C4A36',
      textPrimary: '#1A1A1A',
      textSecondary: '#444444',
      textMuted: '#777777',
      white: '#FFFFFF',
    },
  }),
}));

const mockGet = notificationsApi.getPreferences as jest.Mock;
const mockUpdate = notificationsApi.updatePreferences as jest.Mock;
function cast<T>(v: unknown): T {
  return v as T;
}
const navigation = cast<Parameters<typeof NotificationPreferencesScreen>[0]['navigation']>({ goBack: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('workoutRemindersFromServer', () => {
  it('reads the boolean and ignores anything else', () => {
    expect(workoutRemindersFromServer({ workout_reminder_push: false })).toBe(false);
    expect(workoutRemindersFromServer({ workout_reminder_push: true })).toBe(true);
    expect(workoutRemindersFromServer({})).toBeNull();
    expect(workoutRemindersFromServer(null)).toBeNull();
  });
});

describe('NotificationPreferencesScreen — workout reminders', () => {
  it('shows the toggle on by default', async () => {
    mockGet.mockResolvedValue({ data: {} });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(true);
  });

  it('reflects the server value', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: false } });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(false);
  });

  it('turning it off patches both workout reminder channels', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate.mockResolvedValue({ data: {} });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ workout_reminder_push: false, workout_reminder_inapp: false }),
    );
  });
});
