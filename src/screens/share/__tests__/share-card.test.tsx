/**
 * share-card.test.ts — Phase 11 / Track C
 *
 * Asserts that ShareCardScreen:
 *   1. captureRef is called with the card ref when Share is pressed.
 *   2. REFERRAL_SHARE_CARD_SHARED PostHog event is fired after share.
 *   3. The correct card variant is rendered based on route params.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCaptureRef = jest.fn().mockResolvedValue('file:///tmp/card.png');
const mockTrack = jest.fn();
const mockShareAsync = jest.fn().mockResolvedValue(undefined);
const mockIsAvailableAsync = jest.fn().mockResolvedValue(true);

jest.mock('react-native-view-shot', () => ({
  captureRef: mockCaptureRef,
}));

jest.mock('expo-sharing', () => ({
  shareAsync: mockShareAsync,
  isAvailableAsync: mockIsAvailableAsync,
}));

jest.mock('../../lib/analytics', () => ({
  track: mockTrack,
}));

jest.mock('../../analytics/events', () => ({
  AnalyticsEvents: {
    REFERRAL_SHARE_CARD_SHARED: 'referral_share_card_shared',
    REFERRAL_SHARE_INITIATED: 'referral_share_initiated',
  },
}));

jest.mock('../../utils/haptics', () => ({
  successTap: jest.fn(),
  mediumTap: jest.fn(),
}));

jest.mock('../../theme/ThemeProvider', () => ({
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

// HapticPressable renders as a TouchableOpacity for tests
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
jest.mock('../../components/HapticPressable', () => {
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

import ShareCardScreen from '../../screens/share/ShareCardScreen';
import type { ShareCardMilestone } from '../../screens/share/ShareCardScreen';

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

function renderScreen(milestone: ShareCardMilestone) {
  return render(
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

  it('renders the streak variant without crashing', () => {
    const { getByText } = renderScreen({
      variant: 'streak',
      value: '14',
      label: 'Day Streak',
    });
    expect(getByText('14')).toBeTruthy();
    expect(getByText('Day Streak')).toBeTruthy();
  });

  it('renders the PR variant without crashing', () => {
    const { getByText } = renderScreen({
      variant: 'pr',
      value: '100kg',
      label: 'Back Squat PR',
    });
    expect(getByText('100kg')).toBeTruthy();
  });

  it('renders the transformation variant without crashing', () => {
    const { getByText } = renderScreen({
      variant: 'transformation',
      value: '5kg',
      label: 'Body Composition',
    });
    expect(getByText('5kg')).toBeTruthy();
  });

  it('calls captureRef on the card ref when Share is pressed', async () => {
    const { getByAccessibilityLabel } = renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
      coachTenantId: 'coach-abc',
    });

    fireEvent.press(getByAccessibilityLabel('Share milestone card'));

    await waitFor(() => {
      expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    });
  });

  it('fires REFERRAL_SHARE_CARD_SHARED after sharing', async () => {
    const { getByAccessibilityLabel } = renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
      coachTenantId: 'coach-abc',
    });

    fireEvent.press(getByAccessibilityLabel('Share milestone card'));

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith(
        'referral_share_card_shared',
        expect.objectContaining({
          card_type: 'streak',
          coach_tenant_id: 'coach-abc',
        }),
      );
    });
  });
});
