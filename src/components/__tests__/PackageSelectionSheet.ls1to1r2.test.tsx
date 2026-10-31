import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ tokens: t.default, semanticColors: t.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: jest.fn(async () => undefined) },
}));
jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'synthetic-client', role: 'student' }),
}));
const mockStart = jest.fn();
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({
    busy: false, state: { phase: 'idle' }, clearNotice: jest.fn(), start: mockStart,
  }),
}));
let mockFailName = false;
const mockGet = jest.fn(async (url: string) => {
  if (url === '/v1/clients/me/coach/packages') return { data: { packages: [
    { id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd',
      billing_type: 'recurring', interval: 'month' },
  ] } };
  if (url === '/v1/clients/me/coach') {
    if (mockFailName) throw new Error('network');
    return { data: { id: 'coach-1', name: 'Avery Stone' } };
  }
  throw new Error(`unexpected read ${url}`);
});
jest.mock('../../services/api', () => ({
  __esModule: true, default: { get: (url: string) => mockGet(url) },
}));
const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
beforeEach(() => { jest.clearAllMocks(); mockFailName = false; });
afterEach(() => setOS(realOS));

async function select() {
  const r = await render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} />);
  await waitFor(() => expect(r.getByTestId('package-card-p-1')).toBeTruthy());
  await fireEvent.press(r.getByTestId('package-card-p-1'));
  return r;
}

it('ordinary iOS control: named coaching is disclosed before a purchase starts', async () => {
  setOS('ios');
  const r = await select();
  expect(r.getByText('1:1 coaching with Avery Stone')).toBeTruthy();
  await fireEvent.press(r.getByTestId('select-plan-btn'));
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('Android must disclose the named 1:1 coaching before the sheet can sell a plan', async () => {
  setOS('android');
  const r = await select();
  expect(r.getByTestId('select-plan-btn').props.accessibilityState.disabled).toBe(false);
  expect(r.getByText('1:1 coaching with Avery Stone')).toBeTruthy();
});

it('a failed iOS coach-name read must not start a sheet purchase with an unnamed coach', async () => {
  setOS('ios');
  mockFailName = true;
  const r = await select();
  expect(r.getByText('1:1 coaching with your coach')).toBeTruthy();
  await fireEvent.press(r.getByTestId('select-plan-btn'));
  expect(mockStart).not.toHaveBeenCalled();
});
