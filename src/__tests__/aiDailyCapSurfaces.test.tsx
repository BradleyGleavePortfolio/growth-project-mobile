/**
 * Daily AI cap pop-up on every client AI surface (M-ROMANCAP):
 *   - Roman chat (client and coach surface): sendError kind `dailyCap` shows
 *     the pop-up with the owner words and the reset time, no inline error row,
 *     OK clears it, and the composer stays usable (crisis turns are never
 *     capped on the server, so nothing may block sending).
 *   - AI Guide (POST /ai/chat): 429 AI_DAILY_QUOTA_EXCEEDED shows the pop-up,
 *     the draft returns and nothing is saved; never the generic service reply.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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

const mockChat = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  aiApi: {
    chat: (...a: unknown[]) => mockChat(...a),
    getStructuredContext: jest.fn(async () => ({ data: null })),
  },
}));

const mockSaveChatMessage = jest.fn(async () => undefined);
jest.mock('../db/chatDb', () => ({
  getChatHistory: jest.fn(async () => []),
  saveChatMessage: (...a: unknown[]) => mockSaveChatMessage(...(a as [])),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));

jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', role: 'client', firstName: 'Jane' }),
}));

const mockUseRomanChat = jest.fn();
jest.mock('../screens/roman/useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));

const mockUseClientInsight = jest.fn();
jest.mock('../hooks/useWearableInsight', () => ({
  useClientInsight: (args: unknown) => mockUseClientInsight(args),
}));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

import AIGuideScreen from '../screens/client/AIGuideScreen';
import RomanChatScreen from '../screens/roman/RomanChatScreen';
import { AI_DAILY_CAP_TITLE } from '../lib/ai/aiDailyCap';

function httpError(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers },
    config: { headers: {} },
  });
}

beforeEach(() => {
  mockChat.mockReset();
  mockSaveChatMessage.mockClear();
  mockUseRomanChat.mockReset();
});

const RESETS_AT = new Date(Date.now() + 3 * 3600 * 1000);

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

describe('RomanChatScreen — daily AI cap pop-up', () => {
  it.each(['client', 'coach'] as const)('%s surface: owner words + reset time, no inline error, OK clears', async (surface) => {
    const state = romanState({ kind: 'dailyCap', message: 'x', dailyCap: { resetsAt: RESETS_AT } });
    mockUseRomanChat.mockReturnValue(state);
    const r = await render(<RomanChatScreen surface={surface} />);
    expect(r.getByTestId('roman-daily-cap-title').props.children).toBe(AI_DAILY_CAP_TITLE);
    const body = String(r.getByTestId('roman-daily-cap-body').props.children);
    expect(body).toMatch(/^AI help resets (today|tomorrow) at /);
    expect(body).toContain(surface === 'client' ? 'Your coach is in Messages' : 'Your clients, messages');
    expect(r.queryByTestId('roman-send-error')).toBeNull();
    expect(r.queryByText(/not available|did not complete/)).toBeNull();
    await fireEvent.press(r.getByTestId('roman-daily-cap-ok'));
    expect(state.clearSendError).toHaveBeenCalledTimes(1);
    // The composer is not blocked: a later (crisis) message can still be sent.
    expect(r.getByTestId('roman-composer')).toBeTruthy();
  });

  it('no pop-up for other send errors', async () => {
    mockUseRomanChat.mockReturnValue(romanState({ kind: 'rateLimited', message: 'x', retryAfterSeconds: 5 }));
    const r = await render(<RomanChatScreen surface="client" />);
    expect(r.queryByTestId('roman-daily-cap-title')).toBeNull();
    expect(r.getByTestId('roman-send-error')).toBeTruthy();
  });
});

describe('AIGuideScreen — daily AI cap pop-up', () => {
  async function send(text: string) {
    const r = await render(<AIGuideScreen />);
    await fireEvent.changeText(r.getByPlaceholderText('Ask me anything...'), text);
    await fireEvent.press(r.getByLabelText('Send message'));
    return r;
  }

  it('429 AI_DAILY_QUOTA_EXCEEDED: pop-up, draft returns, nothing saved, no generic reply', async () => {
    mockChat.mockRejectedValueOnce(
      httpError(429, { statusCode: 429, error: 'AI_DAILY_QUOTA_EXCEEDED', message: 'x' }),
    );
    const r = await send('Plan for tomorrow');
    await waitFor(() => expect(r.getByTestId('ai-guide-daily-cap-title').props.children).toBe(AI_DAILY_CAP_TITLE));
    expect(String(r.getByTestId('ai-guide-daily-cap-body').props.children)).toMatch(/^AI help resets (today|tomorrow) at /);
    expect(r.getByPlaceholderText('Ask me anything...').props.value).toBe('Plan for tomorrow');
    expect(mockSaveChatMessage).not.toHaveBeenCalled();
    expect(r.queryByText(/Guidance could not answer this time/)).toBeNull();
    await fireEvent.press(r.getByTestId('ai-guide-daily-cap-ok'));
    await waitFor(() => expect(r.queryByTestId('ai-guide-daily-cap-title')).toBeNull());
  });
});
