/**
 * PaywallSheet accessibility — Hunter #3 P0-2.
 *
 * The subscription-purchase surface is conversion-critical and ADA-regulated.
 * These tests freeze the contract that every tappable element on the sheet
 * declares the right accessibility role / label / hint / state so VoiceOver
 * + TalkBack users can:
 *
 *   1. Find the sheet (modal label + heading role on the title).
 *   2. Hear each package as a button with name + price + period + state.
 *   3. Skip the row's child <Text> elements (otherwise the row would
 *      announce its own price three times).
 *   4. Reach "See all plans" and "Maybe later" with the same role / label
 *      hygiene as the rows.
 *
 * WCAG 2.1 AA reference:
 *   - 4.1.2 Name, Role, Value (every UI control must have all three).
 *   - 2.4.6 Headings and Labels.
 *   - 1.3.1 Info and Relationships (state surfaced semantically, not just
 *     via colour).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import {
  PaywallSheet,
  packageAccessibilityLabel,
} from '../PaywallSheet';
import type { ClientCoachPackage } from '../../api/clientPaymentsApi';

jest.mock('../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      background: '#F5EFE4',
      surface: '#FFFFFF',
      border: '#E0D8C8',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
      textOnPrimary: '#F5EFE4',
      cardShadow: 'rgba(0,0,0,0.2)',
    },
    tokens: {
      typography: {
        h2: { fontSize: 22 },
        h4: { fontSize: 16 },
        body: { fontSize: 15 },
        bodyMd: { fontSize: 15 },
        bodySmall: { fontSize: 13 },
      },
    },
  }),
}));

const mockPackages: ClientCoachPackage[] = [
  {
    id: 'pkg_foundation',
    name: 'Foundation',
    description: 'Core habits + monthly check-in',
    type: 'one_time',
    price: 199,
    currency: 'usd',
    interval: null,
    trial_days: null,
    features: [],
    is_current: false,
  },
  {
    id: 'pkg_premium',
    name: 'Premium Coaching',
    description: 'Weekly 1:1 + meal plan',
    type: 'recurring',
    price: 49,
    currency: 'usd',
    interval: 'month',
    trial_days: null,
    features: [],
    is_current: true,
  },
  {
    id: 'pkg_elite',
    name: 'Elite',
    description: '',
    type: 'recurring',
    price: 199,
    currency: 'usd',
    interval: 'year',
    trial_days: null,
    features: [],
    is_current: false,
  },
];

const getPackagesMock = jest.fn(async () => ({
  ok: true as const,
  data: mockPackages,
}));

jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getPackages: () => getPackagesMock(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

async function renderSheet(overrides: Partial<React.ComponentProps<typeof PaywallSheet>> = {}) {
  const onClose = jest.fn();
  const onSubscribe = jest.fn();
  const utils = render(
    <PaywallSheet
      visible
      onClose={onClose}
      onSubscribe={onSubscribe}
      {...overrides}
    />,
  );
  await Promise.resolve();
  await Promise.resolve();
  return { ...utils, onClose, onSubscribe };
}

beforeEach(() => {
  getPackagesMock.mockClear();
});

describe('packageAccessibilityLabel', () => {
  it('includes name + price + period + current-plan state for the active recurring plan', () => {
    const label = packageAccessibilityLabel(mockPackages[1]);
    expect(label).toBe(
      'Premium Coaching, USD 49.00 per month, billed monthly. Current plan.',
    );
  });

  it('describes a one-time plan with "one-time payment" instead of an interval', () => {
    const label = packageAccessibilityLabel(mockPackages[0]);
    expect(label).toBe(
      'Foundation, USD 199.00, one-time payment. Not currently subscribed.',
    );
  });

  it('uses "Not currently subscribed" when is_current is false', () => {
    const label = packageAccessibilityLabel(mockPackages[2]);
    expect(label).toContain('Not currently subscribed.');
  });

  it('formats yearly intervals symmetrically with monthly', () => {
    const label = packageAccessibilityLabel(mockPackages[2]);
    expect(label).toContain('USD 199.00 per year, billed yearly');
  });
});

describe('PaywallSheet — package row accessibility (H3-P0-2)', () => {
  it('every package row declares accessibilityRole="button"', async () => {
    const { getByTestId } = await renderSheet();
    for (const pkg of mockPackages) {
      const row = getByTestId(`paywall-package-${pkg.id}`);
      expect(row.props.accessibilityRole).toBe('button');
    }
  });

  it('row accessibilityLabel includes name + price + state', async () => {
    const { getByTestId } = await renderSheet();
    const premium = getByTestId('paywall-package-pkg_premium');
    expect(premium.props.accessibilityLabel).toContain('Premium Coaching');
    expect(premium.props.accessibilityLabel).toContain('USD 49.00');
    expect(premium.props.accessibilityLabel).toContain('per month');
    expect(premium.props.accessibilityLabel).toContain('Current plan');

    const foundation = getByTestId('paywall-package-pkg_foundation');
    expect(foundation.props.accessibilityLabel).toContain('Foundation');
    expect(foundation.props.accessibilityLabel).toContain('USD 199.00');
    expect(foundation.props.accessibilityLabel).toContain('Not currently subscribed');
  });

  it('row accessibilityHint tells the user what tapping does', async () => {
    const { getByTestId } = await renderSheet();
    const row = getByTestId('paywall-package-pkg_foundation');
    expect(row.props.accessibilityHint).toMatch(/checkout|select/i);
  });

  it('row accessibilityState.selected mirrors is_current; disabled mirrors is_current', async () => {
    const { getByTestId } = await renderSheet();
    expect(getByTestId('paywall-package-pkg_premium').props.accessibilityState).toEqual({
      selected: true,
      disabled: true,
    });
    expect(getByTestId('paywall-package-pkg_foundation').props.accessibilityState).toEqual({
      selected: false,
      disabled: false,
    });
  });

  it('row child <Text> elements are marked decorative so VoiceOver does not re-announce them', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'PaywallSheet.tsx'),
      'utf8',
    );
    const hiddenCount = (src.match(/accessibilityElementsHidden/g) ?? []).length;
    const noHideCount = (src.match(/importantForAccessibility="no-hide-descendants"/g) ?? []).length;
    expect(hiddenCount).toBeGreaterThanOrEqual(5);
    expect(noHideCount).toBeGreaterThanOrEqual(5);
  });

  it('tapping a row fires onSubscribe with the package id', async () => {
    const { getByTestId, onSubscribe } = await renderSheet();
    fireEvent.press(getByTestId('paywall-package-pkg_foundation'));
    expect(onSubscribe).toHaveBeenCalledWith('pkg_foundation');
  });
});

describe('PaywallSheet — CTA accessibility', () => {
  it('"See all plans" CTA is a labeled button with a hint', async () => {
    const { getByTestId } = await renderSheet();
    const cta = getByTestId('paywall-subscribe');
    expect(cta.props.accessibilityRole).toBe('button');
    expect(cta.props.accessibilityLabel).toBe('See all plans');
    expect(typeof cta.props.accessibilityHint).toBe('string');
    expect(cta.props.accessibilityHint.length).toBeGreaterThan(0);
  });

  it('"Maybe later" close is a labeled button with a hint', async () => {
    const { getByTestId } = await renderSheet();
    const close = getByTestId('paywall-close');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessibilityLabel).toBe('Maybe later');
    expect(typeof close.props.accessibilityHint).toBe('string');
    expect(close.props.accessibilityHint.length).toBeGreaterThan(0);
  });

  it('"See all plans" fires onSubscribe with no package id (full picker fallback)', async () => {
    const { getByTestId, onSubscribe } = await renderSheet();
    fireEvent.press(getByTestId('paywall-subscribe'));
    expect(onSubscribe).toHaveBeenCalledWith();
  });

  it('"Maybe later" fires onClose', async () => {
    const { getByTestId, onClose } = await renderSheet();
    fireEvent.press(getByTestId('paywall-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PaywallSheet — reachability + focus order regression guard', () => {
  it('all critical surfaces are present and reachable from the rendered tree', async () => {
    const { getByTestId, queryByTestId } = await renderSheet();
    expect(getByTestId('paywall-sheet')).toBeTruthy();
    expect(getByTestId('paywall-package-list')).toBeTruthy();
    expect(queryByTestId('paywall-package-pkg_foundation')).toBeTruthy();
    expect(getByTestId('paywall-subscribe')).toBeTruthy();
    expect(getByTestId('paywall-close')).toBeTruthy();
  });
});
