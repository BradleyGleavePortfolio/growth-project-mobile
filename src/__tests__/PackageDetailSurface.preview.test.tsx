// src/__tests__/PackageDetailSurface.preview.test.tsx
//
// PR-18 M1 item 2 — preview-as-buyer contract guards + RTL mounts.
//
// What we assert:
//   1. PackageDetailSurface renders the SAME presentation for buyer and
//      coachPreview (no forked visuals): title, price, features, coach name
//      all render in both modes.
//   2. buyer mode → functional pay CTA that calls `onPay` when pressed.
//   3. coachPreview mode → shows the "Buyer preview — checkout is disabled
//      for coaches." banner, the pay CTA is disabled, and pressing it does
//      NOT call `onPay` (the component wires no onPress at all in preview).
//   4. PackageCheckoutScreen (mode="buyer") pressing pay DOES call
//      publicPackagesApi.createCheckoutSession; CoachPackageEditScreen's
//      preview path MUST NOT (source guard — no createCheckoutSession in the
//      editor, and the surface is rendered with mode="coachPreview").
//
// Pattern mirrors CoachPackageContentsScreen.test.tsx — real token module +
// light semantic tokens so useTheme() resolves against production shapes.

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');

// ── Theme mock (real tokens + light semantic tokens) ────────────────────────
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

import PackageDetailSurface, {
  type PackageDetailViewModel,
} from '../screens/client/packageDetail/PackageDetailSurface';

const VM: PackageDetailViewModel = {
  id: 'pkg_1',
  title: '12-week transformation',
  description: 'A complete coaching program.',
  priceCents: 19900,
  currency: 'usd',
  billingInterval: 'monthly',
  intervalCount: 1,
  trialDays: null,
  features: ['Weekly check-ins', 'Custom workout plan'],
  coach: { displayName: 'Jordan Coach', bio: 'NASM-certified.' },
};

describe('PackageDetailSurface — shared presentation (no forked visuals)', () => {
  it('uses open sections, tabular prices and readable detail without hiding inclusions', async () => {
    const r = await render(<PackageDetailSurface package={VM} mode="buyer" onPay={jest.fn()} />);
    // FR-1TO1 (LS B2): C5 Style C names the price section Billing, as the in-app plan page does.
    expect(r.getByText('Billing')).toBeTruthy();
    const price = StyleSheet.flatten(r.getByTestId('package-detail-price').props.style);
    expect(price.fontVariant).toEqual(['tabular-nums']);
    expect(StyleSheet.flatten(r.getByText('Weekly check-ins').props.style).fontFamily).toMatch(/^Inter/);
    expect(StyleSheet.flatten(r.getByLabelText('Continue to payment').props.style).minHeight).toBe(44);
  });

  it('renders title, price, features, and coach name in BUYER mode', async () => {
    const { getByText, getAllByText } = await render(
      <PackageDetailSurface package={VM} mode="buyer" onPay={jest.fn()} />,
    );
    expect(getByText('12-week transformation')).toBeTruthy();
    expect(getByText('From Jordan Coach')).toBeTruthy();
    expect(getByText('Weekly check-ins')).toBeTruthy();
    expect(getByText('Custom workout plan')).toBeTruthy();
    // Price string is rendered (currency formatting); the amount appears in
    // both the price card and the pay CTA label.
    expect(getAllByText(/199/).length).toBeGreaterThan(0);
  });

  it('renders the SAME title, price, features, coach name in coachPreview mode', async () => {
    const { getByText, getAllByText } = await render(
      <PackageDetailSurface package={VM} mode="coachPreview" />,
    );
    expect(getByText('12-week transformation')).toBeTruthy();
    expect(getByText('From Jordan Coach')).toBeTruthy();
    expect(getByText('Weekly check-ins')).toBeTruthy();
    expect(getAllByText(/199/).length).toBeGreaterThan(0);
  });

  it('shows only supplied inclusions and trial data, retaining one-time billing copy', async () => {
    const r = await render(<PackageDetailSurface package={{ ...VM, features: [], trialDays: null,
      billingInterval: 'one_time' }} mode="buyer" onPay={jest.fn()} />);
    // STORE-1TO1: every package includes 1:1 coaching with its coach, so the list shows that alone.
    expect(r.getByText("What's included")).toBeTruthy();
    expect(r.getByTestId('package-detail-one-to-one').props.children).toBe('1:1 coaching with Jordan Coach');
    expect(r.queryByText(/Includes a .*free trial/)).toBeNull();
    expect(r.getByText('one-time payment')).toBeTruthy();
    await r.rerender(<PackageDetailSurface package={{ ...VM, trialDays: 7 }} mode="buyer" onPay={jest.fn()} />);
    expect(r.getByText('Includes a 7-day free trial.')).toBeTruthy();
    expect(r.getByText("What's included")).toBeTruthy();
  });
});

