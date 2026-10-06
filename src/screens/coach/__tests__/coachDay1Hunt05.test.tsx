/**
 * HUNT-05-124 — coach day 1.
 *
 * B-H05-1: the backend never sends a "new client" alert and nothing reads the
 * coach's Daily Check-in / New Client Alerts / Weekly Summary preferences, yet
 * the first screen a new coach sees promised "new client alerts" and Settings
 * showed three switches for alerts that never arrive.
 * U-H05-2: a coach with no clients yet saw a red "0%" check-in rate and
 * "Active today 0 of 0" on the Overview tab.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../services/commandCenterApi', () => {
  const original = jest.requireActual('../../../services/commandCenterApi');
  return {
    ...original,
    __USING_MOCK_DATA: false,
    commandCenterApi: {
      getOverview: jest.fn(),
      getLtvMetrics: jest.fn(() => new Promise(() => {})),
    },
  };
});
jest.mock('../../../components/command-center/CoachLtvDashboard', () => () => null);

import { commandCenterApi } from '../../../services/commandCenterApi';
import OverviewScreen from '../command-center/OverviewScreen';
import { SettingsToggles } from '../settings/SettingsToggles';
import { DEFAULT_SETTINGS } from '../settings/types';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from '../settings/styles';

const overview = (over: Record<string, number>) => ({
  roster_size: 0,
  active_today: 0,
  check_in_rate_7day: 0,
  open_alerts: 0,
  at_risk_count: 0,
  win_streak_count: 0,
  unread_messages: 0,
  pending_actions: 0,
  ...over,
});

describe('B-H05-1: no promise of alerts the server never sends', () => {
  it('coach Settings shows no switch for daily check-in, new client or weekly summary alerts', async () => {
    const onOpen = jest.fn();
    const { queryByText, getByLabelText } = await render(
      <SettingsToggles
        settings={DEFAULT_SETTINGS}
        onUpdateSetting={jest.fn()}
        onOpenNotificationPreferences={onOpen}
        colors={new Proxy({}, { get: () => '#000000' }) as unknown as ThemeColors}
        styles={new Proxy({}, { get: () => ({}) }) as unknown as SettingsStyles}
      />,
    );
    expect(queryByText('New Client Alerts')).toBeNull();
    expect(queryByText('Weekly Summary')).toBeNull();
    expect(queryByText('Daily Check-in')).toBeNull();
    // The real controls stay: notification preferences and haptics.
    await fireEvent.press(getByLabelText('Notification preferences'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(queryByText('Haptics')).toBeTruthy();
  });

  it('the coach push primer names only alerts that exist', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../../components/home/PushPermissionCard.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/new client alerts/i);
    expect(src).toContain('Turn on notifications so you see client messages and bookings as they arrive.');
  });
});

describe('U-H05-2: Overview with no clients yet', () => {
  it('shows no red 0% check-in rate and no "of 0" for a coach with no clients', async () => {
    (commandCenterApi.getOverview as jest.Mock).mockResolvedValue({ data: overview({}) });
    const { getByTestId, queryByText } = await render(<OverviewScreen />);
    await waitFor(() => expect(getByTestId('command-center-kpi-checkin-rate')).toBeTruthy());
    expect(getByTestId('command-center-kpi-checkin-rate').props.accessibilityLabel).toBe(
      'Check-in rate (7 days): —',
    );
    expect(queryByText('0%')).toBeNull();
    expect(queryByText('of 0')).toBeNull();
  });

  it('keeps the real rate once clients exist', async () => {
    (commandCenterApi.getOverview as jest.Mock).mockResolvedValue({
      data: overview({ roster_size: 12, active_today: 8, check_in_rate_7day: 0.75 }),
    });
    const { getByTestId, getByText } = await render(<OverviewScreen />);
    await waitFor(() => expect(getByText('75%')).toBeTruthy());
    expect(getByText('of 12')).toBeTruthy();
    expect(getByTestId('command-center-kpi-checkin-rate')).toBeTruthy();
  });
});
