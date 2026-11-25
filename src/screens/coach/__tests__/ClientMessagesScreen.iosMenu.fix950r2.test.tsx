/**
 * FIX-950R2 (agent 202, LS-950R2 B1): the coach's direct-message thread on iOS keeps its same-chat
 * menu (the shared MessageActionSheet through ActionSheetIOS, legacy thread: Copy and Report, no
 * Reply), and an iOS menu left open when the thread unmounts or the sign-in changes is dismissed
 * and its old Copy and Report run nothing. Harness as ClientMessagesScreen.integration.test.tsx.
 */
import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import ClientMessagesScreen from '../ClientMessagesScreen';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import api from '../../../services/api';

const { authEvents } = require('../../../utils/authEvents');

const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
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
// messaging_core_v2 OFF: the legacy thread (v2 coverage: ClientMessagesScreenV2.test.tsx).
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { messaging_core_v2: false } }),
}));

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
    usePreventRemove: jest.fn(), // rendered outside a navigator
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

type Shown = { options: string[]; choose: (index: number) => void };
let shown: Shown[];
let dismiss: jest.SpyInstance;
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  shown = [];
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    shown.push({ options: o.options as string[], choose: cb });
  });
  dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  mockMessagesByClient['client-1'] = [
    { id: 'msg-123', sender_role: 'client', sender_id: 'client-1', body: 'see you at six', created_at: '2026-05-22T10:00:00Z' },
  ];
});
afterEach(() => {
  dismiss.mockRestore();
  alertSpy.mockRestore();
  (ActionSheetIOS.showActionSheetWithOptions as unknown as jest.SpyInstance).mockRestore();
});

type R = Awaited<ReturnType<typeof render>>;
const hold = async (r: R) => {
  await fireEvent(await r.findByLabelText(/Message: see you at six/), 'longPress');
  await waitFor(() => expect(shown).toHaveLength(1));
  return shown[0];
};
const choose = async (menu: Shown, label: string) => {
  expect(menu.options).toContain(label);
  await act(async () => { menu.choose(menu.options.indexOf(label)); });
};

describe('FIX-950R2 coach DM thread, iOS native menu, same chat (positive controls)', () => {
  it('shows Copy and Report Message (no Reply on the legacy thread); Copy copies the held message', async () => {
    const r = await render(<ClientMessagesScreen />);
    const menu = await hold(r);
    expect(menu.options).toEqual(['Copy', 'Report Message', 'Cancel']);
    await choose(menu, 'Copy');
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('see you at six'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('Report Message opens the report sheet for the held message and files it', async () => {
    postMock.mockResolvedValue({ data: { ok: true, report_id: 'rep-1' } });
    const r = await render(<ClientMessagesScreen />);
    await choose(await hold(r), 'Report Message');
    await fireEvent.press(await waitFor(() => r.getByLabelText('Spam')));
    await fireEvent.press(r.getByLabelText('Submit report'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/messages/report', { messageId: 'msg-123', reason: 'spam', details: undefined }));
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe.each([
  ['the thread unmounts', async (r: R) => { await r.unmount(); }],
  ['sign-out or session expiry', async () => { await act(async () => { authEvents.emit('logout'); }); }],
] as const)('FIX-950R2 coach DM thread, iOS: %s with the menu open', (_name, end) => {
  it.each(['Copy', 'Report Message'])('dismisses the menu; its old %s runs nothing', async (label) => {
    const r = await render(<ClientMessagesScreen />);
    const menu = await hold(r);
    await end(r);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await choose(menu, label);
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    expect(r.queryByLabelText('Submit report')).toBeNull();
  });
});
