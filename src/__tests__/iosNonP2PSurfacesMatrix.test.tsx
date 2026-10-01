/**
 * Audit #304 B1/B2/C2 and #305 A1: render the real surfaces under the real
 * gate (no purchasesHidden prop injected) for each platform, bundle flag and
 * native build combination, with __DEV__ false (release semantics).
 *
 *   hidden rows: iOS + flag true; iOS + flag false + native build >= 6 (an
 *                OTA bundle that flips the flag); iOS + flag false + native
 *                build unreadable
 *   shown rows:  iOS + flag false + native build 5 (pre-OTA binary);
 *                Android + flag true
 */
import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockState: { flag: boolean; build: string | null } = { flag: true, build: '6' };
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k === 'iosHideNonP2PPurchases' ? mockState.flag : (t as Record<string | symbol, unknown>)[k]),
    }),
  };
});
jest.mock('expo-application', () => ({
  get nativeBuildVersion() {
    return mockState.build;
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
    Easing: { out: () => () => 0, cubic: () => 0, inOut: () => () => 0, quad: () => 0, linear: () => 0 },
  };
});
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: <T,>(c: T): T => c,
  withScope: (fn: (scope: { setExtra: jest.Mock }) => void) => fn({ setExtra: jest.fn() }),
  captureException: jest.fn(),
  setUser: jest.fn(),
}));
const mockNavigate = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));
let mockBudget: Record<string, unknown> | undefined;
jest.mock('../hooks/useAIBudget', () => ({ useAIBudget: () => ({ data: mockBudget }) }));
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', name: 'Dana' }) }));
jest.mock('../hooks/useCommunity', () => ({ useCommunityMe: () => ({ data: { workspace_id: 'ws-1' } }) }));
let mockEvent: Record<string, unknown> | undefined;
jest.mock('../hooks/useCommunityEvents', () => ({
  useCommunityEvent: () => ({ data: mockEvent, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() }),
  useRsvpEvent: () => ({ mutate: jest.fn(), isPending: false }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AIBudgetMount } from '../components/coach/ai-budget/AIBudgetMount';
import { AIBudgetTutorialModal } from '../components/coach/ai-budget/AIBudgetTutorialModal';
import { UpgradeGate } from '../screens/coach/TeamManagementScreen';
import { seatLimitMessage } from '../screens/coach/SubCoachInviteModal';
import CommunityEventDetailScreen from '../screens/community/CommunityEventDetailScreen';
import { nonP2PPurchasesHidden, externalLinkAllowed, isPaymentUrl } from '../config/purchaseSurfaces';

const BUY = /buy|top up|top-up|pack|upgrade|checkout|purchase/i;

type Row = { name: string; os: 'ios' | 'android'; flag: boolean; build: string | null; hidden: boolean };
const ROWS: Row[] = [
  { name: 'iOS, flag on, build 6', os: 'ios', flag: true, build: '6', hidden: true },
  { name: 'iOS, OTA flips flag off, build 6', os: 'ios', flag: false, build: '6', hidden: true },
  { name: 'iOS, OTA flips flag off, build 7', os: 'ios', flag: false, build: '7', hidden: true },
  { name: 'iOS, flag off, unreadable build', os: 'ios', flag: false, build: null, hidden: true },
  { name: 'iOS, flag off, pre-OTA build 5', os: 'ios', flag: false, build: '5', hidden: false },
  { name: 'Android, flag on', os: 'android', flag: true, build: '5', hidden: false },
];

function budget(pct: number) {
  return {
    period_start: '2026-09-01T00:00:00Z',
    period_end: '2026-10-01T00:00:00Z',
    base_displayed_cents: 12500,
    pack_displayed_cents: 0,
    total_displayed_cents: 12500,
    used_displayed_cents: Math.round(12500 * (pct / 100)),
    remaining_displayed_cents: 0,
    pct_used: pct,
    base_actual_cents: 4000,
    value_multiplier: '3.125',
    actual_used_cents: 3200,
    pack_options_cents: [1000, 2500],
    custom_pack_bounds_cents: { min: 1000, max: 50000 },
  };
}

function allText(tree: unknown): string {
  return JSON.stringify(tree);
}

const realOS = Platform.OS;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;

describe.each(ROWS)('$name', (row) => {
  beforeEach(async () => {
    mockState.flag = row.flag;
    mockState.build = row.build;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => row.os });
    g.__DEV__ = false;
    mockNavigate.mockClear();
    await AsyncStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
    g.__DEV__ = realDev;
  });

  it('gate decision', () => {
    expect(nonP2PPurchasesHidden()).toBe(row.hidden);
  });

  it('meter chip: interactive buy affordance only when shown', async () => {
    mockBudget = budget(60);
    const { getByTestId } = await render(<AIBudgetMount />);
    const meter = getByTestId('ai-budget-mount-chip');
    if (row.hidden) {
      expect(meter.props.accessibilityRole).toBe('text');
      expect(meter.props.accessibilityLabel).not.toMatch(BUY);
      expect(meter.props.accessibilityHint).toBeUndefined();
    } else {
      expect(meter.props.accessibilityRole).toBe('button');
      expect(meter.props.accessibilityHint).toMatch(/checkout/);
    }
  });

  it('95% banner: Buy credits only when shown', async () => {
    mockBudget = budget(96);
    const { queryByText } = await render(<AIBudgetMount />);
    expect(queryByText('Buy credits') === null).toBe(row.hidden);
  });

  it('hard pause (mounted): neutral notice when hidden, packs when shown', async () => {
    mockBudget = budget(100);
    const utils = await render(<AIBudgetMount />);
    const text = allText(utils.toJSON());
    if (row.hidden) {
      expect(utils.getByTestId('ai-hard-pause-neutral')).toBeTruthy();
      expect(text).not.toMatch(/Top up|credit pack/);
      expect(utils.queryByTestId('ai-pack-option-1000')).toBeNull();
    } else {
      expect(text).toMatch(/Top up with a credit pack/);
      expect(utils.getByTestId('ai-pack-option-1000')).toBeTruthy();
    }
  });

  it('tutorial (every card): no pack / buy-later copy when hidden; buy card when shown', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const utils = await render(
        <AIBudgetTutorialModal visible budget={budget(80) as never} onClose={onClose} onSelectPack={jest.fn()} />,
      );
      const seen: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        seen.push(allText(utils.toJSON()));
        const next = utils.queryByTestId('ai-tutorial-continue');
        if (!next) break;
        await fireEvent.press(next);
        await act(() => {
          jest.advanceTimersByTime(300);
        });
      }
      const joined = seen.join('\n');
      if (row.hidden) {
        expect(joined).not.toMatch(/How packs work|Buy credits|Pick a pack|buy later|top up/i);
        expect(utils.queryByTestId('ai-tutorial-later')).toBeNull();
        await fireEvent.press(utils.getByTestId('ai-tutorial-done'));
        await act(async () => {
          jest.advanceTimersByTime(10);
        });
        expect(onClose).toHaveBeenCalled();
      } else {
        expect(utils.getByTestId('ai-tutorial-later')).toBeTruthy();
        expect(utils.getByTestId('ai-pack-option-1000')).toBeTruthy();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('Team gate: no upgrade instruction when hidden', async () => {
    const { toJSON } = await render(<UpgradeGate />);
    expect(/Upgrade/.test(allText(toJSON()))).toBe(!row.hidden);
  });

  it('exhausted / partial seat messages: no upgrade instruction when hidden', () => {
    const hidden = nonP2PPurchasesHidden();
    expect(/upgrade/i.test(seatLimitMessage(0, hidden))).toBe(!row.hidden);
    expect(/upgrade/i.test(seatLimitMessage(2, hidden))).toBe(!row.hidden);
    expect(seatLimitMessage(0, hidden)).toMatch(/Revoke an existing sub-coach|revoke an existing sub-coach/);
  });

  describe('community event external link', () => {
    function event(url: string) {
      return {
        id: 'ev-1', workspace_id: 'ws-1', cohort_id: null, created_by_user_id: 'coach-1',
        title: 'Live Q&A', description: null, state: 'live', starts_at: '2026-10-01T18:00:00.000Z',
        ends_at: null, external_url: url, reflected_at: null, canceled: false,
        rsvp_counts: { going: 1, maybe: 0, declined: 0, attended: 0, missed: 0 },
        viewer_rsvp_status: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      };
    }
    beforeEach(() => {
      mockRouteParams.current = { eventId: 'ev-1' };
      jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      (Linking.openURL as jest.Mock).mockClear();
    });
    afterEach(() => jest.restoreAllMocks());

    it('Stripe payment link never opens when hidden', async () => {
      mockEvent = event('https://buy.stripe.com/non-p2p-audit-placeholder');
      const { queryByTestId } = await render(<CommunityEventDetailScreen />);
      const link = queryByTestId('community-event-detail-link');
      if (row.hidden) {
        expect(link).toBeNull();
      } else {
        expect(link).toBeTruthy();
        await fireEvent.press(link!);
        expect(Linking.openURL).toHaveBeenCalledWith('https://buy.stripe.com/non-p2p-audit-placeholder');
      }
    });

    it.each([
      ['YouTube paid channel membership', 'https://www.youtube.com/channel/UCkRfArvrzheW2E7b6SVT7vQ/join'],
      ['YouTube handle membership', 'https://www.youtube.com/@coach/join'],
      ['Vimeo on-demand sale', 'https://vimeo.com/ondemand/fitclass'],
      ['YouTube redirect to a payment link', 'https://www.youtube.com/redirect?q=https%3A%2F%2Fbuy.stripe.com%2Fx'],
      ['Zoom pricing', 'https://zoom.us/pricing'],
      ['Twitch subscription', 'https://www.twitch.tv/subs/coach'],
    ])('%s: neither renders nor opens when hidden; usable when shown', async (_label, url) => {
      mockEvent = event(url);
      const { queryByTestId } = await render(<CommunityEventDetailScreen />);
      const link = queryByTestId('community-event-detail-link');
      if (row.hidden) {
        expect(link).toBeNull();
        expect(Linking.openURL).not.toHaveBeenCalled();
      } else {
        expect(link).toBeTruthy();
        await fireEvent.press(link!);
        expect(Linking.openURL).toHaveBeenCalledWith(new URL(url).href);
      }
    });

    it('notification entry: a routed CommunityEventDetail tap lands on the same gated screen', async () => {
      const { routePushTap, attachPushNavigator, __resetPushTapRouterForTests } = jest.requireActual('../services/pushTapRouter');
      __resetPushTapRouterForTests();
      let routed: Record<string, unknown> | undefined;
      attachPushNavigator({
        isReady: () => true,
        getRootState: () => ({ routeNames: ['CoachTabs', 'CommunityEventDetail'] }),
        navigate: (_n: string, p?: Record<string, unknown>) => {
          routed = p;
        },
      });
      routePushTap('CommunityEventDetail', { eventId: 'ev-1' }, `n-${row.name}`);
      mockRouteParams.current = routed ?? {};
      mockEvent = event('https://www.youtube.com/channel/UCkRfArvrzheW2E7b6SVT7vQ/join');
      const { queryByTestId } = await render(<CommunityEventDetailScreen />);
      expect(queryByTestId('community-event-detail-link') === null).toBe(row.hidden);
    });

    it('approved attendance link (Zoom) still opens', async () => {
      mockEvent = event('https://us02web.zoom.us/j/12345678901');
      const { getByTestId } = await render(<CommunityEventDetailScreen />);
      await fireEvent.press(getByTestId('community-event-detail-link'));
      expect(Linking.openURL).toHaveBeenCalledWith('https://us02web.zoom.us/j/12345678901');
    });

    it('replay on YouTube still opens', async () => {
      mockEvent = { ...event('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), state: 'replay' };
      const { getByTestId } = await render(<CommunityEventDetailScreen />);
      await fireEvent.press(getByTestId('community-event-detail-link'));
      expect(Linking.openURL).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });
});

describe('payment URL classifier', () => {
  it.each([
    ['https://buy.stripe.com/x', true],
    ['https://checkout.stripe.com/c/pay/x', true],
    ['https://billing.stripe.com/p/session', true],
    ['https://www.paypal.com/paypalme/x', true],
    ['https://coach.square.site/x', true],
    ['https://example.com/checkout/abc', true],
    ['https://example.com/pay/abc', true],
    ['https://us02web.zoom.us/j/1', false],
    ['https://www.youtube.com/watch?v=abc', false],
    ['not a url', true],
  ])('%s → payment=%s', (url, expected) => {
    expect(isPaymentUrl(url)).toBe(expected);
  });

  it.each([
    ['https://us02web.zoom.us/j/12345678901?pwd=abc', true],
    ['https://zoom.us/wc/join/12345678901', true],
    ['https://zoom.us/rec/share/AbC-12_x', true],
    ['https://meet.google.com/abc-defg-hij', true],
    ['https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0', true],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', true],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', true],
    ['https://youtu.be/dQw4w9WgXcQ', true],
    ['https://vimeo.com/123456789', true],
    ['https://vimeo.com/event/123456', true],
    ['https://www.loom.com/share/0123456789abcdef0123456789abcdef', true],
    ['https://www.twitch.tv/coachlive', true],
    ['https://team.daily.co/room1', true],
    ['https://www.youtube.com/channel/UCkRfArvrzheW2E7b6SVT7vQ/join', false],
    ['https://www.youtube.com/@coach/join', false],
    ['https://www.youtube.com/@coach', false],
    ['https://www.youtube.com/watch?v=short', false],
    ['https://www.youtube.com/redirect?q=https%3A%2F%2Fbuy.stripe.com%2Fx', false],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&next=https://buy.stripe.com/x', false],
    ['https://vimeo.com/ondemand/fitclass', false],
    ['https://vimeo.com/store', false],
    ['https://zoom.us/pricing', false],
    ['https://zoom.us/j/1', false],
    ['https://www.twitch.tv/subs/coach', false],
    ['https://www.twitch.tv/store', false],
    ['https://www.daily.co/pricing', false],
    ['https://whereby.com/coachroom', false],
    ['https://restream.io/x', false],
    ['https://user:pw@zoom.us/j/12345678901', false],
    ['https://zoom.us:8443/j/12345678901', false],
  ])('hidden shape check %s → %s', (url, expected) => {
    expect(externalLinkAllowed(url, true)).toBe(expected);
  });

  it('hidden mode fails closed for non-attendance hosts and http', () => {
    expect(externalLinkAllowed('https://example.com/live', true)).toBe(false);
    expect(externalLinkAllowed('http://zoom.us/j/12345678901', true)).toBe(false);
    expect(externalLinkAllowed('https://zoom.us.evil.com/j/12345678901', true)).toBe(false);
    expect(externalLinkAllowed('https://zoom.us/j/12345678901', true)).toBe(true);
    expect(externalLinkAllowed('https://example.com/live', false)).toBe(true);
  });
});
