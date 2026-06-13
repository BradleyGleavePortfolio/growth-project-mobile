/**
 * Apple 1.2 / Audit #3 P1-A & P1-B integration coverage for the coach DM thread.
 *
 * Three end-to-end behaviours that the unit tests on messagesApi and the
 * report sheet cannot prove on their own:
 *
 *   1. Long-press a message → open the report sheet → submit → assert the
 *      real `api.post('/messages/report', { messageId, reason, details })`
 *      fires. We mock the underlying API client (NOT the moderation helper)
 *      so this proves the full wire path: screen → messagesModerationApi →
 *      api.post. Mocking the helper here would hide a regression where the
 *      helper stops POSTing the right body, exactly the kind of thing the
 *      audit flagged as "helper-boundary mocking".
 *
 *   2. GET /users/blocks returns user X as blocked → the screen must NEVER
 *      render messages whose sender_id is X. Critical correctness property:
 *      we assert the blocked body is absent at every observation point,
 *      including before hydration kicks in. The DM screen gates its message
 *      list render on `serverHydrationComplete`, so the only thing visible
 *      until the server block-list resolves is the loading indicator.
 *
 *   3. The server-provided `blockedAt` flows through `addFromServer` without
 *      being overwritten by `new Date().toISOString()`.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ClientMessagesScreen from '../ClientMessagesScreen';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import api from '../../../services/api';

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

const mockMessagesByClient: Record<string, Array<Record<string, unknown>>> = {};
const mockGetClientMessages = jest.fn(async (clientId: string) => ({
  data: { messages: mockMessagesByClient[clientId] ?? [] },
}));
const mockMarkClientThreadRead = jest.fn(async (..._args: unknown[]) => ({ data: {} }));
const mockSendClientMessage = jest.fn(async (_id: string, body: string) => ({
  data: { id: 'srv-new', sender_role: 'coach', body, created_at: new Date().toISOString() },
}));

jest.mock('../../../services/api', () => {
  const stub = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
  };
  return {
    __esModule: true,
    default: stub,
    coachApi: {
      getClientMessages: (...args: unknown[]) => mockGetClientMessages(...(args as [string])),
      markClientThreadRead: (...args: unknown[]) => mockMarkClientThreadRead(...args),
      sendClientMessage: (...args: unknown[]) =>
        mockSendClientMessage(...(args as [string, string])),
    },
  };
});

// NOTE: we deliberately do NOT mock messagesModerationApi here. The whole
// point of the P1-B audit fix is to prove the full call chain
//   screen → messagesModerationApi.report() → api.post('/messages/report', …)
// reaches the underlying HTTP layer. Mocking `report` itself would short-
// circuit exactly the wire we are trying to verify. `api` (default export
// from services/api) IS mocked above with jest.fn() methods, so the real
// messagesModerationApi will call our stub.

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
    // synchronously on mount and return the cleanup the screen provides.
    useFocusEffect: (cb: () => () => void) => {
      const React = require('react');
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => cb(), [cb]);
    },
  };
});

const postMock = api.post as unknown as jest.Mock;
const getMock = api.get as unknown as jest.Mock;
const deleteMock = api.delete as unknown as jest.Mock;

beforeEach(async () => {
  Object.keys(mockMessagesByClient).forEach((k) => delete mockMessagesByClient[k]);
  mockGetClientMessages.mockClear();
  mockMarkClientThreadRead.mockClear();
  mockSendClientMessage.mockClear();
  postMock.mockReset();
  getMock.mockReset();
  deleteMock.mockReset();
  mockGoBack.mockReset();
  mockNavigate.mockReset();
  // Default for api.get: GET /users/blocks returns no blocks. Tests that need
  // a populated list override this with mockResolvedValueOnce.
  getMock.mockResolvedValue({ data: { blocked: [] } });
  await useBlockedUsersStore.getState().reset();
});

describe('ClientMessagesScreen — full-screen report integration (P1-B)', () => {
  it('long-press → open report sheet → submit calls POST /messages/report with the full body', async () => {
    mockMessagesByClient['client-1'] = [
      {
        id: 'msg-123',
        sender_role: 'client',
        sender_id: 'client-1',
        body: 'sketchy link here',
        created_at: '2026-05-22T10:00:00Z',
      },
    ];
    // POST /messages/report resolves with a fake report id.
    postMock.mockResolvedValue({ data: { ok: true, report_id: 'rep-1' } });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { findByLabelText, getByLabelText, getByText } = await render(<ClientMessagesScreen />);

    // Long-press the bubble — MessageBubble exposes
    // accessibilityLabel="Message: <body>. Long press for actions."
    const bubble = await findByLabelText(/Message: sketchy link here/);
    await fireEvent(bubble, 'longPress');

    // Action sheet (Android Modal) appears; tap Report Message.
    const reportRow = await waitFor(() => getByLabelText('Report Message'));
    await fireEvent.press(reportRow);

    // Report sheet appears; pick the Spam reason.
    const spamOption = await waitFor(() => getByLabelText('Spam'));
    await fireEvent.press(spamOption);

    // Submit.
    await fireEvent.press(getByLabelText('Submit report'));

    // The full chain reached the HTTP layer. This is the assertion the audit
    // demanded: the underlying api.post must have been called with the exact
    // path and body — proving screen → messagesModerationApi.report() →
    // api.post('/messages/report', …) all wire together.
    await waitFor(() => {
      const reportCall = postMock.mock.calls.find(
        ([url]) => url === '/messages/report',
      );
      expect(reportCall).toBeTruthy();
    });
    const reportCall = postMock.mock.calls.find(
      ([url]) => url === '/messages/report',
    );
    expect(reportCall?.[1]).toEqual({
      messageId: 'msg-123',
      reason: 'spam',
      details: undefined,
    });

    // The screen surfaces a confirmation Alert only after the API resolves.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Reported',
        expect.stringContaining('review'),
      );
    });

    alertSpy.mockRestore();
    // sanity: getByText still works after the sheet closed.
    expect(getByText('Alice Smith')).toBeTruthy();
  });
});

describe('ClientMessagesScreen — server block hydration filters the DM list (P1-A)', () => {
  it('NEVER renders messages from a sender returned by GET /users/blocks (no flash before hydration)', async () => {
    // Server reports client-1 as blocked. The hook should merge that into
    // the store, and filterOutBlocked must drop the matching messages.
    //
    // Critically, the screen gates the message list on
    // `serverHydrationComplete`, so the blocked body must never appear at
    // ANY observation point — not just "eventually absent".
    // v14 (react 19 + RNTL 14): `render` is async and flushes the initial
    // effects + their resolved microtasks before it returns, so an immediately
    // resolved GET /users/blocks would already have hydrated by the time render
    // resolves - collapsing the "before hydration" observation window the audit
    // requires. To keep that window observable we HOLD the blocks response open
    // on a manual gate: while it is pending the screen sits behind its
    // `serverHydrationComplete` gate (loading indicator only), so we can assert
    // NOTHING from the message payload has rendered. We then release the gate
    // and assert the post-hydration state. This proves the production no-flash
    // guarantee (the list never renders until block hydration resolves) rather
    // than merely that the blocked body is eventually absent.
    let releaseBlocks: () => void = () => {};
    const blocksGate = new Promise<void>((resolve) => {
      releaseBlocks = resolve;
    });
    getMock.mockImplementation(async (url: string) => {
      if (url === '/users/blocks') {
        await blocksGate;
        return {
          data: {
            blocked: [
              {
                blockedId: 'client-1',
                displayName: 'Alice Smith',
                blockedAt: '2026-05-01T00:00:00Z',
              },
            ],
          },
        };
      }
      return { data: {} };
    });
    mockMessagesByClient['client-1'] = [
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

    const { queryByText, findByText } = await render(<ClientMessagesScreen />);

    // Before server hydration completes (GET /users/blocks still gated), the
    // screen renders ONLY the loading indicator — assert NOTHING from the
    // message payload is present, blocked or not. This is the audit's "never
    // rendered, not just eventually absent" requirement: the list is gated on
    // `serverHydrationComplete`, so even the unblocked body must be withheld
    // until the block list resolves (no flash window for a cross-device block).
    expect(queryByText('should-be-filtered')).toBeNull();
    expect(queryByText('should-stay-visible')).toBeNull();

    // Release the blocks response so hydration completes, then the unblocked
    // message renders.
    releaseBlocks();
    await findByText('should-stay-visible');

    // And the blocked sender's message is still absent.
    expect(queryByText('should-be-filtered')).toBeNull();

    // Hydration store state reflects the block.
    await waitFor(() => {
      expect(useBlockedUsersStore.getState().isBlocked('client-1')).toBe(true);
    });

    // Final assertion: the blocked body never became visible.
    expect(queryByText('should-be-filtered')).toBeNull();
  });

  it('preserves the server-provided blockedAt (does not stamp new Date())', async () => {
    const serverIso = '2025-12-01T12:34:56.000Z';
    getMock.mockImplementation(async (url: string) => {
      if (url === '/users/blocks') {
        return {
          data: {
            blocked: [
              { blockedId: 'client-1', displayName: 'Alice Smith', blockedAt: serverIso },
            ],
          },
        };
      }
      return { data: {} };
    });
    mockMessagesByClient['client-1'] = [];

    await render(<ClientMessagesScreen />);

    await waitFor(() => {
      expect(useBlockedUsersStore.getState().isBlocked('client-1')).toBe(true);
    });
    const row = useBlockedUsersStore
      .getState()
      .blocked.find((b) => b.id === 'client-1');
    expect(row?.blockedAt).toBe(serverIso);
  });
});
