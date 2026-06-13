// src/__tests__/CoachPackageEditScreen.lockPreview.test.tsx
//
// PR-18 M1 items 2+3 — coach editor: preview-as-buyer + lock-pricing UX.
//
// What we assert (RTL mount):
//   1. Lock-pricing helper copy renders when the package has subscribers, and
//      is ABSENT when subscriberCount === 0. Fields are NOT over-disabled
//      (price input stays editable).
//   2. "Preview as buyer" opens a modal rendering the coachPreview surface
//      with the disabled-checkout banner (built from local draft + original,
//      no network fetch).
//   3. A PACKAGE_PRICING_LOCKED save error surfaces the actionable lock alert
//      (not the generic "Could not save").

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ── Theme mock ──────────────────────────────────────────────────────────────
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual('../constants/colors').default;
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      tierColors: {
        accentBorder: realTokens.colors.forest,
        accentBg: 'rgba(44,74,54,0.06)',
        accentFg: realTokens.colors.forest,
        badgeShadow: realTokens.shadows.sm,
      },
      colorScheme: 'light',
    }),
  };
});

jest.mock('expo-font', () => ({ isLoaded: () => true }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'c@x.com', name: 'Coach Lee' }),
}));

const mockUpdate = jest.fn();
jest.mock('../api/packagesApi', () => {
  const actual = jest.requireActual('../api/packagesApi');
  return {
    ...actual,
    coachPackagesApi: {
      update: (...a: unknown[]) => mockUpdate(...a),
      create: jest.fn(),
      archive: jest.fn(),
    },
  };
});

import CoachPackageEditScreen from '../screens/coach/payments/CoachPackageEditScreen';
import type { CoachPackage } from '../api/packagesApi';

function pkg(overrides: Partial<CoachPackage> = {}): CoachPackage {
  return {
    id: 'pkg_1',
    coachUserId: 'u1',
    title: 'Strength Builder',
    description: 'Get strong.',
    priceCents: 9900,
    currency: 'usd',
    billingInterval: 'monthly',
    intervalCount: 1,
    trialDays: null,
    features: ['Programming', 'Form checks'],
    status: 'active',
    shareToken: 'tok_123',
    subscriberCount: 0,
    monthlyRevenueCents: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    ...overrides,
  };
}

function makeProps(initialPackage: CoachPackage) {
  return {
    navigation: { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() } as never,
    route: { params: { packageId: initialPackage.id, initialPackage } } as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('CoachPackageEditScreen — lock-pricing UX', () => {
  it('shows the lock helper copy when the package has subscribers', async () => {
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(
      getByText(/Pricing is locked after subscribers join/),
    ).toBeTruthy();
  });

  it('does NOT show the lock helper copy when there are no subscribers', async () => {
    const props = makeProps(pkg({ subscriberCount: 0 }));
    const { queryByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(queryByText(/Pricing is locked after subscribers join/)).toBeNull();
  });

  it('does not over-disable the price field when locked (still editable)', async () => {
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByDisplayValue } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    const priceInput = getByDisplayValue('99.00');
    // editable is undefined (truthy default) — never explicitly false.
    expect(priceInput.props.editable).not.toBe(false);
  });

  it('surfaces the actionable lock alert on a PACKAGE_PRICING_LOCKED save error', async () => {
    mockUpdate.mockRejectedValue({
      response: { data: { error: 'PACKAGE_PRICING_LOCKED' } },
    });
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls;
      const locked = calls.find((c) => c[0] === 'Pricing is locked');
      expect(locked).toBeTruthy();
      expect(locked[1]).toMatch(/Create a new package for new pricing/);
    });
  });
});

describe('CoachPackageEditScreen — preview as buyer', () => {
  it('opens the coachPreview surface with the disabled-checkout banner', async () => {
    const props = makeProps(pkg({ subscriberCount: 0 }));
    const { getByLabelText, getByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Preview as buyer'));
    await waitFor(() =>
      expect(
        getByText('Buyer preview — checkout is disabled for coaches.'),
      ).toBeTruthy(),
    );
    // The disabled CTA exists in preview; no functional pay path.
    expect(getByLabelText('Checkout disabled in preview')).toBeTruthy();
  });
});
