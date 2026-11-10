/**
 * FIX-950R3 (operator ruling, LS-950R3 B1): a Roman reply the server marked with safety actions has
 * no Reply in the hold menu, on either platform. Copy, Report Message and every other reply are unchanged.
 * The marker is the only signal: the words of the reply are never read for it.
 */
import React from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    getAllKeys: async () => [],
  },
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockUseRomanChat = jest.fn();
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', firstName: 'Maya' }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };

const TEXT = 'Keep Thursday easy and save the hills for Saturday, when your legs are fresh and the weather is better.';
const reply = (id: string, marked: boolean): RomanMessage => ({
  id, role: 'assistant', content: TEXT, interrupted: false, createdAt: '2026-11-06T10:00:05Z',
  ...(marked ? { safetyActions: ['call_988', 'text_988'] as RomanMessage['safetyActions'] } : {}),
});

const LOCAL = 'assistant-1730887205000';
const THE_FOUR = ['Reply', 'Copy', 'Report Message', 'Cancel'];
const MENUS: Array<[string, string, boolean, string[]]> = [
  ['marked, loaded from history', 'r-1', true, ['Copy', 'Report Message', 'Cancel']],
  ['marked, a fresh stand-in with its server id', 'b7e1c2a4', true, ['Copy', 'Report Message', 'Cancel']],
  ['marked, a fresh stand-in with no server id', LOCAL, true, ['Copy', 'Cancel']],
  ['not marked, loaded from history', 'r-1', false, THE_FOUR],
  ['not marked, a fresh stand-in with its server id', 'b7e1c2a4', false, THE_FOUR],
  ['not marked, a fresh stand-in with no server id', LOCAL, false, ['Reply', 'Copy', 'Cancel']],
];

const GESTURES: Array<[string, (node: unknown) => void]> = [
  ['the long press', (n) => fireEvent(n as never, 'longPress')],
  ['the screen reader\'s long-press action', (n) => fireEvent(n as never, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } })],
];

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
afterAll(() => setOS(realOS));

type Shown = { options: string[]; title?: string; cancelButtonIndex?: number; destructiveButtonIndex?: number; choose: (i: number) => void };
let shown: Shown[];
let state: UseRomanChatResult;
beforeEach(() => {
  shown = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    shown.push({ ...(o as Omit<Shown, 'choose'>), choose: cb });
  });
  jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => undefined);
  Clipboard.setStringAsync.mockClear();
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: [],
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

const openHeld = async (id: string, marked: boolean, gesture: (n: unknown) => void = GESTURES[0][1]) => {
  state.messages = [reply(id, marked)];
  const r = await render(<RomanChatScreen surface="client" />);
  await act(async () => { gesture(r.getByTestId(`roman-message-${id}-reply`)); });
  return r;
};

describe.each(GESTURES)('FIX-950R3 Android, by %s', (_g, gesture) => {
  beforeAll(() => setOS('android'));

  it.each(MENUS)('%s', async (_n, id, marked, rows) => {
    const r = await openHeld(id, marked, gesture);
    for (const label of ['Reply', 'Copy', 'Report Message']) {
      expect(!!r.queryByLabelText(label)).toBe(rows.includes(label));
    }
    expect(r.getByText('Cancel')).toBeTruthy();
    expect(r.getByText(TEXT)).toBeTruthy();
  });
});

describe.each(GESTURES)('FIX-950R3 iOS native menu, by %s', (_g, gesture) => {
  beforeAll(() => setOS('ios'));

  it.each(MENUS)('%s', async (_n, id, marked, rows) => {
    await openHeld(id, marked, gesture);
    expect(shown).toHaveLength(1);
    expect(shown[0].options).toEqual(rows);
    expect(shown[0].cancelButtonIndex).toBe(rows.indexOf('Cancel'));
    expect(shown[0].destructiveButtonIndex).toBe(rows.includes('Report Message') ? rows.indexOf('Report Message') : undefined);
    expect(shown[0].title?.startsWith('Keep Thursday easy')).toBe(true);
    expect(shown[0].title?.length).toBeLessThanOrEqual(80);
  });
});

describe('FIX-950R3: Copy and Report Message on a marked reply work as before', () => {
  it('Android: Copy copies the reply', async () => {
    setOS('android');
    const r = await openHeld('r-1', true);
    await act(async () => { fireEvent.press(r.getByLabelText('Copy')); });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TEXT);
  });

  it('Android: Report Message opens the report sheet', async () => {
    setOS('android');
    const r = await openHeld('r-1', true);
    await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
    expect(r.getByLabelText('Submit report')).toBeTruthy();
  });

  it('iOS: Copy copies the reply', async () => {
    setOS('ios');
    await openHeld('r-1', true);
    await act(async () => { shown[0].choose(shown[0].options.indexOf('Copy')); });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TEXT);
  });

  it('iOS: Report Message opens the report sheet', async () => {
    setOS('ios');
    const r = await openHeld('r-1', true);
    await act(async () => { shown[0].choose(shown[0].options.indexOf('Report Message')); });
    expect(r.getByLabelText('Submit report')).toBeTruthy();
  });

  it('typing after the menu goes without a quote', async () => {
    setOS('android');
    const r = await openHeld('r-1', true);
    await act(async () => { fireEvent.press(r.getByText('Cancel')); });
    await fireEvent.changeText(r.getByTestId('roman-composer-input'), 'Thanks for that.');
    await act(async () => { fireEvent.press(r.getByTestId('roman-composer-send')); });
    expect(state.send).toHaveBeenCalledWith('Thanks for that.');
  });
});
