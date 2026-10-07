import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import NotificationsScreen from '../NotificationsScreen';
import { useNudges } from '../../../hooks/useApi';

const mockRead = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useApi', () => ({
  useNudges: jest.fn(),
  useMarkNudgeRead: () => ({ mutate: mockRead }),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { background: 'page', divider: 'hairline', primary: 'forest',
    textPrimary: 'ink', textSecondary: 'secondary', textMuted: 'muted' } }),
}));
const nudges = [
  { id: 'unread', title: 'Coach feedback', body: 'All feedback stays visible.', read_at: null,
    created_at: new Date(Date.now() - 300000).toISOString() },
  { id: 'read', title: 'Earlier note', body: 'Already read.', read_at: 'read',
    created_at: new Date(Date.now() - 7200000).toISOString() },
];
beforeEach(() => {
  jest.clearAllMocks();
  (useNudges as jest.Mock).mockReturnValue({ data: nudges, isLoading: false,
    isError: false, isRefetching: false, refetch: mockRefresh });
});
it('preserves each nudge tap, mark-all and pull-to-refresh', async () => {
  const ui = await render(<NotificationsScreen />);
  await fireEvent.press(ui.getByText('Coach feedback'));
  expect(mockRead).toHaveBeenCalledWith('unread');
  mockRead.mockClear();
  await fireEvent.press(ui.getByText('Earlier note'));
  expect(mockRead).not.toHaveBeenCalled();
  expect(ui.queryByRole('button', { name: 'Earlier note. Already read.' })).toBeNull();
  await fireEvent.press(ui.getByText('Mark all read'));
  expect(mockRead.mock.calls).toEqual([['unread']]);
  await fireEvent(ui.getByTestId('nudge-refresh'), 'refresh');
  expect(mockRefresh).toHaveBeenCalled();
});
it('shows readable unfilled rows and all message text', async () => {
  const ui = await render(<NotificationsScreen />);
  const row = ui.getByRole('button', { name: /Unread. Coach feedback/ });
  expect(StyleSheet.flatten(row.props.style).backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(row.props.style).borderBottomWidth).toBe(StyleSheet.hairlineWidth);
  expect(StyleSheet.flatten(ui.getByText('Coach feedback').props.style).fontSize).toBe(15);
  expect(ui.getByText('All feedback stays visible.').props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(ui.getByText('5m ago').props.style).fontSize).toBe(13);
});
it.each([
  [false, false, 'No notifications.'], [true, false, 'Loading notifications…'],
  [false, true, 'Could not load notifications. Pull down to try again.'],
])('distinguishes empty, loading and failed requests (%s/%s)', async (isLoading, isError, text) => {
  (useNudges as jest.Mock).mockReturnValue({ data: [], isLoading, isError, refetch: mockRefresh });
  const ui = await render(<NotificationsScreen />);
  expect(ui.getByText(text)).toBeTruthy();
  expect(ui.queryByText('Mark all read')).toBeNull();
  expect(ui.queryByText(/reminders will/)).toBeNull();
});
