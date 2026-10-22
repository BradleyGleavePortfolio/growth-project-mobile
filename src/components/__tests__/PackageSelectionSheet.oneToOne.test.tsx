/**
 * #161-5 op 1: on iPhone the unsolicited sheet sells only 1:1 coaching. It
 * lists the client's own coach's packages (the ClientPackages list, every one
 * 1:1 coaching) and nothing else, under the ClientPackages label
 * oneToOneCoachingLabel(). Android is unchanged: no label, no extra read.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ tokens: t.default, semanticColors: t.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: jest.fn(async () => undefined) },
}));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'synthetic-client', role: 'student' }) }));
const PACKAGES = [
  { id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' },
  { id: 'p-2', name: '12-week block', amount_cents: 30000, currency: 'usd', billing_type: 'one_time' },
];
let mockCoach: () => Promise<unknown> = async () => ({ data: { id: 'coach-1', name: 'Avery Stone' } });
const mockGet = jest.fn(async (url: string) => {
  if (url === '/v1/clients/me/coach/packages') return { data: { packages: PACKAGES } };
  if (url === '/v1/clients/me/coach') return mockCoach();
  throw new Error(`unexpected read ${url}`);
});
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: (url: string) => mockGet(url) } }));
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({ busy: false, state: { phase: 'idle' }, clearNotice: jest.fn(), start: jest.fn() }),
}));

const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const mount = () => render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockCoach = async () => ({ data: { id: 'coach-1', name: 'Avery Stone' } });
});
afterEach(() => setOS(realOS));

it('iOS: the sheet lists only 1:1 packages, under the 1:1 coaching label', async () => {
  setOS('ios');
  const r = await mount();
  await waitFor(() => expect(r.getByTestId('package-sheet-one-to-one')).toBeTruthy());
  expect(r.getByTestId('package-sheet-one-to-one').props.children).toBe('1:1 coaching with Avery Stone');
  // Only the client's own coach's packages, each a plan to pick, and no other product.
  expect(r.getAllByRole('radio').map((c) => c.props.testID)).toEqual(['package-card-p-1', 'package-card-p-2']);
  expect(mockGet.mock.calls.map(([url]) => url).sort()).toEqual(['/v1/clients/me/coach', '/v1/clients/me/coach/packages']);
});

it('iOS: the coach name read fails, the label still says 1:1 coaching', async () => {
  setOS('ios');
  mockCoach = async () => { throw new Error('network'); };
  const r = await mount();
  await waitFor(() => expect(r.getByTestId('package-sheet-one-to-one')).toBeTruthy());
  expect(r.getByTestId('package-sheet-one-to-one').props.children).toBe('1:1 coaching with your coach');
  expect(r.getAllByRole('radio')).toHaveLength(2);
});

it('Android: unchanged, no label and no coach read', async () => {
  setOS('android');
  const r = await mount();
  await waitFor(() => expect(r.getAllByRole('radio')).toHaveLength(2));
  expect(r.queryByTestId('package-sheet-one-to-one')).toBeNull();
  expect(mockGet.mock.calls.map(([url]) => url)).toEqual(['/v1/clients/me/coach/packages']);
});
