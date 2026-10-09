/**
 * FOOD-GATE-RETRY-130 (AUD-FIN-FOOD-129 B2 and G1).
 *
 * B2: a paying client opens the app on weak gym signal and taps Food. The
 * first access check fails, and the gate used to say "Choose a Plan"
 * (Android) or "Your coach manages your access" (iOS) with no way to retry,
 * so no food could be logged until the app was reopened with signal. Now the
 * gate says the check failed and offers Try again, which re-runs the check.
 * It stays closed until the server confirms access.
 *
 * G1: the coachless gate no longer promises that joining a coach alone
 * starts logging, and no longer assumes a coach who gave a code.
 *
 * The real EntitlementProvider, withProtectedScreen and ProtectedScreen run;
 * only the network, the user, the user cache and the iOS purchase flag are mocked.
 */
import React from 'react';
import { AppState, AppStateStatus, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CurrentUser } from '../hooks/useCurrentUser';

let mockUser: CurrentUser;
let mockHidden = false;

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
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getEntitlement: jest.fn(),
    getPackages: jest.fn().mockResolvedValue({ ok: true, data: [] }),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../lib/userCache', () => ({
  readUserCacheSync: () => null,
  patchUserCache: async () => undefined,
}));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  nonP2PPurchasesHidden: () => mockHidden,
}));

import { EntitlementProvider } from '../entitlements/EntitlementProvider';
import { withProtectedScreen } from '../entitlements/withProtectedScreen';
import {
  COACH_MANAGED_TITLE, COACHLESS_BODY, COACHLESS_CTA, COACHLESS_TITLE,
} from '../entitlements/PaywallSheet';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const getEntitlement = clientPaymentsApi.getEntitlement as jest.Mock;
const ACTIVE = { ok: true, data: { active: true } };
const INACTIVE = { ok: true, data: { active: false } };
const WEAK_SIGNAL = { ok: false, reason: 'error', message: 'timeout of 30000ms exceeded' };
const CHECK_FAILED_TITLE = 'Your access could not be checked';
const CHECK_FAILED_BODY = 'Check the connection, then try again.';
const COACHED: CurrentUser = { id: 'client-1', email: 'client@example.test', role: 'student', coach_id: 'coach-1' };
const COACHLESS: CurrentUser = { id: 'client-2', email: 'solo@example.test', role: 'student' };

function FoodLog() {
  return <Text testID="food-log">Breakfast</Text>;
}
const ProtectedFood = withProtectedScreen(FoodLog);

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

function mount(onMessageCoach: (openCoachCode?: boolean) => void = jest.fn()) {
  return render(
    <EntitlementProvider onMessageCoach={onMessageCoach}>
      <ProtectedFood />
    </EntitlementProvider>,
  );
}

