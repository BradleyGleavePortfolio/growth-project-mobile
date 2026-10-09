/**
 * Owner 2026-10-09 00:0x. No coach: Roman chat, the AI guide and the Community
 * tab show the locked state; "Join a coach" opens the coach-code path
 * (EntitlementProvider.messageCoach). Coached clients and coaches: unchanged.
 * The server's 403 ROMAN_REQUIRES_COACH shows the same locked state.
 */
import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null, Feather: () => null }));
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
jest.mock('../../../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors, semanticColors: lightTokens }) };
});
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const typography = new Proxy({}, { get: () => ({}) });
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens, colors, tokens: { typography } }) };
});
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    goBack: (...a: unknown[]) => mockGoBack(...a),
    navigate: jest.fn(),
    addListener: () => () => undefined,
  }),
}));

const mockChat = jest.fn();
const mockContext = jest.fn(async () => ({ data: null }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  aiApi: {
    chat: (...a: unknown[]) => mockChat(...a),
    getStructuredContext: () => mockContext(),
  },
}));
jest.mock('../../../db/chatDb', () => ({
  getChatHistory: jest.fn(async () => []),
  saveChatMessage: jest.fn(async () => undefined),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));

type MockUser = { id: string; email: string; role: string; coach_id?: string; firstName?: string };
let mockUser: MockUser | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'),
  readUserCacheSync: () => null,
}));

const mockUseRomanChat = jest.fn();
jest.mock('../../../screens/roman/useRomanChat', () => ({
  useRomanChat: (surface: unknown) => mockUseRomanChat(surface),
}));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../ui/skeletons/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));

const mockGetEntitlement = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement(), getPackages: jest.fn() },
}));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));

import RomanChatScreen from '../../../screens/roman/RomanChatScreen';
import AIGuideScreen from '../../../screens/client/AIGuideScreen';
import { EntitlementProvider } from '../../../entitlements/EntitlementProvider';
import { CoachOnlyGate, COMMUNITY_LOCK_BODY, COMMUNITY_LOCK_TITLE, JOIN_A_COACH, ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE } from '../JoinCoachState';

const COACHLESS: MockUser = { id: 'client-1', email: 'c@example.test', role: 'student', firstName: 'Maya' };
const COACHED: MockUser = { ...COACHLESS, coach_id: 'coach-1' };
const COACH: MockUser = { id: 'coach-1', email: 'k@example.test', role: 'coach', firstName: 'Jordan' };

const romanState = (over: Record<string, unknown> = {}) => ({
  phase: 'ready', session: { id: 's1', surface: 'client' }, isFirstOpen: false, messages: [], sending: false,
  sendError: null, nextCursor: null, loadingOlder: false, reload: jest.fn(), loadOlder: jest.fn(),
  send: jest.fn(async () => 'sent'), clearSendError: jest.fn(), ...over,
});
const requiresCoachError = () => Object.assign(new Error('Request failed with status code 403'), {
  isAxiosError: true,
  response: { status: 403, data: { error: 'ROMAN_REQUIRES_COACH', action: 'JOIN_COACH' }, headers: {} },
  config: { headers: {} },
});

async function withProvider(ui: React.ReactElement, onMessageCoach = jest.fn()) {
  const r = await render(<EntitlementProvider onMessageCoach={onMessageCoach}>{ui}</EntitlementProvider>);
  await waitFor(() => expect(mockGetEntitlement).toHaveBeenCalled());
  await act(async () => Promise.resolve()); // the entitlement check settles inside act
  return { ...r, onMessageCoach };
}

function expectRomanLock(r: { getByText: (t: string) => unknown }) {
  expect(r.getByText(ROMAN_LOCK_TITLE)).toBeTruthy();
  expect(r.getByText(ROMAN_LOCK_BODY)).toBeTruthy();
  expect(r.getByText(JOIN_A_COACH)).toBeTruthy();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  mockUser = COACHLESS;
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
  mockUseRomanChat.mockImplementation(() => romanState());
});

