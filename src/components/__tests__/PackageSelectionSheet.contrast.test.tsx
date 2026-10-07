/**
 * B-SHEET-118 (agent 118):
 *   B-343-5        the selected card keeps its payment terms AA-readable (4.5:1)
 *                  in light and dark.
 *   B-343-1 (Opus) while an unclear one-time result is read, the sheet says
 *                  "Checking", never "Payment received".
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { lightTokens, darkTokens } from '../../theme/tokens';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../theme/tokens');
  return {
    useTheme: () => ({
      tokens: t.default,
      semanticColors: mockScheme === 'dark' ? t.darkTokens : t.lightTokens,
      colorScheme: mockScheme,
    }),
  };
});
jest.mock('../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: jest.fn(async () => undefined) },
}));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'synthetic-client', role: 'student' }) }));
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({
      data: { packages: [{ id: 'p-1', name: 'Synthetic recurring', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' }] },
    })),
  },
}));
let mockState: Record<string, unknown> = { phase: 'idle' };
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({ busy: false, state: mockState, clearNotice: jest.fn(), start: jest.fn() }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

it.each(['light', 'dark'] as const)('B-343-5 %s: selected card terms are at least 4.5:1', async (scheme) => {
  mockScheme = scheme;
  mockState = { phase: 'idle' };
  const r = await render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} />);
  await waitFor(() => expect(r.getByTestId('package-card-p-1')).toBeTruthy());
  const sc = scheme === 'dark' ? darkTokens : lightTokens;
  expect(StyleSheet.flatten(r.getByTestId('select-plan-btn').props.style).backgroundColor).toBe(sc.disabledBg);
  expect(StyleSheet.flatten(r.getByText('Select this plan').props.style).color).toBe(sc.textOnDisabled);
  await fireEvent.press(r.getByTestId('package-card-p-1'));
  const card = StyleSheet.flatten(r.getByTestId('package-card-p-1').props.style);
  const fg = luminance(StyleSheet.flatten(r.getByTestId('plan-terms-first-charge').props.style).color);
  const bg = luminance(card.backgroundColor);
  expect((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(card.borderTopWidth).toBe(2);
  expect(StyleSheet.flatten(r.getByText('Synthetic recurring').props.style).fontFamily).toMatch(/^Cormorant/);
  expect(StyleSheet.flatten(r.getAllByText('$49.00 a month')[0].props.style).fontVariant).toEqual(['tabular-nums']);
  expect(StyleSheet.flatten(r.getByTestId('select-plan-btn').props.style).minHeight).toBe(44);
});

it('keeps radio selection, Skip and native sheet dismissal available', async () => {
  mockScheme = 'light';
  mockState = { phase: 'idle' };
  const onDismiss = jest.fn();
  const r = await render(<Sheet visible onDismiss={onDismiss} onPaymentSuccess={jest.fn()} />);
  await waitFor(() => expect(r.getByRole('radio')).toBeTruthy());
  await fireEvent.press(r.getByRole('radio'));
  expect(r.getByRole('radio').props.accessibilityState.selected).toBe(true);
  await fireEvent.press(r.getByTestId('skip-package-btn'));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  await fireEvent(r.getByRole('radio'), 'requestClose');
  expect(onDismiss).toHaveBeenCalledTimes(2);
});

it('B-343-1 (Opus): an unclear one-time result is shown as checking', async () => {
  mockScheme = 'light';
  mockState = { phase: 'confirming', saleKind: 'one_time', checking: true, notice: null };
  const r = await render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} />);
  await waitFor(() => expect(r.getByTestId('payment-confirming')).toBeTruthy());
  expect(r.getByTestId('payment-confirming').props.children).toBe('Checking whether the payment went through.');
  expect(r.queryByText(/Payment received/)).toBeNull();
});