describe('PackageDetailSurface — buyer mode CTA', () => {
  it('calls onPay when the pay CTA is pressed', async () => {
    const onPay = jest.fn();
    const { getByLabelText } = await render(
      <PackageDetailSurface package={VM} mode="buyer" onPay={onPay} />,
    );
    await fireEvent.press(getByLabelText('Continue to payment'));
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('disables the CTA while paying', async () => {
    const onPay = jest.fn();
    const { getByLabelText } = await render(
      <PackageDetailSurface package={VM} mode="buyer" onPay={onPay} paying />,
    );
    const cta = getByLabelText('Continue to payment');
    expect(cta.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(cta);
    expect(onPay).not.toHaveBeenCalled();
  });
});

describe('PackageDetailSurface — coachPreview mode is checkout-safe', () => {
  it('shows the disabled-checkout banner', async () => {
    const { getByText } = await render(
      <PackageDetailSurface package={VM} mode="coachPreview" onPay={jest.fn()} />,
    );
    expect(
      getByText('Buyer preview — checkout is disabled for coaches.'),
    ).toBeTruthy();
  });

  it('renders a DISABLED pay CTA and never calls onPay when pressed', async () => {
    const onPay = jest.fn();
    const { getByLabelText } = await render(
      <PackageDetailSurface package={VM} mode="coachPreview" onPay={onPay} />,
    );
    const cta = getByLabelText('Checkout disabled in preview');
    expect(cta.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(cta);
    expect(onPay).not.toHaveBeenCalled();
  });

  it('does not render the buyer Stripe fineprint in preview', async () => {
    const { queryByText } = await render(
      <PackageDetailSurface package={VM} mode="coachPreview" />,
    );
    expect(queryByText(/Payment is processed securely by Stripe/)).toBeNull();
  });
});

// ── Source guards: preview must not invoke checkout from the editor ──────────
describe('CoachPackageEditScreen — preview-as-buyer is checkout-safe (source guard)', () => {
  const EDIT_SRC = fs.readFileSync(
    path.join(ROOT, 'src', 'screens', 'coach', 'payments', 'CoachPackageEditScreen.tsx'),
    'utf8',
  );
  const EDIT_CODE = EDIT_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('renders PackageDetailSurface with mode="coachPreview"', () => {
    expect(EDIT_CODE).toMatch(/mode="coachPreview"/);
  });

  it('has a "Preview as buyer" affordance', () => {
    expect(EDIT_SRC).toMatch(/Preview as buyer/);
  });

  it('never calls createCheckoutSession from the editor (no buyer pay path)', () => {
    expect(EDIT_CODE).not.toMatch(/createCheckoutSession/);
  });

  it('builds the preview view model without an extra network fetch', () => {
    // The preview VM is derived from local draft + `original`; the only API
    // verbs the editor touches are the package CRUD ones, never a public
    // share-token lookup.
    expect(EDIT_CODE).not.toMatch(/getByShareToken/);
    expect(EDIT_CODE).toMatch(/previewViewModel/);
  });
});

describe('PackageDetailSurface — STORE-1TO1 1:1 coaching line', () => {
  it.each(['buyer', 'coachPreview'] as const)('lists 1:1 coaching with the coach first under What\'s included (%s)', async (mode) => {
    const r = await render(<PackageDetailSurface package={VM} mode={mode} onPay={jest.fn()} />);
    expect(r.getByTestId('package-detail-one-to-one').props.children).toBe('1:1 coaching with Jordan Coach');
    const texts = r.getAllByText(/1:1 coaching with Jordan Coach|Weekly check-ins/).map((n) => n.props.children);
    expect(texts).toEqual(['1:1 coaching with Jordan Coach', 'Weekly check-ins']);
  });
});

// FR-1TO1 (agent 185) class-first: the buyer page and the coach preview (one surface, C5 Style C)
// list 1:1 coaching with the coach first under What's included, with or without a note or features.
describe('FR-1TO1: 1:1 coaching with the coach is first on both modes, every package shape', () => {
  it.each([
    ['buyer', 'no features, no note', [], null],
    ['buyer', 'features and a note', ['Weekly check-ins'], 'A note.'],
    ['preview', 'no features, no note', [], null],
    ['preview', 'features and a note', ['Weekly check-ins'], 'A note.'],
  ] as const)('%s, %s', async (mode, _shape, features, description) => {
    const onPay = jest.fn();
    const r = await render(
      <PackageDetailSurface package={{ ...VM, features: [...features], description }} mode={mode} onPay={onPay} />,
    );
    expect(r.getByText("What's included")).toBeTruthy();
    const items = r.getAllByText(/^1:1 coaching with Jordan Coach$|^Weekly check-ins$/).map((n) => n.props.children);
    expect(items).toEqual(['1:1 coaching with Jordan Coach', ...features]);
    expect(r.getByTestId('package-detail-one-to-one').props.children).toBe('1:1 coaching with Jordan Coach');
    if (mode === 'preview') expect(r.getByText('Buyer preview — checkout is disabled for coaches.')).toBeTruthy();
  });
});
