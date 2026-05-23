/**
 * Behavior coverage for the ContactView (iMessage-style contact-detail sheet):
 *
 *   - Tapping Block triggers POST /users/:id/block.
 *   - Local state only updates on success.
 *   - When the API throws, local state is NOT updated (no false confirmation).
 *
 * We drive the destructive Alert.alert confirmation by invoking the
 * destructive button handler directly via an Alert.alert spy. This is how
 * the rest of the suite tests destructive Alert flows.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ContactView from '../ContactView';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      border: '#222',
      primary: '#0af',
      primaryDark: '#08c',
      textPrimary: '#fff',
      textSecondary: '#ccc',
      textMuted: '#888',
      textOnPrimary: '#000',
      error: '#f33',
      success: '#3f3',
    },
  }),
  ThemeColors: {},
}));

jest.mock('../../../storage/mmkv', () => {
  const memory = new Map<string, string>();
  return {
    prefsStorage: {
      getString: (k: string) => memory.get(k),
      getStringAsync: async (k: string) => memory.get(k),
      set: async (k: string, v: string | number | boolean) => {
        memory.set(k, String(v));
      },
      delete: async (k: string) => {
        memory.delete(k);
      },
      clearNamespace: async () => {
        memory.clear();
      },
    },
  };
});

const mockBlock = jest.fn();
const mockUnblock = jest.fn();
jest.mock('../../../api/messagesApi', () => ({
  messagesModerationApi: {
    block: (...args: unknown[]) => mockBlock(...args),
    unblock: (...args: unknown[]) => mockUnblock(...args),
  },
}));

jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    heavyImpact: jest.fn(),
    error: jest.fn(),
    selection: jest.fn(),
  },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me', email: 'me@example.com' }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({
    params: { contactId: 'u1', displayName: 'Alice Smith', role: 'coach' as const },
  }),
}));

beforeEach(async () => {
  mockBlock.mockReset();
  mockUnblock.mockReset();
  mockGoBack.mockReset();
  await useBlockedUsersStore.getState().reset();
});

function pressDestructive(label: string, action: () => void) {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const list = (buttons ?? []) as Array<{ text?: string; onPress?: () => void }>;
    const btn = list.find((b) => b.text === label);
    btn?.onPress?.();
  });
  action();
  spy.mockRestore();
}

describe('ContactView — block flow', () => {
  it('calls POST /users/:id/block and updates local state on success', async () => {
    mockBlock.mockResolvedValueOnce({ ok: true });
    const { getByLabelText } = render(<ContactView />);
    await waitFor(() =>
      expect(useBlockedUsersStore.getState().hydrated).toBe(true),
    );

    pressDestructive('Block', () => {
      fireEvent.press(getByLabelText('Block user'));
    });

    await waitFor(() => expect(mockBlock).toHaveBeenCalledWith('u1'));
    await waitFor(() =>
      expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true),
    );
  });

  it('does NOT update local state when the API throws (no false confirmation)', async () => {
    mockBlock.mockRejectedValueOnce(new Error('500'));
    const { getByLabelText } = render(<ContactView />);
    await waitFor(() =>
      expect(useBlockedUsersStore.getState().hydrated).toBe(true),
    );

    pressDestructive('Block', () => {
      fireEvent.press(getByLabelText('Block user'));
    });

    await waitFor(() => expect(mockBlock).toHaveBeenCalled());
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(false);
  });

  it('unblock flow: DELETE /users/:id/block + local state cleared only on success', async () => {
    await useBlockedUsersStore.getState().hydrate('me');
    await useBlockedUsersStore.getState().block({
      id: 'u1',
      displayName: 'Alice Smith',
      role: 'coach',
    });
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true);

    mockUnblock.mockResolvedValueOnce({ ok: true });
    const { getByLabelText } = render(<ContactView />);
    await waitFor(() => getByLabelText('Unblock user'));

    pressDestructive('Unblock', () => {
      fireEvent.press(getByLabelText('Unblock user'));
    });

    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('u1'));
    await waitFor(() =>
      expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(false),
    );
  });

  it('unblock failure: local state stays blocked when API throws', async () => {
    await useBlockedUsersStore.getState().hydrate('me');
    await useBlockedUsersStore.getState().block({
      id: 'u1',
      displayName: 'Alice Smith',
      role: 'coach',
    });

    mockUnblock.mockRejectedValueOnce(new Error('500'));
    const { getByLabelText } = render(<ContactView />);
    await waitFor(() => getByLabelText('Unblock user'));

    pressDestructive('Unblock', () => {
      fireEvent.press(getByLabelText('Unblock user'));
    });

    await waitFor(() => expect(mockUnblock).toHaveBeenCalled());
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true);
  });
});
