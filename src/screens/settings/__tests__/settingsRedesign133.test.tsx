/**
 * REDO-SETTINGS-133 (APPLY-SETTINGS-133, part 1): Notifications and the
 * privacy screens sit on the shared Screen (insets from safe-area-context plus
 * the status-bar gap), round their corners from the radius tokens (owner 17:07,
 * Q10b), keep serif line boxes open (B15) and offer a quiet retry in place.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { layout } from '../../../theme/tokens';
import NotificationCenterScreen from '../../notifications/NotificationCenterScreen';
import { fetchNotifications, fetchUnreadCount } from '../../../services/notificationsApi';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/pushTapRouter', () => ({ routeInAppNotification: jest.fn(() => false) }));
jest.mock('../../../services/notificationsApi', () => ({
  fetchNotifications: jest.fn(), fetchUnreadCount: jest.fn(async () => 0),
  markNotificationRead: jest.fn(async () => undefined), markAllNotificationsRead: jest.fn(async () => undefined),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));

const SRC = path.resolve(__dirname, '../..');
const FILES = [
  'notifications/NotificationCenterScreen.tsx', 'TrustCenterScreen.tsx', 'settings/BlockedUsersScreen.tsx', 'settings/DataExportScreen.tsx',
  'settings/DeleteAccountScreen.tsx',
];

describe.each(FILES)('%s', (file) => {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  it('takes insets from the shared wrapper, radii from tokens, and no TouchableOpacity', () => {
    expect(code).not.toMatch(/SafeAreaView[^;]*from 'react-native'/);
    expect(code).not.toMatch(/paddingTop:\s*(5\d|6\d|80)\b/);
    expect(code).not.toMatch(/borderRadius:\s*\d/);
    expect(code).not.toMatch(/TouchableOpacity/);
  });
  it('gives every literal serif size a line box of at least 1.2 x', () => {
    for (const m of code.matchAll(/CormorantGaramond_\w+['"],\s*fontSize:\s*(\d+)(,\s*lineHeight:\s*(\d+))?/g)) {
      expect(m[3]).toBeDefined();
      expect(Number(m[3])).toBeGreaterThanOrEqual(1.2 * Number(m[1]));
    }
  });
});

const insets = (top: number) => ({ top, bottom: 34, left: 0, right: 0 });

describe('Notifications on the shared Screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([[360, 800, 24], [390, 844, 47]])('%ix%i: content starts under the status bar', async (_w, _h, top) => {
    (fetchNotifications as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    const ui = await render(
      <SafeAreaInsetsContext.Provider value={insets(top)}><NotificationCenterScreen /></SafeAreaInsetsContext.Provider>,
    );
    await waitFor(() => expect(ui.getByText('No notifications.')).toBeTruthy());
    expect(StyleSheet.flatten(ui.getByTestId('notification-center').props.style).paddingTop)
      .toBe(top + layout.statusBarGap);
    const title = StyleSheet.flatten(ui.getByRole('header', { name: 'Notifications' }).props.style);
    expect(title.fontFamily).toMatch(/^CormorantGaramond/);
    expect(title.lineHeight).toBeGreaterThanOrEqual(1.2 * title.fontSize);
    expect(ui.getByText('Nothing unread')).toBeTruthy();
  });

  it('a failed first load says so and Try again loads again, with no pull gesture needed', async () => {
    (fetchNotifications as jest.Mock).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [{ id: 'a', kind: 'coach', title: 'Coach note', body: 'Body', read: false,
        createdAt: new Date().toISOString() }], nextCursor: null });
    (fetchUnreadCount as jest.Mock).mockResolvedValue(1);
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText(/Could not load notifications/)).toBeTruthy());
    expect(ui.queryByText(/Pull down/)).toBeNull();
    await fireEvent.press(ui.getByTestId('notification-retry'));
    await waitFor(() => expect(ui.getByText('Coach note')).toBeTruthy());
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
    expect(ui.getByText('1 unread notification')).toBeTruthy();
  });

  it('a failed next page keeps the rows and retries that page in place', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValueOnce({ items: [{ id: 'a', kind: 'system', title: 'Update',
      body: 'Body', read: true, createdAt: new Date().toISOString() }], nextCursor: 'p2' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText('Update')).toBeTruthy());
    await fireEvent(ui.getByTestId('notification-list'), 'endReached');
    await waitFor(() => expect(ui.getByTestId('notification-more-retry')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('notification-more-retry'));
    await waitFor(() => expect(fetchNotifications).toHaveBeenLastCalledWith('p2', 25));
    expect(ui.getByText('Update')).toBeTruthy();
  });
});
