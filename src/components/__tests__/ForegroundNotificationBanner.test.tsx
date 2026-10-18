// EW3-003 — ForegroundNotificationBanner safe-area top inset.
//
// Verifies the SDK 56 edge-to-edge fix: the banner container's paddingTop is
// driven by useSafeAreaInsets().top (with a 12px floor) rather than the old
// `Platform.OS === 'ios' ? 44 : 12` magic numbers. We mock the safe-area hook
// to report a 47px top inset and assert the rendered container style carries
// paddingTop: 47.

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { Animated } from 'react-native';

const mockNavigate = jest.fn();
const mockFlags = { romanChat: false };
jest.mock('../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));

const COLORS = {
  textPrimary: '#1A1A18',
  textOnPrimary: '#FFFDF8',
  primary: '#4A0404',
  primaryPale: '#EFE6DC',
};

jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: COLORS }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 47, bottom: 0, left: 0, right: 0 })),
}));

import ForegroundNotificationBanner from '../ForegroundNotificationBanner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';
import { __resetPushTapRouterForTests, attachPushNavigator, setPushSession } from '../../services/pushTapRouter';

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === 'object') Object.assign(out, s as Record<string, unknown>);
  };
  walk(style);
  return out;
};

describe('ForegroundNotificationBanner safe-area inset', () => {
  it.each(['tgp://meal-plan/137c1340-c8a2-45d6-a006-7a6e695ed845', 'https://unknown.example/meal-plan/one'])(
    'routes banner URLs through the same trusted role-aware receiver: %s', async (deepLink) => {
      mockNavigate.mockClear();
      __resetPushTapRouterForTests();
      attachPushNavigator({
        isReady: () => true, navigate: mockNavigate,
        getRootState: () => ({ routeNames: ['Home', 'MoreTab'] }),
      });
      setPushSession({ kind: 'app', userId: 'one', role: 'student' });
      const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
        start: (done) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
      });
      await act(() => foregroundBannerStore.getState().showBanner({
        title: 'Plan note', body: 'Open plan', notificationId: deepLink,
        actionScreen: 'NotificationCenter', deepLink,
      }));
      const r = await render(<ForegroundNotificationBanner />);
      await fireEvent.press(r.getByLabelText('Plan note. Open plan. Tap to view.'));
      if (deepLink.startsWith('tgp://')) {
        expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
          screen: 'ClientDailyMealPlan', params: { assignmentId: '137c1340-c8a2-45d6-a006-7a6e695ed845' }, initial: false,
        });
      } else {
        expect(mockNavigate).not.toHaveBeenCalled();
      }
      timing.mockRestore();
    },
  );

  it.each([true, false])('legacy Guidance banner redirects with Roman=%s', async (roman) => {
    mockNavigate.mockClear();
    mockFlags.romanChat = roman;
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
      start: (done) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
    });
    await act(() => foregroundBannerStore.getState().showBanner({
      title: 'Plan note', body: 'Open chat', notificationId: 'legacy', actionScreen: 'AIGuide',
    }));
    const r = await render(<ForegroundNotificationBanner />);
    await fireEvent.press(r.getByLabelText('Plan note. Open chat. Tap to view.'));
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
      screen: roman ? 'RomanChat' : 'MoreIndex', initial: false,
    });
    timing.mockRestore();
  });

  afterEach(async () => {
    await act(() => {
      foregroundBannerStore.getState().reset();
    });
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 47, bottom: 0, left: 0, right: 0 });
  });

  it('uses the safe-area top inset for paddingTop', async () => {
    await act(() => {
      foregroundBannerStore.getState().showBanner({
        title: 'New message',
        body: 'You have a new message from your coach',
        notificationId: 'n-1',
      });
    });

    const { root } = await render(<ForegroundNotificationBanner />);

    // v14: `root` is the first rendered host element — the banner's outermost
    // absolute-position container (styles.container has position:'absolute',
    // zIndex:999). Assert directly on its flattened style.
    if (!root) throw new Error('expected banner root to be rendered');
    const flat = flatten(root.props.style);
    expect(flat.position).toBe('absolute');
    expect(flat.zIndex).toBe(999);
    expect(flat.paddingTop).toBe(47);
  });

  it('uses the 12px floor when the safe-area top inset is 0', async () => {
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });

    await act(() => {
      foregroundBannerStore.getState().showBanner({
        title: 'New message',
        body: 'You have a new message from your coach',
        notificationId: 'n-1',
      });
    });

    const { root } = await render(<ForegroundNotificationBanner />);

    if (!root) throw new Error('expected banner root to be rendered');
    const flat = flatten(root.props.style);
    expect(flat.position).toBe('absolute');
    expect(flat.zIndex).toBe(999);
    expect(flat.paddingTop).toBe(12);
  });
});