beforeEach(() => {
  getEntitlement.mockReset();
  mockUser = COACHED;
  mockHidden = false;
  appStateHandler = null;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: AppStateStatus) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Food gate when the first access check fails (B2)', () => {
  it.each([
    ['Android, coached', false, COACHED],
    ['iOS, coached', true, COACHED],
    ['coachless', false, COACHLESS],
  ])('%s: says the check failed and offers Try again; Food stays closed', async (_label, hidden, user) => {
    mockHidden = hidden;
    mockUser = user;
    getEntitlement.mockResolvedValueOnce(WEAK_SIGNAL);
    const r = await mount();

    expect(await r.findByText(CHECK_FAILED_TITLE)).toBeTruthy();
    expect(r.getByText(CHECK_FAILED_BODY)).toBeTruthy();
    expect(r.getByTestId('protected-screen-try-again')).toBeTruthy();
    expect(r.queryByTestId('food-log')).toBeNull();
    expect(r.queryByText('Choose a Plan')).toBeNull();
    expect(r.queryByText(COACH_MANAGED_TITLE)).toBeNull();
    expect(r.queryByText(COACHLESS_TITLE)).toBeNull();
    expect(r.queryByTestId('protected-screen-view-plans')).toBeNull();
    expect(getEntitlement).toHaveBeenCalledTimes(1);
  });

  it('Try again re-runs the check, shows the spinner meanwhile, and opens Food once access is confirmed', async () => {
    let answer: (v: unknown) => void = () => {};
    getEntitlement
      .mockResolvedValueOnce(WEAK_SIGNAL)
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const r = await mount();

    await fireEvent.press(await r.findByTestId('protected-screen-try-again'));
    expect(getEntitlement).toHaveBeenCalledTimes(2);
    expect(r.getByTestId('protected-screen-loading')).toBeTruthy();
    expect(r.queryByTestId('protected-screen-try-again')).toBeNull();
    expect(r.queryByTestId('food-log')).toBeNull();

    await act(async () => { answer(ACTIVE); });
    expect(r.getByTestId('food-log')).toBeTruthy();
    expect(r.queryByText(CHECK_FAILED_TITLE)).toBeNull();
  });

  it('a Try again that fails again keeps Food closed and keeps Try again', async () => {
    getEntitlement.mockResolvedValue(WEAK_SIGNAL);
    const r = await mount();

    await fireEvent.press(await r.findByTestId('protected-screen-try-again'));
    await waitFor(() => expect(getEntitlement).toHaveBeenCalledTimes(2));
    expect(await r.findByTestId('protected-screen-try-again')).toBeTruthy();
    expect(r.getByText(CHECK_FAILED_TITLE)).toBeTruthy();
    expect(r.queryByTestId('food-log')).toBeNull();
  });

  it.each([
    ['Android', false, 'Choose a Plan'],
    ['iOS', true, COACH_MANAGED_TITLE],
  ])('%s: a Try again answered "no plan" shows the usual gate', async (_label, hidden, title) => {
    mockHidden = hidden;
    getEntitlement.mockResolvedValueOnce(WEAK_SIGNAL).mockResolvedValueOnce(INACTIVE);
    const r = await mount();

    await fireEvent.press(await r.findByTestId('protected-screen-try-again'));
    expect(await r.findByText(title)).toBeTruthy();
    expect(r.queryByText(CHECK_FAILED_TITLE)).toBeNull();
    expect(r.queryByTestId('food-log')).toBeNull();
  });

  it('a later check that fails after a "no plan" answer says the check failed, not "Choose a Plan"', async () => {
    // For example a client who has just bought a plan and comes back on weak signal.
    getEntitlement
      .mockResolvedValueOnce(INACTIVE)
      .mockResolvedValueOnce(WEAK_SIGNAL)
      .mockResolvedValueOnce(ACTIVE);
    const r = await mount();
    expect(await r.findByText('Choose a Plan')).toBeTruthy();

    await act(async () => {
      appStateHandler?.('background');
      appStateHandler?.('active');
    });
    expect(await r.findByText(CHECK_FAILED_TITLE)).toBeTruthy();
    expect(r.queryByText('Choose a Plan')).toBeNull();
    expect(r.queryByTestId('food-log')).toBeNull();

    await fireEvent.press(r.getByTestId('protected-screen-try-again'));
    expect(await r.findByTestId('food-log')).toBeTruthy();
    expect(getEntitlement).toHaveBeenCalledTimes(3);
  });
});

// CLIENT-POLISH-134 item 5 (B22/B24): the real Food route is open to a
// coachless client (withProtectedScreen(LogScreen, OWN), see
// coachlessNeverGated134). This default wrapper stands for a coach-only screen.
describe('Coachless gate copy on a coach-only screen (G1)', () => {
  it.each([
    ['Android', false],
    ['iOS', true],
  ])('%s: promises only what exists and offers Join a coach', async (_label, hidden) => {
    mockHidden = hidden;
    mockUser = COACHLESS;
    getEntitlement.mockResolvedValue(INACTIVE);
    const onMessageCoach = jest.fn();
    const r = await mount(onMessageCoach);

    expect(await r.findByText('This part comes with a coach')).toBeTruthy();
    expect(r.getByText('It opens once you join a coach. Each coach sets up what their coaching includes.')).toBeTruthy();
    // The same lines sit in front of every gated screen, on iOS too (App Review 3.1.1): no sale framing.
    for (const line of [COACHLESS_TITLE, COACHLESS_BODY]) {
      expect(line).not.toMatch(/plan|package|price|buy|subscribe|unlock/i);
    }
    expect(r.queryByTestId('food-log')).toBeNull();

    await fireEvent.press(r.getByText(COACHLESS_CTA));
    expect(onMessageCoach).toHaveBeenCalledWith(true);
  });
});
