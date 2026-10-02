/**
 * R2b refusals on every client-side AI surface (backend #626):
 *   - Roman chat (POST /roman/sessions/:id/messages; HTTP and in-stream)
 *   - AI Guide (POST /ai/chat)
 *   - ClientWearableInsightPanel (GET /v1/wearables/insights/client)
 *
 * 403 ai_consent_required -> "AI help is off" + "Allow AI help" (opens the
 * box 2 consent choice) + "your coach still sees your training information".
 * 503 ai_egress_blocked -> "paused on our side" + support + reference. Never
 * "sign in again", never "Something went wrong" alone.
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
import { ClientWearableInsightPanel } from '../screens/client/wearables/ClientWearableInsightPanel';

function httpError(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers },
    config: { headers: {} },
  });
}
const CLIENT_MESSAGE = "You haven't allowed AI help yet. You can turn it on in Settings > Privacy.";
const consentError = () => httpError(403, { statusCode: 403, code: 'ai_consent_required', message: CLIENT_MESSAGE });
const egressError = () =>
  httpError(503, { statusCode: 503, code: 'ai_egress_blocked', message: 'server message' }, { 'x-request-id': 'guide-ref-5678' });

beforeEach(() => {
  mockChat.mockReset();
  mockSaveChatMessage.mockClear();
  mockUseRomanChat.mockReset();
  mockUseClientInsight.mockReset();
});

function romanState(sendError: unknown, surface: 'client' | 'coach' = 'client') {
  return {
    phase: 'ready',
    session: { id: 's1', surface },
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

describe('RomanChatScreen — R2b refusals', () => {
  it('client consent_required: AI help is off, Allow AI help, no generic send-failed row', async () => {
    mockUseRomanChat.mockReturnValue(
      romanState({ kind: 'aiRefused', message: CLIENT_MESSAGE, refusal: { kind: 'consent_required' } }),
    );
    const r = await render(<RomanChatScreen surface="client" />);
    expect(r.getByTestId('roman-ai-refusal-title').props.children).toBe('AI help is off');
    expect(r.getByTestId('roman-ai-refusal-body').props.children).toContain('Your coach still sees your training information');
    expect(r.getByTestId('roman-ai-refusal-allow')).toBeTruthy();
    expect(r.queryByTestId('roman-send-error')).toBeNull();
  });

  it('coach surface consent_required: coach copy, no grant action', async () => {
    mockUseRomanChat.mockReturnValue(
      romanState({ kind: 'aiRefused', message: 'x', refusal: { kind: 'consent_required' } }, 'coach'),
    );
    const r = await render(<RomanChatScreen surface="coach" />);
    expect(r.getByTestId('roman-ai-refusal-title').props.children).toBe('This client has not allowed AI help');
    expect(r.queryByTestId('roman-ai-refusal-allow')).toBeNull();
  });

  it('egress_blocked (in-stream or HTTP): paused on our side with the reference', async () => {
    mockUseRomanChat.mockReturnValue(
      romanState({
        kind: 'aiRefused',
        message: 'x',
        refusal: { kind: 'egress_blocked', reference: 'sse-ref-0042abcd', serverMessage: 'x' },
      }),
    );
    const r = await render(<RomanChatScreen surface="client" />);
    expect(r.getByTestId('roman-ai-refusal-title').props.children).toBe('AI help is paused on our side');
    expect(r.getByTestId('roman-ai-refusal-reference').props.children).toBe('Reference: sse-ref-');
    expect(r.queryByTestId('roman-send-error')).toBeNull();
  });
});

describe('AIGuideScreen — R2b refusals', () => {
  async function send(text: string) {
    const r = await render(<AIGuideScreen />);
    await fireEvent.changeText(r.getByPlaceholderText('Ask me anything...'), text);
    await fireEvent.press(r.getByLabelText('Send message'));
    return r;
  }

  it('403 ai_consent_required: notice with Allow AI help; the turn is not kept and the draft returns', async () => {
    mockChat.mockRejectedValueOnce(consentError());
    const r = await send('What should I eat after training');
    await waitFor(() => expect(r.getByTestId('ai-guide-refusal')).toBeTruthy());
    expect(r.getByTestId('ai-guide-refusal-title').props.children).toBe('AI help is off');
    expect(r.getByTestId('ai-guide-refusal-allow')).toBeTruthy();
    expect(r.getByPlaceholderText('Ask me anything...').props.value).toBe('What should I eat after training');
    expect(mockSaveChatMessage).not.toHaveBeenCalled();
    expect(r.queryByText(CLIENT_MESSAGE)).toBeNull();
  });

  it('503 ai_egress_blocked: paused on our side, reference from X-Request-ID', async () => {
    mockChat.mockRejectedValueOnce(egressError());
    const r = await send('Hello');
    await waitFor(() => expect(r.getByTestId('ai-guide-refusal-title').props.children).toBe('AI help is paused on our side'));
    expect(r.getByTestId('ai-guide-refusal-reference').props.children).toBe('Reference: guide-re');
    expect(mockSaveChatMessage).not.toHaveBeenCalled();
  });

  it('an unknown 500 says what happened, the next step and a reference (never "Something went wrong" alone)', async () => {
    mockChat.mockRejectedValueOnce(httpError(500, { message: 'boom' }, { 'x-request-id': 'unk-ref-123456' }));
    const r = await send('Hello');
    await waitFor(() =>
      expect(r.getByText(/Guidance could not answer this time because of a problem on our side/)).toBeTruthy(),
    );
    expect(r.getByText(/share reference unk-ref-/)).toBeTruthy();
    expect(r.queryByTestId('ai-guide-refusal')).toBeNull();
  });
});

describe('ClientWearableInsightPanel — R2b refusals', () => {
  function queryError(error: unknown) {
    return { data: undefined, isLoading: false, isError: true, error, refetch: jest.fn(), isRefetching: false };
  }

  it('403 ai_consent_required: AI help is off + Allow AI help, never "sign in again"', async () => {
    mockUseClientInsight.mockReturnValue(queryError(consentError()));
    const r = await render(<ClientWearableInsightPanel bucket="SLEEP_RECOVERY" />);
    expect(r.getByTestId('client-insight-refused')).toBeTruthy();
    expect(r.getByTestId('client-insight-ai-refusal-allow')).toBeTruthy();
    expect(r.queryByText(/sign in again/i)).toBeNull();
  });

  it('503 ai_egress_blocked: support path', async () => {
    mockUseClientInsight.mockReturnValue(queryError(egressError()));
    const r = await render(<ClientWearableInsightPanel bucket="HEALTH_FITNESS" />);
    expect(r.getByTestId('client-insight-ai-refusal-title').props.children).toBe('AI help is paused on our side');
  });

  it('a plain 503 (not the AI code) keeps the existing error state', async () => {
    mockUseClientInsight.mockReturnValue(queryError(httpError(503, { message: 'Service Unavailable' })));
    const r = await render(<ClientWearableInsightPanel bucket="HEALTH_FITNESS" />);
    expect(r.queryByTestId('client-insight-refused')).toBeNull();
    expect(r.getByTestId('client-insight-error')).toBeTruthy();
  });
});