describe('Roman chat', () => {
  it('coachless client: locked state, no session opened, Join a coach opens the code sheet path', async () => {
    const r = await withProvider(<RomanChatScreen surface="client" />);
    expectRomanLock(r);
    expect(mockUseRomanChat).not.toHaveBeenCalled();
    expect(r.queryByTestId('roman-composer')).toBeNull();
    await fireEvent.press(r.getByTestId('roman-coach-lock-join'));
    expect(r.onMessageCoach).toHaveBeenCalledWith(true);
    await fireEvent.press(r.getByRole('button', { name: 'Back' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('coached client: the room is unchanged', async () => {
    mockUser = COACHED;
    const r = await withProvider(<RomanChatScreen surface="client" />);
    expect(mockUseRomanChat).toHaveBeenCalledWith('client');
    expect(r.getByTestId('roman-composer')).toBeTruthy();
    expect(r.queryByText(ROMAN_LOCK_TITLE)).toBeNull();
  });

  it('coach: the coach room is unchanged', async () => {
    mockUser = COACH;
    mockUseRomanChat.mockImplementation(() => romanState({ session: { id: 's1', surface: 'coach' } }));
    const r = await render(<RomanChatScreen surface="coach" />);
    expect(mockUseRomanChat).toHaveBeenCalledWith('coach');
    expect(r.queryByText(ROMAN_LOCK_TITLE)).toBeNull();
  });

  it('403 ROMAN_REQUIRES_COACH on open or on send shows the locked state', async () => {
    mockUser = COACHED;
    mockUseRomanChat.mockImplementation(() => romanState({ phase: 'requiresCoach' }));
    const opened = await render(<RomanChatScreen surface="client" />);
    expectRomanLock(opened);
    await opened.unmount();
    mockUseRomanChat.mockImplementation(() =>
      romanState({ sendError: { kind: 'requiresCoach', message: 'Roman works with a coach.' } }),
    );
    const sent = await render(<RomanChatScreen surface="client" />);
    expectRomanLock(sent);
    expect(sent.queryByTestId('roman-send-error')).toBeNull();
  });
});

describe('AI guide', () => {
  it('coachless client: locked state, nothing sent, Join a coach opens the code sheet path', async () => {
    const r = await withProvider(<AIGuideScreen />);
    expectRomanLock(r);
    expect(r.queryByText('Guidance')).toBeNull();
    await fireEvent.press(r.getByTestId('ai-guide-coach-lock-join'));
    expect(r.onMessageCoach).toHaveBeenCalledWith(true);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockContext).not.toHaveBeenCalled();
  });

  it('coached client: the guide is unchanged; a 403 ROMAN_REQUIRES_COACH reply shows the locked state', async () => {
    mockUser = COACHED;
    const r = await render(<AIGuideScreen />);
    expect(r.getByText('Guidance')).toBeTruthy();
    expect(r.queryByText(ROMAN_LOCK_TITLE)).toBeNull();
    mockChat.mockRejectedValueOnce(requiresCoachError());
    await fireEvent.press(r.getByText('Meal ideas'));
    await waitFor(() => expectRomanLock(r));
  });
});

describe('Community tab', () => {
  const Stack = () => <Text testID="community-stack">stack</Text>;

  it('coachless client: Join a coach with a short explanation, before any terms or feed', async () => {
    const r = await withProvider(
      <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY} testID="community-coach-lock">
        <Stack />
      </CoachOnlyGate>,
    );
    expect(r.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(r.getByText(COMMUNITY_LOCK_BODY)).toBeTruthy();
    expect(r.queryByTestId('community-stack')).toBeNull();
    expect(r.queryByRole('button', { name: 'Back' })).toBeNull();
    await fireEvent.press(r.getByText(JOIN_A_COACH));
    expect(r.onMessageCoach).toHaveBeenCalledWith(true);
  });

  it('coached client: the Community stack is unchanged', async () => {
    mockUser = COACHED;
    const r = await render(
      <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY}>
        <Stack />
      </CoachOnlyGate>,
    );
    expect(r.getByTestId('community-stack')).toBeTruthy();
    expect(r.queryByText(JOIN_A_COACH)).toBeNull();
  });

  it('the Community navigator puts the gate in front of the terms and the stack', () => {
    const src = jest.requireActual('fs').readFileSync(
      jest.requireActual('path').join(__dirname, '../../../navigation/CommunityNavigator.tsx'),
      'utf8',
    ) as string;
    const gate = src.indexOf('<CoachOnlyGate');
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf('<CommunityTermsGate>')).toBeGreaterThan(gate);
  });
});

describe('copy', () => {
  it('sentence case, no first person, no exclamation marks, never "your coach"', () => {
    for (const line of [ROMAN_LOCK_TITLE, ROMAN_LOCK_BODY, COMMUNITY_LOCK_TITLE, COMMUNITY_LOCK_BODY, JOIN_A_COACH]) {
      expect(line).not.toMatch(/!|\bI\b|\bwe\b|\bmy\b|your coach/i);
    }
  });
});
