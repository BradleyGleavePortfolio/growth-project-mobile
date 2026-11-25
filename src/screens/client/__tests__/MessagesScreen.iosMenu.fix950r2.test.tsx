/**
 * FIX-950R2 (agent 202, LS-950R2 B1): the client's direct-message thread on iOS keeps its same-chat
 * menu (the shared MessageActionSheet through ActionSheetIOS on the legacy thread: Copy and Report,
 * no Reply), and an iOS menu left open when the thread unmounts or the sign-in changes is dismissed
 * and its old Copy and Report run nothing. Mocks as MessagesScreenStyleB.test.tsx, messaging v2 off.
 */
import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import api from '../../../services/api';
import * as Clipboard from 'expo-clipboard';

jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  tokens: jest.requireActual('../../../theme/tokens').default,
}) }));
jest.mock('../../../storage/mmkv', () => {
  const data = new Map<string, string>();
  const store = { data, getString: () => undefined, getStringAsync: async (k: string) => data.get(k), set: async (k: string, v: string) => { data.set(k, v); }, delete: async (k: string) => { data.delete(k); } };
  return { prefsStorage: store, cacheStorage: store };
});
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => ({ id: 'client-1' }) }));
const mockList = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  messagesApi: {
    list: (...a: unknown[]) => mockList(...a),
    coachReview: jest.fn(async () => ({ data: { coachReviewedAt: null } })),
    send: jest.fn(),
    markRead: jest.fn(async () => ({ data: {} })),
  },
  profileApi: { get: async () => ({ data: { coach_id: 'coach-9', coach_name: 'Coach Nine' } }) },
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: false } }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({ useBlockedUsersHydration: () => ({ serverHydrationComplete: true }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ key: 'messages', name: 'Messages', params: undefined }),
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import MessagesScreen from '../MessagesScreen';

const { authEvents } = require('../../../utils/authEvents');
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const originalOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS }));

type Shown = { options: string[]; choose: (index: number) => void };
let shown: Shown[];
let dismiss: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  shown = [];
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    shown.push({ options: o.options as string[], choose: cb });
  });
  dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockList.mockResolvedValue({ data: [
    { id: 'm1', coach_id: 'coach-9', client_id: 'client-1', sender_id: 'coach-9', sender_role: 'coach', body: 'from the coach', created_at: recent },
  ] });
  getMock.mockImplementation(async () => ({ data: {} }));
  postMock.mockResolvedValue({ data: { ok: true, report_id: 'rep-1' } });
});
afterEach(() => jest.restoreAllMocks());

type R = Awaited<ReturnType<typeof render>>;
const hold = async (r: R) => {
  await fireEvent(await r.findByLabelText(/Message: from the coach/), 'longPress');
  await waitFor(() => expect(shown).toHaveLength(1));
  return shown[0];
};
const choose = async (menu: Shown, label: string) => {
  expect(menu.options).toContain(label);
  await act(async () => { menu.choose(menu.options.indexOf(label)); });
};

describe('FIX-950R2 client DM thread, iOS native menu, same chat (positive controls)', () => {
  it('shows Copy and Report Message (no Reply on the legacy thread); Copy copies the held message', async () => {
    const r = await render(<MessagesScreen />);
    const menu = await hold(r);
    expect(menu.options).toEqual(['Copy', 'Report Message', 'Cancel']);
    await choose(menu, 'Copy');
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('from the coach'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('Report Message opens the report sheet for the held message and files it', async () => {
    const r = await render(<MessagesScreen />);
    await choose(await hold(r), 'Report Message');
    await fireEvent.press(await waitFor(() => r.getByLabelText('Spam')));
    await fireEvent.press(r.getByLabelText('Submit report'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/messages/report', { messageId: 'm1', reason: 'spam', details: undefined }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.'));
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe.each([
  ['the thread unmounts', async (r: R) => { await r.unmount(); }],
  ['sign-out or session expiry', async () => { await act(async () => { authEvents.emit('logout'); }); }],
] as const)('FIX-950R2 client DM thread, iOS: %s with the menu open', (_name, end) => {
  it.each(['Copy', 'Report Message'])('dismisses the menu; its old %s runs nothing', async (label) => {
    const r = await render(<MessagesScreen />);
    const menu = await hold(r);
    await end(r);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await choose(menu, label);
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    expect(r.queryByLabelText('Submit report')).toBeNull();
  });
});
