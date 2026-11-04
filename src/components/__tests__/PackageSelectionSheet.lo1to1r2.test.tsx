/**
 * LO-1TO1R2 B1 (m#907 round 2): the unsolicited plan sheet (PackageSelectionSheet: the
 * sign-in package prompt, Day 1, renewal and house sheets) is an in-app sale path. On iOS,
 * when the coach-name read fails, it still sells under "1:1 coaching with your coach":
 * the class LS-1TO1 B1 closed on ClientPackages (a failed coach-name read keeps Buy not
 * enabled). Fails at 3b3f527d: the purchase starts with the coach unnamed.
 */
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
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'synthetic-client', role: 'student' }) }));
const PACKAGES = [
  { id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' },
];
const mockGet = jest.fn(async (url: string) => {
  if (url === '/v1/clients/me/coach/packages') return { data: { packages: PACKAGES } };
  if (url === '/v1/clients/me/coach') throw new Error('network');
  throw new Error(`unexpected read ${url}`);
});
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: (url: string) => mockGet(url) } }));
const mockStart = jest.fn();
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({ busy: false, state: { phase: 'idle' }, clearNotice: jest.fn(), start: mockStart }),
}));

const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
afterEach(() => setOS(realOS));

// 1TO1-FU-M (#186-P4 op 1, which replaces LO-1TO1R2 B1's no-sale rule on the plan sheet): when only the coach's
// name fails to load there is no error; the line reads "1:1 coaching with your coach" and the plan can be chosen.
it('iOS, a failed coach-name read: the your-coach line, no error, and the plan can still be chosen', async () => {
  setOS('ios');
  const r = await render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} />);
  await waitFor(() => expect(r.getByTestId('package-card-p-1')).toBeTruthy());
  await fireEvent.press(r.getByTestId('package-card-p-1'));
  expect(r.getByText('1:1 coaching with your coach')).toBeTruthy();
  expect(r.queryByText(/could not load/)).toBeNull();
  await fireEvent.press(r.getByTestId('select-plan-btn'));
  expect(mockStart).toHaveBeenCalledTimes(1);
});
