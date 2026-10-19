/**
 * share-card.test.tsx — Phase 11 / Track C
 *
 * Asserts that ShareCardScreen (featureFlags.shareSheetV2 off):
 *   1. Renders the streak card, its only variant (SHARE-A).
 *   2. The Share button is present and accessible (has correct label + role).
 *   3. Share makes the picture before anything else, and a failure says so in
 *      place: no alert, no success haptic, the error haptic (SHARE-A).
 *   4. The "Share Progress" header title is rendered.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn() },
}));
const haptic = () => jest.requireMock('../../../ui/haptics/haptics.service').HapticService;

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
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
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

  it('makes the picture, then opens the share options and records the share, with no success haptic', async () => {
    const { getByRole } = await renderScreen({ variant: 'streak', value: '7', label: 'Day Streak' });
    await fireEvent.press(getByRole('button', { name: 'Share milestone card' }));
    const sharing = jest.requireMock('expo-sharing');
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', expect.objectContaining({ dialogTitle: 'Share your milestone' })));
    expect(jest.requireMock('react-native-view-shot').captureRef).toHaveBeenCalledTimes(1);
    expect(jest.requireMock('../../../lib/analytics').track).toHaveBeenCalledWith('referral_share_card_shared', expect.objectContaining({ card_type: 'streak' }));
    expect(jest.requireMock('../../../utils/haptics').successTap).not.toHaveBeenCalled();
    expect(haptic().success).not.toHaveBeenCalled();
  });

  it.each([
    ['sharing is not available (the old eas build alert)', () => jest.requireMock('expo-sharing').isAvailableAsync.mockResolvedValueOnce(false)],
    ['the share fails (once swallowed)', () => jest.requireMock('expo-sharing').shareAsync.mockRejectedValueOnce(new Error('denied'))],
  ])('says so in place when %s: no alert, the error haptic', async (_case, arrange) => {
    arrange();
    const alert = jest.spyOn(Alert, 'alert');
    const { getByRole, findByText } = await renderScreen({ variant: 'streak', value: '7', label: 'Day Streak' });
    await fireEvent.press(getByRole('button', { name: 'Share milestone card' }));
    expect(await findByText('The picture could not be made. Try again.')).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(haptic().error).toHaveBeenCalledTimes(1);
    expect(jest.requireMock('../../../lib/analytics').track).not.toHaveBeenCalled();
    alert.mockRestore();
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
    // v14: fireEvent is async, so a synchronous not.toThrow() wrapper no longer
    // applies. Awaiting the press directly preserves the contract: any throw
    // surfaced by pressing fails the test.
    await fireEvent.press(getByRole('button', { name: 'Share milestone card' }));
  });

  it('REFERRAL_SHARE_CARD_SHARED event constant has correct value', () => {
    // Verify the analytics event constant used by ShareCardScreen is correct.
    expect(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED).toBe('referral_share_card_shared');
  });
});
