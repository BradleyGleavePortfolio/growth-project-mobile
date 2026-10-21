/**
 * #836 fix round 1 (Sol B1, Opus C2): the unsolicited sheet (`recordShown`)
 * saves its 24 h time the moment it opens, so the offer is limited by
 * presentations, not by Skip taps. Closing the app, Skip (Back runs the same
 * handler) or an empty list never brings it back inside 24 h; RENEWAL-M: with `onShown` wired as RootNavigator
 * wires it, a client who never bought is not offered it again (never daily). A deliberate open (no `recordShown`)
 * saves nothing; a plan_renewal push tap (`skipSnoozeCheck`) opens it inside the 24 h wait. Real sheet, real
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
const { packagePromptDueAtStart, takeStartOffer } = require('../../lib/packagePromptGate') as typeof import('../../lib/packagePromptGate');
const { recordRenewalShown } = require('../../lib/planRenewal') as typeof import('../../lib/planRenewal');

const KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-1';
const NOW = Date.parse('2026-10-20T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const PACKAGES = [{ id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' }];
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const mount = (onDismiss: () => void, recordShown?: boolean, extra?: { onShown?: () => void; skipSnoozeCheck?: boolean }) =>
  render(<Sheet visible recordShown={recordShown} onDismiss={onDismiss} onPaymentSuccess={jest.fn()} {...extra} />);
// RootNavigator's onShown: the start offer is recorded as shown (lib/planRenewal).
const rootOnShown = () => void recordRenewalShown('client-1', takeStartOffer('client-1')?.renewal);

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
  const first = await mount(jest.fn(), true, { onShown: rootOnShown });
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

it('a plan_renewal push tap (skipSnoozeCheck): opens inside the 24 h wait and reports it was shown once', async () => {
  await AsyncStorage.setItem(KEY, new Date(NOW - HOUR).toISOString());
  const onShown = jest.fn();
  const r = await mount(jest.fn(), true, { onShown, skipSnoozeCheck: true });
  await r.findByTestId('package-card-p-1');
  expect(onShown).toHaveBeenCalledTimes(1);
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
