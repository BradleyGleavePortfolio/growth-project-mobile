/**
 * share-card.test.tsx — Phase 11 / Track C
 *
 * Asserts that ShareCardScreen:
 *   1. Renders each card variant without crashing.
 *   2. The Share button is present and accessible.
 *   3. After pressing Share, expo-sharing is invoked.
 *   4. REFERRAL_SHARE_CARD_SHARED event is fired with correct props.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockTrack = jest.fn();
const mockShareAsync = jest.fn().mockResolvedValue(undefined);
const mockIsAvailableAsync = jest.fn().mockResolvedValue(true);

// mock react-native-view-shot so captureRef is available
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/card.png'),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: mockShareAsync,
  isAvailableAsync: mockIsAvailableAsync,
}));

jest.mock('../../../lib/analytics', () => ({
  track: mockTrack,
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

  it('renders a Share button that is accessible', () => {
    const { getByRole } = renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
    });
    // Share button should be findable by role
    expect(getByRole('button', { name: 'Share milestone card' })).toBeTruthy();
  });

  it('calls expo-sharing after pressing Share', async () => {
    const { getByRole } = renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
      coachTenantId: 'coach-abc',
    });

    fireEvent.press(getByRole('button', { name: 'Share milestone card' }));

    await waitFor(() => {
      // expo-sharing.shareAsync is the observable side-effect after captureRef
      expect(mockShareAsync).toHaveBeenCalled();
    });
  });

  it('fires REFERRAL_SHARE_CARD_SHARED with correct card_type after sharing', async () => {
    const { getByRole } = renderScreen({
      variant: 'streak',
      value: '7',
      label: 'Day Streak',
      coachTenantId: 'coach-abc',
    });

    fireEvent.press(getByRole('button', { name: 'Share milestone card' }));

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
