/**
 * AUDIT-05-125 U1: the coach's monthly AI credit pool is used up.
 *
 * Backend B-668-1 answers a Roman send with 402 COACH_AI_BUDGET_EXHAUSTED
 * (before the turn is stored), or the same code in the in-stream error frame.
 * On main the app read both as a generic failure: "That request did not
 * complete. Send it once more, and I will try again." with a Send again button
 * that can never succeed. Now the send maps to kind `poolEmpty`, and the chat
 * shows the pool copy for the right audience with no retry button.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { RomanApiError, sendMessage } from '../api/romanApi';
import RomanChatScreen from '../screens/roman/RomanChatScreen';
import { romanPoolEmpty } from '../components/roman/romanVoice';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('react-native-reanimated', () => {
  const View = jest.requireActual('react-native').View;
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
    withRepeat: (v: number) => v,
    withDelay: (_d: number, v: number) => v,
    withSequence: (...v: number[]) => v[0],
  };
});

jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors }) };
});

jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', role: 'client', firstName: 'Jane' }),
}));

const mockUseRomanChat = jest.fn();
jest.mock('../screens/roman/useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const POOL_BODY = {
  statusCode: 402,
  code: 'COACH_AI_BUDGET_EXHAUSTED',
  message: "Your coach's AI credits for this month are used up, so Roman cannot answer right now.",
};

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  mockUseRomanChat.mockReset();
});

function mockFetchOnce(init: { ok: boolean; status: number; text: string }) {
  const response: Pick<Response, 'ok' | 'status' | 'headers' | 'text'> = {
    ok: init.ok,
    status: init.status,
    headers: { get: () => null } as Headers,
    text: async () => init.text,
  };
  global.fetch = jest.fn(async () => response as Response);
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('romanApi.sendMessage: coach AI credit pool used up', () => {
  it('402 COACH_AI_BUDGET_EXHAUSTED -> poolEmpty, turn not stored', async () => {
    mockFetchOnce({ ok: false, status: 402, text: JSON.stringify(POOL_BODY) });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toBeInstanceOf(RomanApiError);
    expect(err).toMatchObject({ kind: 'poolEmpty', turnStored: false });
  });

  it('the same code in the stream error frame -> poolEmpty, turn stored', async () => {
    const frame = `event: error\ndata: ${JSON.stringify({ code: POOL_BODY.code, message: POOL_BODY.message })}\n\n`;
    mockFetchOnce({ ok: true, status: 200, text: frame });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toMatchObject({ kind: 'poolEmpty', turnStored: true });
  });

  it('a 402 without the machine code stays generic', async () => {
    mockFetchOnce({ ok: false, status: 402, text: JSON.stringify({ message: 'Payment required' }) });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({ kind: 'generic' });
  });
});

function romanState(sendError: unknown) {
  return {
    phase: 'ready',
    session: { id: 's1', surface: 'client' },
    isFirstOpen: false,
    messages: [],
    sending: false,
    sendError,
    nextCursor: null,
    loadingOlder: false,
    reload: jest.fn(),
    loadOlder: jest.fn(),
    send: jest.fn(async () => 'send-failed'),
    clearSendError: jest.fn(),
  };
}

describe('RomanChatScreen: coach AI credit pool used up', () => {
  it.each(['client', 'coach'] as const)('%s surface: pool copy, no Send again', async (surface) => {
    mockUseRomanChat.mockReturnValue(romanState({ kind: 'poolEmpty', message: 'x' }));
    const r = await render(<RomanChatScreen surface={surface} />);
    expect(r.getByText(romanPoolEmpty(surface))).toBeTruthy();
    expect(r.queryByTestId('roman-send-retry')).toBeNull();
    expect(r.queryByText(/did not complete/)).toBeNull();
    expect(r.getByTestId('roman-composer')).toBeTruthy();
  });

  it('client copy never shows credit figures; coach copy names no purchase step', () => {
    expect(romanPoolEmpty('client')).not.toMatch(/\d/);
    expect(romanPoolEmpty('coach')).not.toMatch(/pack|buy|purchase/i);
    for (const a of ['client', 'coach'] as const) {
      expect(romanPoolEmpty(a)).not.toMatch(/[!]|\bI\b/);
    }
  });
});
