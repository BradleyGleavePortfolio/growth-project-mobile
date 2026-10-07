/**
 * BlockedUsersScreen (DES-BB-127): every action stays (back, Retry, Unblock
 * with its confirmation and DELETE /users/:id/block), and the copy is true:
 * the error state has no pull-to-refresh, so it never says "Pull to retry";
 * a failed unblock says what to do next instead of a generic error; a failed
 * refresh over a cached list says the list may be out of date.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../../storage/mmkv', () => {
  const m = new Map<string, string>();
  const prefsStorage = { getString: (k: string) => m.get(k), getStringAsync: async (k: string) => m.get(k) };
  return { prefsStorage: { ...prefsStorage, set: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) } };
});

jest.mock('../../../api/messagesApi', () => ({
  messagesModerationApi: { listBlocked: jest.fn(), unblock: jest.fn() },
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'user-1' }),
}));

jest.mock('../../../theme/ThemeProvider', () => {
  const CanonicalColors = jest.requireActual('../../../constants/colors').default;
  return { useTheme: () => ({ colors: CanonicalColors }) };
});

import BlockedUsersScreen from '../BlockedUsersScreen';
import { messagesModerationApi } from '../../../api/messagesApi';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

const api = messagesModerationApi as jest.Mocked<typeof messagesModerationApi>;
type AlertButtons = Array<{ text?: string; onPress?: () => void | Promise<void> }>;

const ROW = { blockedId: 'b-1', displayName: 'Sam Lee', blockedAt: '2026-10-01T10:00:00.000Z' };

describe('BlockedUsersScreen', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    api.listBlocked.mockReset();
    api.unblock.mockReset();
    await useBlockedUsersStore.getState().reset();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => alertSpy.mockRestore());

  it('lists blocked people; back goes back; Unblock confirms, calls the API and removes the row', async () => {
    api.listBlocked.mockResolvedValue({ blocked: [ROW] });
    api.unblock.mockResolvedValue({ ok: true });
    const screen = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(screen.getByText('Sam Lee')).toBeTruthy());

    expect(screen.getByText('Blocked users')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText('Unblock Sam Lee'));
    const [title, body, buttons] = alertSpy.mock.calls[0] as [string, string, AlertButtons];
    expect(title).toBe('Unblock Sam Lee?');
    expect(body).toBe("They'll be able to message you again.");
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Unblock']);
    await act(async () => {
      await buttons[1].onPress?.();
    });
    expect(api.unblock).toHaveBeenCalledWith('b-1');
    await waitFor(() => expect(screen.queryByText('Sam Lee')).toBeNull());
    expect(screen.getByText('No blocked users')).toBeTruthy();
  });

  it('a failed load with nothing cached offers Retry and never mentions pulling', async () => {
    api.listBlocked.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ blocked: [] });
    const screen = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't load your block list")).toBeTruthy());

    expect(screen.queryByText(/pull/i)).toBeNull();
    expect(
      screen.getByText('The latest block list could not be loaded. Check your connection, then tap Retry.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry loading block list'));
    await waitFor(() => expect(screen.getByText('No blocked users')).toBeTruthy());
    expect(api.listBlocked).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh over a cached list keeps the rows and says the list may be out of date', async () => {
    api.listBlocked.mockResolvedValueOnce({ blocked: [ROW] });
    const first = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(first.getByText('Sam Lee')).toBeTruthy());
    await first.unmount();

    api.listBlocked.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<BlockedUsersScreen />);
    await waitFor(() =>
      expect(
        screen.getByText('This list may be out of date. Check your connection, then tap Retry.'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('Sam Lee')).toBeTruthy();
    expect(screen.getByLabelText('Retry loading block list')).toBeTruthy();
  });

  it('a failed unblock says what to do next, not a generic error', async () => {
    api.listBlocked.mockResolvedValue({ blocked: [ROW] });
    api.unblock.mockRejectedValue(new Error('offline'));
    const screen = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(screen.getByText('Sam Lee')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Unblock Sam Lee'));
    const buttons = alertSpy.mock.calls[0][2] as AlertButtons;
    await act(async () => {
      await buttons[1].onPress?.();
    });
    const [title, body] = alertSpy.mock.calls[1] as [string, string];
    expect(title).toBe('Could not unblock');
    expect(body).toBe('Check your connection, then tap Unblock again.');
    expect(body).not.toMatch(/something went wrong/i);
    expect(screen.getByText('Sam Lee')).toBeTruthy();
  });
});
