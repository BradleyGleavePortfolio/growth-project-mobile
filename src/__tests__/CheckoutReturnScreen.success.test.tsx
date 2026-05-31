// src/__tests__/CheckoutReturnScreen.success.test.tsx
//
// PR-18 M1 R2 P0 — the paid checkout return is the PEAK moment of the buyer
// journey. This covers the success treatment that replaced the audited
// "Empty Confirmation" anti-pattern:
//   • a single success haptic fires exactly once when the paid state lands,
//   • the copy is emotionally specific to the purchased package,
//   • exactly ONE primary next-step decision is presented,
//   • reduce-motion users get the final state (no gating on animation).

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// ── Theme mock (light semantic tokens come straight from real tokens) ───────
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  return {
    useTheme: () => ({
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

// ── Haptics spy ─────────────────────────────────────────────────────────────
const mockNotification = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  notificationAsync: (...a: unknown[]) => mockNotification(...a),
  NotificationFeedbackType: { Success: 'success' },
}));

// ── Reduce Motion ON so animations resolve to their final state immediately ─
jest.spyOn(
  require('react-native').AccessibilityInfo,
  'isReduceMotionEnabled',
).mockResolvedValue(true);

// ── Navigation hooks ────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGetParent = jest.fn(() => ({ navigate: mockNavigate }));
let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    getParent: mockGetParent,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

// ── Payment status API ──────────────────────────────────────────────────────
const mockConfirm = jest.fn();
const mockGetStatus = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    confirmCheckoutSession: (...a: unknown[]) => mockConfirm(...a),
    getPaymentStatus: (...a: unknown[]) => mockGetStatus(...a),
  },
}));

// Deliverables flag OFF (production default) for the base case.
jest.mock('../config/featureFlags', () => ({
  featureFlags: { deliverables: false },
}));

import CheckoutReturnScreen from '../screens/client/CheckoutReturnScreen';

const PAID_STATUS = {
  state: 'active' as const,
  purchase_id: 'purch_1',
  package_id: 'pkg_1',
  package_name: 'Strength Builder',
  current_period_end: '2026-01-01',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { outcome: 'success', session_id: 'cs_test_123' };
  mockConfirm.mockResolvedValue({ ok: true, data: PAID_STATUS });
  mockGetStatus.mockResolvedValue({ ok: true, data: PAID_STATUS });
});

describe('CheckoutReturnScreen — paid success peak moment (P0)', () => {
  it('fires a success haptic exactly once when the paid state lands', async () => {
    render(<CheckoutReturnScreen />);
    await waitFor(() => expect(mockNotification).toHaveBeenCalledTimes(1));
    expect(mockNotification).toHaveBeenCalledWith('success');
  });

  it('shows package-specific confirmation copy (not a generic empty line)', async () => {
    const { getByText } = render(<CheckoutReturnScreen />);
    await waitFor(() => getByText('Welcome to Strength Builder'));
    // The eyebrow + next-step framing make this a closure moment, not a dead end.
    getByText("You're in");
    getByText(/Here's what happens next/i);
  });

  it('presents exactly one primary CTA when there is nothing to unpack (flag off)', async () => {
    const { getByText, queryByText } = render(<CheckoutReturnScreen />);
    await waitFor(() => getByText('Welcome to Strength Builder'));
    // Flag off → single "Go to home" primary, no competing secondary link.
    getByText('Go to home');
    expect(queryByText("See what's included")).toBeNull();
  });

  it('falls back to a generic subscribed headline when no package name is present', async () => {
    mockConfirm.mockResolvedValue({
      ok: true,
      data: { ...PAID_STATUS, package_name: null },
    });
    const { getByText } = render(<CheckoutReturnScreen />);
    await waitFor(() => getByText("You're subscribed"));
  });
});
