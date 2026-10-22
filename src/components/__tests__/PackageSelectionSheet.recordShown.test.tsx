/**
 * #836 fix round 1 (Sol B1, Opus C2): the unsolicited sheet (`recordShown`)
 * saves its 24 h time the moment it opens, so the offer is limited by
 * presentations, not by Skip taps. Closing the app, Skip (Back runs the same
 * handler) or an empty list never brings it back inside 24 h; RENEWAL-M: nor later (the first offer opens once). A
 * deliberate open (no `recordShown`) saves nothing; `skipSnoozeCheck` (renewal) opens inside the 24 h wait; `house`
 * reads the house coach's packages under his name. Real sheet, real
 * start gate and real storage; only the network edges are mocked.
 */
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ tokens: t.default, semanticColors: t.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', role: 'student' }) }));
let mockPackages: unknown[] = [];
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => {
      if (url === '/v1/clients/me/coach/packages') return { data: { packages: mockPackages } };
      if (url === '/v1/clients/me/coach') return { data: { id: 'coach-1', name: 'Avery Stone' } };
      if (url === '/v1/checkout/renewal/house-coach/packages') return { data: { packages: [{ ...mockPackages[0] as object, id: 'h-1' }] } };
      throw new Error(`unexpected read ${url}`);
    },
    post: async () => ({ data: {} }),
  },
}));
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({ busy: false, state: { phase: 'idle' }, clearNotice: jest.fn(), start: jest.fn() }),
}));
const mockGetEntitlement = jest.fn(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
jest.mock('../../api/clientPaymentsApi', () => ({ clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() } }));
jest.mock('../../lib/userCache', () => ({ readUserCache: async () => ({ id: 'client-1', coach_id: 'coach-1' }) }));
jest.mock('../../entitlements/dunning/dunningApi', () => ({
  dunningApi: { getStatus: async () => ({ enabled: true, state: 'none' }) },
}));
jest.mock('../../tutorial/tutorialStore', () => ({
  useTutorialStore: { getState: () => ({ pendingStart: null, userId: null, tutorial: { status: 'not_started' } }) },
}));

const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;
const { packagePromptDueAtStart } = require('../../lib/packagePromptGate') as typeof import('../../lib/packagePromptGate');

const KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-1';
const NOW = Date.parse('2026-10-20T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const PACKAGES = [{ id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' }];
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const mount = (onDismiss: () => void, recordShown?: boolean, extra?: { skipSnoozeCheck?: boolean; house?: { name: string } }) =>
  render(<Sheet visible recordShown={recordShown} onDismiss={onDismiss} onPaymentSuccess={jest.fn()} {...extra} />);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  mockPackages = PACKAGES;
  setOS('ios');
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
  setOS(realOS);
});

it.each(['closing the app', 'Skip'])('%s after it was shown: no second offer inside 24 h, and none after', async (how) => {
  expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  mockGetEntitlement.mockClear();
  const first = await mount(jest.fn(), true);
  await first.findByTestId('package-card-p-1');
  expect(await AsyncStorage.getItem(KEY)).toBe(new Date(NOW).toISOString());
  if (how === 'Skip') await fireEvent.press(first.getByTestId('skip-package-btn'));
  first.unmount();

  // Next cold start inside 24 h: the start gate says no, without a read.
  expect(await packagePromptDueAtStart('client-1', NOW + 23 * HOUR)).toBe(false);
  expect(mockGetEntitlement).not.toHaveBeenCalled();
  // Any other unsolicited open inside 24 h closes itself before drawing.
  jest.setSystemTime(NOW + HOUR);
  const onDismiss = jest.fn();
  const again = await mount(onDismiss, true);
  await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  expect(again.queryByTestId('package-card-p-1')).toBeNull();
  again.unmount();

  // A day after it was shown: not offered again (RENEWAL-M: once, not daily), after one read.
  expect(await packagePromptDueAtStart('client-1', NOW + 25 * HOUR)).toBe(false);
  expect(mockGetEntitlement).toHaveBeenCalledTimes(1);
});

it('opened by the client (skipSnoozeCheck): opens inside the 24 h wait', async () => {
  await AsyncStorage.setItem(KEY, new Date(NOW - HOUR).toISOString());
  const onDismiss = jest.fn();
  const r = await mount(onDismiss, false, { skipSnoozeCheck: true });
  await r.findByTestId('package-card-p-1');
  expect(onDismiss).not.toHaveBeenCalled();
});

it('house coach (H2): his packages under his name, on Android too, with no read of the old coach', async () => {
  setOS('android');
  const r = await mount(jest.fn(), false, { skipSnoozeCheck: true, house: { name: 'Bradley Gleave' } });
  await r.findByTestId('package-card-h-1');
  expect(r.queryByTestId('package-card-p-1')).toBeNull();
  expect(r.getByTestId('package-sheet-one-to-one')).toHaveTextContent('1:1 coaching with Bradley Gleave');
});

it('empty list on first load: closes itself and still counts as shown (#836 C2)', async () => {
  mockPackages = [];
  const onDismiss = jest.fn();
  const r = await mount(onDismiss, true);
  await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  expect(await AsyncStorage.getItem(KEY)).toBe(new Date(NOW).toISOString());
  r.unmount();
  expect(await packagePromptDueAtStart('client-1', NOW + HOUR)).toBe(false);
  expect(mockGetEntitlement).not.toHaveBeenCalled();
});

it('deliberate open (no recordShown, Android "Choose a plan"): opening saves nothing', async () => {
  setOS('android');
  const r = await mount(jest.fn());
  await r.findByTestId('package-card-p-1');
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});
