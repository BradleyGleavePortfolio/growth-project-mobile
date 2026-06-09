// EW3-003 — ForegroundNotificationBanner safe-area top inset.
//
// Verifies the SDK 56 edge-to-edge fix: the banner container's paddingTop is
// driven by useSafeAreaInsets().top (with a 12px floor) rather than the old
// `Platform.OS === 'ios' ? 44 : 12` magic numbers. We mock the safe-area hook
// to report a 47px top inset and assert the rendered container style carries
// paddingTop: 47.

import React from 'react';
import { render, act } from '@testing-library/react-native';

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
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

import ForegroundNotificationBanner from '../ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';

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
  afterEach(() => {
    act(() => {
      foregroundBannerStore.getState().reset();
    });
  });

  it('uses the safe-area top inset for paddingTop', () => {
    act(() => {
      foregroundBannerStore.getState().showBanner({
        title: 'New message',
        body: 'You have a new message from your coach',
        notificationId: 'n-1',
      });
    });

    const { UNSAFE_root } = render(<ForegroundNotificationBanner />);

    // Find the outermost Animated.View by locating any node whose flattened
    // style carries the banner's absolute-position container marker.
    const match = UNSAFE_root.findAll((node) => {
      const flat = flatten(node.props?.style);
      return flat.position === 'absolute' && flat.zIndex === 999;
    })[0];

    const flat = flatten(match.props.style);
    expect(flat.paddingTop).toBe(47);
  });
});
