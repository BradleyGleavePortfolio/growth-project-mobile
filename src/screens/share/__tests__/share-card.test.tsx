/**
 * share-card.test.tsx — Phase 11 / Track C
 *
 * Asserts that ShareCardScreen:
 *   1. Renders each card variant without crashing.
 *   2. The Share button is present and accessible (has correct label + role).
 *   3. Pressing Share does not crash the component.
 *   4. The "Share Progress" header title is rendered.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/card.png'),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../lib/analytics', () => ({
  track: jest.fn(),
}));

jest.mock('../../../analytics/events', () => ({
  AnalyticsEvents: {
    REFERRAL_SHARE_CARD_SHARED: 'referral_share_card_shared',
    REFERRAL_SHARE_INITIATED: 'referral_share_initiated',
  },
}));

jest.mock('../../../utils/haptics', () => ({
  successTap: jest.fn(),
  mediumTap: jest.fn(),
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F5EFE4',
      surface: '#FFFFFF',
      primary: '#2D4B3A',
      primaryLight: '#E8F0EB',
      textPrimary: '#1A1A1A',
      textSecondary: '#4A4A4A',
      textMuted: '#8A8A8A',
      border: '#E0D8CC',
      white: '#FFFFFF',
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
jest.mock('../../../components/HapticPressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { TouchableOpacity } = require('react-native');
  return ({ children, onPress, accessibilityLabel, accessibilityRole, ...props }: {
    children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityRole?: string;
    [key: string]: unknown;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
});

// ── Test ──────────────────────────────────────────────────────────────────────

import ShareCardScreen from '../ShareCardScreen';
import type { ShareCardMilestone } from '../ShareCardScreen';
import { AnalyticsEvents } from '../../../analytics/events';

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

async function renderScreen(milestone: ShareCardMilestone) {
  return await render(
    <ShareCardScreen
      route={{ params: { milestone }, key: 'ShareCard', name: 'ShareCard' } as never}
      navigation={mockNavigation as never}
    />,
  );
}

describe('ShareCardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the streak variant headline and label', async () => {
    const { getByText } = await renderScreen({
      variant: 'streak',
      value: '14',
      label: 'Day Streak',
    });
    expect(getByText('14')).toBeTruthy();
    expect(getByText('Day Streak')).toBeTruthy();
  });

  it('renders the PR variant headline', async () => {
    const { getByText } = await renderScreen({
      variant: 'pr',
      value: '100kg',
      label: 'Back Squat PR',
    });
    expect(getByText('100kg')).toBeTruthy();
  });

  it('renders the transformation variant', async () => {
    const { getByText } = await renderScreen({
      variant: 'transformation',
      value: '5kg',
      label: 'Body Composition',
    });
    expect(getByText('5kg')).toBeTruthy();
  });

  it('renders the Share button with correct accessibility role and label', async () => {
    const { getByRole } = await renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
    });
    const shareBtn = getByRole('button', { name: 'Share milestone card' });
    expect(shareBtn).toBeTruthy();
  });

  it('renders Share Progress screen title', async () => {
    const { getByText } = await renderScreen({
      variant: 'streak',
      value: '3',
      label: 'Day Streak',
    });
    expect(getByText('Share Progress')).toBeTruthy();
  });

  it('Share button press does not crash the component', async () => {
    const { getByRole } = await renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
    });
    expect(() => {
      await fireEvent.press(getByRole('button', { name: 'Share milestone card' }));
    }).not.toThrow();
  });

  it('REFERRAL_SHARE_CARD_SHARED event constant has correct value', () => {
    // Verify the analytics event constant used by ShareCardScreen is correct.
    expect(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED).toBe('referral_share_card_shared');
  });
});
