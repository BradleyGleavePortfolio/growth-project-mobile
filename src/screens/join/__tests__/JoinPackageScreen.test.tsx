/**
 * B-PACKAGE-135: the package a coach code carries. Free and prepaid say so
 * and Start; paid shows package, coach and price and pays through the shared
 * purchase flow with join_code; after the payment the user is re-read.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { JoinOutcome } from '../../../lib/joinPackage';
import { readPendingJoin, presentJoinFrom, takePresentedJoin } from '../../../lib/joinPackage';
import JoinPackageScreen from '../JoinPackageScreen';

const mockStart = jest.fn();
const mockReset = jest.fn();
const mockRefresh = jest.fn(async () => true);
const mockMe = jest.fn();
const mockPatch = jest.fn(async (_p: unknown) => {});
let mockPhase = 'idle';
let mockOptions: Record<string, unknown> = {};
jest.mock('../../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: (opts: Record<string, unknown>) => {
    mockOptions = opts;
    return {
      state: {
        phase: mockPhase, packageId: null, saleKind: 'subscription', notice: null, priceChange: null,
        alreadyActive: null, slowMessage: null, checking: false,
        success: mockPhase === 'success' ? { kind: 'subscription', title: 'Your plan is active', body: 'Paid.' } : null,
      },
      busy: false,
      start: mockStart,
      reset: mockReset,
      checkAgain: jest.fn(),
      confirmNewPrice: jest.fn(),
      clearNotice: jest.fn(),
    };
  },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  authApi: { me: () => mockMe(), getSignupPolicy: async () => ({ data: { coach_sharing_notice: 'coach_sharing_join_v1' } }) },
}));
const mockAccept = jest.fn(async (_v: string) => true);
jest.mock('../../../api/coachSharingApi', () => ({ acceptFirstSignInSharing: (v: string) => mockAccept(v) }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (p: unknown) => mockPatch(p) }));

const PAID: JoinOutcome = {
  status: 'checkout_required',
  grant_mode: 'none',
  package: {
    id: 'pkg-1', name: 'Strength coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring',
    interval: 'month', interval_count: 1, recurring_amount_cents: null, recurring_interval: null,
    recurring_interval_count: null, trial_days: 0, is_free: false,
  },
  coach: { id: 'coach-1', first_name: 'Bradley' },
  code: 'GP-BRADLEY',
};
const granted = (grant_mode: 'free' | 'prepaid'): JoinOutcome => ({
  ...PAID,
  status: 'granted',
  grant_mode,
  package: { ...PAID.package, name: 'Getting started', amount_cents: 0, billing_type: 'one_time', interval: null, is_free: true },
});

const onClose = jest.fn();
const texts = (ui: Awaited<ReturnType<typeof render>>): string[] => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') walk((n as { children?: unknown }).children);
  };
  walk(ui.toJSON());
  return out;
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockPhase = 'idle';
  takePresentedJoin();
  await AsyncStorage.clear();
});

it.each([
  ['free', 'This package is free', 'Getting started with Bradley. There is nothing to pay.'],
  ['prepaid', 'This package is paid for', 'Getting started with Bradley. There is nothing to pay in the app.'],
] as const)('%s: says so, names the coach, one Start that closes; never a payment', async (mode, title, body) => {
  const ui = await render(<JoinPackageScreen join={granted(mode)} onClose={onClose} />);
  expect(ui.getByTestId('join-package-title').props.children).toBe(title);
  expect(ui.getByTestId('join-package-body').props.children).toBe(body);
  expect(ui.getByText('1:1 coaching with Bradley')).toBeTruthy();
  expect(ui.queryByText('Continue to payment')).toBeNull();
  await act(async () => {
    fireEvent.press(ui.getByTestId('join-package-start'));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
  for (const t of texts(ui)) expect(t).not.toMatch(/!|\bI\b|\bwe\b|\bmy\b/);
});

it('paid: package, coach and price; Continue to payment buys THAT package with join_code', async () => {
  const ui = await render(<JoinPackageScreen join={PAID} onClose={onClose} />);
  expect(ui.getByTestId('join-package-title').props.children).toBe('Strength coaching');
  expect(ui.getByText('1:1 coaching with Bradley')).toBeTruthy();
  expect(ui.getByTestId('join-package-price').props.children).toMatch(/^\$49(\.00)? a month$/);
  expect(ui.getByText('Joining Bradley finishes when the payment goes through.')).toBeTruthy();
  expect(mockOptions.joinCode).toBe('GP-BRADLEY');
  await act(async () => {
    fireEvent.press(ui.getByTestId('join-package-pay'));
  });
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'pkg-1', amountCents: 4900, renewing: true }));
  for (const t of texts(ui)) expect(t).not.toMatch(/!|\bI\b|\bwe\b|\bmy\b/);
});

it('paid: Not now closes without a payment and keeps the pending join', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, join: PAID });
  const ui = await render(<JoinPackageScreen join={PAID} onClose={onClose} />);
  await act(async () => {
    fireEvent.press(ui.getByTestId('join-package-not-now'));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockStart).not.toHaveBeenCalled();
  expect((await readPendingJoin())?.code).toBe('GP-BRADLEY');
});

it('paid: after the payment the user is re-read; the pending join clears once the coach shows', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, join: PAID });
  mockPhase = 'success';
  mockMe.mockResolvedValue({ data: { id: 'u-1', coach_id: 'coach-1' } });
  const ui = await render(<JoinPackageScreen join={PAID} onClose={onClose} />);
  expect(ui.queryByTestId('join-package-pay')).toBeNull();
  expect(ui.queryByTestId('join-package-not-now')).toBeNull();
  await act(async () => {
    fireEvent.press(ui.getByTestId('payment-continue'));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockMe).toHaveBeenCalledTimes(1);
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1' });
  expect(await readPendingJoin()).toBeNull();
  expect(mockAccept).not.toHaveBeenCalled(); // no tap under the sharing sentence, nothing recorded
});

it('paid: the sharing sentence sits above Continue to payment; once me() shows the coach it is recorded once', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, join: PAID });
  mockMe.mockResolvedValue({ data: { id: 'u-1', coach_id: 'coach-1' } });
  const ui = await render(<JoinPackageScreen join={PAID} onClose={onClose} />);
  const notice = await ui.findByTestId('coach-sharing-notice');
  expect(notice.props.children).toMatch(/^Joining shares your workouts, food logs, weigh-ins and check-ins with Bradley\./);
  await act(async () => {
    fireEvent.press(ui.getByTestId('join-package-pay'));
  });
  mockPhase = 'success';
  await ui.rerender(<JoinPackageScreen join={PAID} onClose={onClose} />);
  await act(async () => {
    fireEvent.press(ui.getByTestId('payment-continue'));
  });
  await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
  expect(mockAccept).toHaveBeenCalledWith('coach_sharing_join_v1');
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1' });
});
