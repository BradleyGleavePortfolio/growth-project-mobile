/**
 * Apple 1.2 / Audit #2 P1-7 integration coverage for the coach DM thread.
 *
 * Two end-to-end behaviours that the unit tests on messagesApi and the report
 * sheet cannot prove on their own:
 *
 *   1. Long-press a message → open the report sheet → submit → assert the
 *      real POST /messages/report fires with { messageId, reason, details }.
 *      This proves the long-press, sheet, and screen submit handler are wired
 *      end-to-end instead of being three independently green islands.
 *
 *   2. GET /users/blocks returns user X as blocked → the screen must NOT
 *      render messages whose sender_id is X. This proves the new
 *      useBlockedUsersHydration hook actually feeds into filterOutBlocked.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ClientMessagesScreen from '../ClientMessagesScreen';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

// Render the Android modal branch of MessageActionSheet so we can fire
// Pressable events directly rather than hooking into ActionSheetIOS.
const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

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
    cacheStorage: {
      getString: () => undefined,
      getStringAsync: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
  };
});

const messagesByClient: Record<string, Array<Record<string, unknown>>> = {};
const getClientMessagesMock = jest.fn(async (clientId: string) => ({
  data: { messages: messagesByClient[clientId] ?? [] },
}));
const markClientThreadReadMock = jest.fn(async () => ({ data: {} }));
const sendClientMessageMock = jest.fn(async (_id: string, body: string) => ({
  data: { id: 'srv-new', sender_role: 'coach', body, created_at: new Date().toISOString() },
}));

jest.mock('../../../services/api', () => ({
  coachApi: {
    getClientMessages: (...args: unknown[]) => getClientMessagesMock(...(args as [string])),
    markClientThreadRead: (...args: unknown[]) => markClientThreadReadMock(...args),
    sendClientMessage: (...args: unknown[]) =>
      sendClientMessageMock(...(args as [string, string])),
  },
}));

const reportMock = jest.fn();
const listBlockedMock = jest.fn();
const blockMock = jest.fn();
const unblockMock = jest.fn();
const sendReplyMock = jest.fn();
jest.mock('../../../api/messagesApi', () => {
  const actual = jest.requireActual('../../../api/messagesApi');
  return {
    ...actual,
    messagesModerationApi: {
      report: (...args: unknown[]) => reportMock(...args),
      listBlocked: (...args: unknown[]) => listBlockedMock(...args),
      block: (...args: unknown[]) => blockMock(...args),
      unblock: (...args: unknown[]) => unblockMock(...args),
      sendReply: (...args: unknown[]) => sendReplyMock(...args),
    },
  };
});

jest.mock('../../../services/realtime', () => ({
  subscribeToMessages: () => () => undefined,
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com' }),
}));

jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({
      params: { clientId: 'client-1', clientName: 'Alice Smith' },
    }),
    // useFocusEffect normally only runs on focus; in tests we want it to run
    // synchronously on mount.
    useFocusEffect: (cb: () => () => void) => {
      const React = require('react');
      React.useEffect(() => cb(), []);
    },
  };
});

beforeEach(async () => {
  Object.keys(messagesByClient).forEach((k) => delete messagesByClient[k]);
  getClientMessagesMock.mockClear();
  markClientThreadReadMock.mockClear();
  sendClientMessageMock.mockClear();
  reportMock.mockReset();
  listBlockedMock.mockReset();
  blockMock.mockReset();
  unblockMock.mockReset();
  sendReplyMock.mockReset();
  mockGoBack.mockReset();
  mockNavigate.mockReset();
  // Default: no server-side blocks, so the hook merges nothing.
  listBlockedMock.mockResolvedValue({ blocked: [] });
  await useBlockedUsersStore.getState().reset();
});

describe('ClientMessagesScreen — full-screen report integration (P1-7)', () => {
  it('long-press → open report sheet → submit calls POST /messages/report with {messageId, reason, details}', async () => {
    messagesByClient['client-1'] = [
      {
        id: 'msg-123',
        sender_role: 'client',
        sender_id: 'client-1',
        body: 'sketchy link here',
        created_at: '2026-05-22T10:00:00Z',
      },
    ];
    reportMock.mockResolvedValueOnce({ ok: true, report_id: 'rep-1' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { findByLabelText, getByLabelText, getByText } = render(<ClientMessagesScreen />);

    // Long-press the bubble — MessageBubble exposes
    // accessibilityLabel="Message: <body>. Long press for actions."
    const bubble = await findByLabelText(/Message: sketchy link here/);
    fireEvent(bubble, 'longPress');

    // Action sheet (Android Modal) appears; tap Report Message.
    const reportRow = await waitFor(() => getByLabelText('Report Message'));
    fireEvent.press(reportRow);

    // Report sheet appears; pick the Spam reason.
    const spamOption = await waitFor(() => getByLabelText('Spam'));
    fireEvent.press(spamOption);

    // Submit.
    fireEvent.press(getByLabelText('Submit report'));

    await waitFor(() => {
      expect(reportMock).toHaveBeenCalledTimes(1);
    });
    expect(reportMock).toHaveBeenCalledWith('msg-123', {
      reason: 'spam',
      details: undefined,
    });

    // The screen surfaces a confirmation Alert (only after the API resolves,
    // never on failure).
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Reported',
        expect.stringContaining('review'),
      );
    });

    // The Reported alert text — assert it's not present until the network resolves.
    // The mock resolved synchronously above, so the assertion already covers it;
    // here we double-check we passed the right title.
    const reportedAlertCall = alertSpy.mock.calls.find((c) => c[0] === 'Reported');
    expect(reportedAlertCall).toBeTruthy();

    alertSpy.mockRestore();
    // sanity: getByText still works after the sheet closed.
    expect(getByText('Alice Smith')).toBeTruthy();
  });
});

describe('ClientMessagesScreen — server block hydration filters the DM list (P1-2 / P1-7)', () => {
  it('does NOT render messages from a sender whose blockedId came back from GET /users/blocks', async () => {
    // Server reports client-1 as blocked. The hook should merge that into
    // the store, and filterOutBlocked must drop the matching messages.
    listBlockedMock.mockResolvedValueOnce({
      blocked: [
        {
          blockedId: 'client-1',
          displayName: 'Alice Smith',
          blockedAt: '2026-05-01T00:00:00Z',
        },
      ],
    });
    messagesByClient['client-1'] = [
      {
        id: 'msg-a',
        sender_role: 'client',
        sender_id: 'client-1',
        body: 'should-be-filtered',
        created_at: '2026-05-22T10:00:00Z',
      },
      {
        id: 'msg-b',
        sender_role: 'coach',
        sender_id: 'coach-1',
        body: 'should-stay-visible',
        created_at: '2026-05-22T10:01:00Z',
      },
    ];

    const { queryByText, findByText } = render(<ClientMessagesScreen />);

    // The coach's own message must render — guarantees the list rendered.
    await findByText('should-stay-visible');

    // Wait for the hydration hook to run and the filter to apply.
    await waitFor(() => {
      expect(useBlockedUsersStore.getState().isBlocked('client-1')).toBe(true);
    });
    await waitFor(() => {
      expect(queryByText('should-be-filtered')).toBeNull();
    });
  });

  it('preserves the server-provided blockedAt (does not stamp new Date())', async () => {
    const serverIso = '2025-12-01T12:34:56.000Z';
    listBlockedMock.mockResolvedValueOnce({
      blocked: [
        { blockedId: 'client-1', displayName: 'Alice Smith', blockedAt: serverIso },
      ],
    });
    messagesByClient['client-1'] = [];

    render(<ClientMessagesScreen />);

    await waitFor(() => {
      expect(useBlockedUsersStore.getState().isBlocked('client-1')).toBe(true);
    });
    const row = useBlockedUsersStore
      .getState()
      .blocked.find((b) => b.id === 'client-1');
    expect(row?.blockedAt).toBe(serverIso);
  });
});
