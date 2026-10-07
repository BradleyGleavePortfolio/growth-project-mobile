/**
 * Fix round #304 B1 (App Review 3.1.1): the feature paywall in front of
 * Roman, Community, Log, Workouts and the other protected screens must not
 * sell a package or show a Subscribe CTA on hidden iOS builds. It says
 * "Your coach manages your access" and offers "Message your coach".
 *
 * Real gate (no purchasesHidden prop injected), __DEV__ false (release):
 *   hidden row: iOS + bundle flag true + native build 6
 *   shown row:  Android (packages still listed; unchanged behaviour)
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockState: { flag: boolean; build: string | null } = { flag: true, build: '6' };
let mockCoachId: string | undefined = 'coach-1';
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k === 'iosHideNonP2PPurchases' ? mockState.flag : (t as Record<string | symbol, unknown>)[k]),
    }),
  };
});
jest.mock('expo-application', () => ({
  get nativeBuildVersion() {
    return mockState.build;
  },
}));
jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      background: '#F5EFE4',
      surface: '#F1E8D5',
      border: '#E0D8C8',
      textPrimary: '#1A1A18',
      textSecondary: '#6B6B6B',
      textOnPrimary: '#FFFFFF',
      cardShadow: 'rgba(0,0,0,0.4)',
    },
    tokens: {
      typography: {
        h2: { fontSize: 24 },
        h4: { fontSize: 17 },
        body: { fontSize: 16 },
        bodyMd: { fontSize: 16, fontWeight: '500' },
        bodySmall: { fontSize: 14 },
      },
    },
  }),
}));
const PKG = {
  id: 'pkg_1',
  name: '1:1 Coaching',
  description: 'Weekly check-ins',
  type: 'recurring',
  price: 199,
  currency: 'USD',
  interval: 'month',
  trial_days: null,
  features: [],
};
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getEntitlement: jest.fn(),
    getPackages: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'a@b.com', role: 'student', coach_id: mockCoachId }),
}));
jest.mock('../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

import { EntitlementProvider } from '../entitlements/EntitlementProvider';
import { ProtectedScreen } from '../entitlements/ProtectedScreen';
import { entitlementEvents } from '../entitlements/entitlementEvents';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { COACH_MANAGED_TITLE } from '../entitlements/PaywallSheet';

const mockedGetEntitlement = clientPaymentsApi.getEntitlement as jest.Mock;
const mockedGetPackages = clientPaymentsApi.getPackages as jest.Mock;

const realOS = Platform.OS;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

const Paid = () => <Text testID="paid-content">Roman</Text>;

async function mountInactive(onMessageCoach = jest.fn(), onOpenPlans = jest.fn()) {
  mockedGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
  const r = await render(
    <EntitlementProvider onMessageCoach={onMessageCoach} onOpenPlans={onOpenPlans}>
      <ProtectedScreen>
        <Paid />
      </ProtectedScreen>
    </EntitlementProvider>,
  );
  await waitFor(() => expect(mockedGetEntitlement).toHaveBeenCalled());
  return { ...r, onMessageCoach, onOpenPlans };
}

async function emit402() {
  await act(async () => {
    entitlementEvents.emitRequired({
      status: 402,
      code: 'CLIENT_ENTITLEMENT_REQUIRED',
      message: 'Choose a plan to continue.',
    });
  });
}

beforeEach(() => {
  mockCoachId = 'coach-1';
  mockedGetEntitlement.mockReset();
  mockedGetPackages.mockReset();
  mockedGetPackages.mockResolvedValue({ ok: true, data: [PKG] });
  g.__DEV__ = false;
});
afterEach(() => {
  setOS(realOS);
  g.__DEV__ = realDev;
});

describe('hidden iOS build (flag true, native build 6)', () => {
  beforeEach(() => {
    setOS('ios');
    mockState.flag = true;
    mockState.build = '6';
  });

  it('the protected-screen gate shows coach-managed copy, not plans', async () => {
    const r = await mountInactive();
    await r.findByTestId('protected-screen-coach-managed');
    expect(r.queryByTestId('protected-screen-view-plans')).toBeNull();
    expect(r.queryByText(/Choose a Plan/i)).toBeNull();
    expect(r.queryByTestId('paid-content')).toBeNull();
    await fireEvent.press(r.getByTestId('protected-screen-message-coach'));
    expect(r.onMessageCoach).toHaveBeenCalledTimes(1);
    expect(r.onOpenPlans).not.toHaveBeenCalled();
  });

  it('a 402 opens the coach-managed sheet: no package list, no price, no Subscribe, server copy ignored', async () => {
    const r = await mountInactive();
    await emit402();
    await r.findByTestId('paywall-coach-managed');
    expect(r.getAllByText(COACH_MANAGED_TITLE).length).toBeGreaterThan(0);
    expect(r.queryByTestId('paywall-package-list')).toBeNull();
    expect(r.queryByTestId('paywall-package-pkg_1')).toBeNull();
    expect(r.queryByTestId('paywall-subscribe')).toBeNull();
    expect(r.queryByText(/USD/)).toBeNull();
    expect(r.queryByText('Choose a plan to continue.')).toBeNull();
    expect(r.queryByText(/unlock this feature/i)).toBeNull();
    expect(r.queryByText(/See all plans/i)).toBeNull();
    // The sheet never even fetches packages on a hidden build.
    expect(mockedGetPackages).not.toHaveBeenCalled();
  });

  it('Message your coach closes the sheet and opens the coach thread', async () => {
    const r = await mountInactive();
    await emit402();
    await fireEvent.press(await r.findByTestId('paywall-message-coach'));
    expect(r.onMessageCoach).toHaveBeenCalledTimes(1);
    expect(r.onMessageCoach).toHaveBeenCalledWith();
    await waitFor(() => expect(r.queryByTestId('paywall-coach-managed')).toBeNull());
    expect(r.onOpenPlans).not.toHaveBeenCalled();
  });

  it('an OTA bundle that flips the flag to false is still hidden on native build 6', async () => {
    mockState.flag = false;
    const r = await mountInactive();
    await emit402();
    await r.findByTestId('paywall-coach-managed');
    expect(r.queryByTestId('paywall-subscribe')).toBeNull();
  });

  it('a coachless gate requests code entry through the existing thread callback', async () => {
    mockCoachId = undefined;
    const r = await mountInactive();
    await fireEvent.press(await r.findByText('Enter a coach code'));
    expect(r.onMessageCoach).toHaveBeenCalledWith(true);
    await emit402();
    await fireEvent.press(r.getByTestId('paywall-message-coach'));
    expect(r.onMessageCoach).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(r.queryByTestId('paywall-coach-managed')).toBeNull());
  });
});

describe('Android (purchases shown): unchanged package paywall', () => {
  beforeEach(() => {
    setOS('android');
    mockState.flag = true;
  });

  it('lists packages and the plans CTA', async () => {
    const r = await mountInactive();
    await r.findByTestId('protected-screen-view-plans');
    await emit402();
    await r.findByTestId('paywall-package-pkg_1');
    expect(r.getByTestId('paywall-subscribe')).toBeTruthy();
    expect(r.queryByTestId('paywall-coach-managed')).toBeNull();
  });
});
