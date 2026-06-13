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
  useSafeAreaInsets: jest.fn(() => ({ top: 47, bottom: 0, left: 0, right: 0 })),
}));

import ForegroundNotificationBanner from '../ForegroundNotificationBanner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

    const { UNSAFE_root } = await render(<ForegroundNotificationBanner />);

    // Find the outermost Animated.View by locating any node whose flattened
    // style carries the banner's absolute-position container marker.
    const match = UNSAFE_root.findAll((node) => {
      const flat = flatten(node.props?.style);
      return flat.position === 'absolute' && flat.zIndex === 999;
    })[0];

    const flat = flatten(match.props.style);
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

    const { UNSAFE_root } = await render(<ForegroundNotificationBanner />);

    const match = UNSAFE_root.findAll((node) => {
      const flat = flatten(node.props?.style);
      return flat.position === 'absolute' && flat.zIndex === 999;
    })[0];

    const flat = flatten(match.props.style);
    expect(flat.paddingTop).toBe(12);
  });
});
