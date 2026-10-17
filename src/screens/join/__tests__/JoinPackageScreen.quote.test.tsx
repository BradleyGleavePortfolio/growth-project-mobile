/**
 * FIX712 (agent 144): the join-code screen shows what is due today and a
 * trial's first charge date only from the join's server `quote` (backend
 * #1002), in the plan screens' words; none without one. "Finish joining"
 * never shows the saved quote: it re-reads the join with
 * POST /auth/attach-invite-code first, and a `granted` answer is a finished join.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { JoinOutcome } from '../../../lib/joinPackage';
import { presentJoinFrom, readPendingJoin, takePresentedJoin } from '../../../lib/joinPackage';
import JoinPackageScreen from '../JoinPackageScreen';

const mockStart = jest.fn();
const mockRefresh = jest.fn(async () => true);
const mockAttach = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn(async (_p: unknown) => {});
jest.mock('../../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({
    state: { phase: 'idle', notice: null, priceChange: null, alreadyActive: null, slowMessage: null, success: null },
    busy: false,
    start: mockStart,
    reset: jest.fn(),
  }),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a) },
  authApi: {
    attachInviteCode: (...a: unknown[]) => mockAttach(...a),
    getSignupPolicy: async () => ({ data: { coach_sharing_notice: 'coach_sharing_join_v1' } }),
  },
}));
jest.mock('../../../api/coachSharingApi', () => ({ acceptFirstSignInSharing: jest.fn(async () => true) }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (p: unknown) => mockPatch(p) }));

const OLD = '2026-10-20T12:00:00.000Z';
const NEXT = '2026-11-16T12:00:00.000Z';
const TRIAL_END = '2026-10-30T12:00:00.000Z';
const quote = (due: number, first: string | null, trialEnd: string | null = null) => ({
  due_today_cents: due, currency: 'usd', first_charge_at: first, trial_end: trialEnd,
});
type Quote = ReturnType<typeof quote> | null;
const MONTHLY: JoinOutcome = {
  status: 'checkout_required',
  grant_mode: 'none',
  package: {
    id: 'pkg-1', name: 'Strength coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring',
    interval: 'month', interval_count: 1, recurring_amount_cents: null, recurring_interval: null,
    recurring_interval_count: null, trial_days: 0, is_free: false,
  },
  coach: { id: 'coach-1', first_name: 'Sam' },
  code: 'GP-SAM',
};
const TRIAL: JoinOutcome = { ...MONTHLY, package: { ...MONTHLY.package, id: 'pkg-trial', trial_days: 14 } };
const COMBO: JoinOutcome = {
  ...MONTHLY,
  package: {
    ...MONTHLY.package, id: 'pkg-combo', amount_cents: 20000, billing_type: 'one_time', interval: null,
    recurring_amount_cents: 14900, recurring_interval: 'month', recurring_interval_count: 1,
  },
};
const withQuote = (j: JoinOutcome, q: Quote): JoinOutcome => ({ ...j, package: { ...j.package, quote: q } });

const onClose = jest.fn();
type UI = Awaited<ReturnType<typeof render>>;
const texts = (ui: UI): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') walk((n as { children?: unknown }).children);
  };
  walk(ui.toJSON());
  return out.join(' ');
};
const firstCharge = (ui: UI) => ui.queryByTestId('plan-terms-first-charge')?.props.children ?? null;
const pay = (ui: UI) => fireEvent.press(ui.getByTestId('join-package-pay'));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  jest.clearAllMocks();
  takePresentedJoin();
  await AsyncStorage.clear();
});

it.each([
  ['monthly', withQuote(MONTHLY, quote(4900, NEXT)),
    'You pay $49.00 today for your first month. Your next charge of $49.00 is on November 16, 2026.'],
  ['trial', withQuote(TRIAL, quote(0, TRIAL_END, TRIAL_END)),
    'Free for 14 days, then your first charge of $49.00 is on October 30, 2026. ' +
      'Your card is saved today and not charged. Cancel before then and you are never charged.'],
  ['one-time + recurring', withQuote(COMBO, quote(34900, NEXT)),
    'You pay $349.00 today: $200.00 once plus your first month at $149.00. ' +
      'Your next charge of $149.00 is on November 16, 2026.'],
  ['one-time + recurring, the server number repeated', withQuote(COMBO, quote(12345, NEXT)),
    'You pay $123.45 today: $200.00 once plus your first month at $149.00. ' +
      'Your next charge of $149.00 is on November 16, 2026.'],
] as const)('with a quote (%s): due today and the date are the server quote', async (_k, join, line) => {
  const ui = await render(<JoinPackageScreen join={join} onClose={onClose} />);
  expect(firstCharge(ui)).toBe(line);
  expect(ui.getByTestId('plan-terms-renewal')).toBeTruthy();
  expect(mockAttach).not.toHaveBeenCalled(); // a join just answered is not re-read
});

it.each([
  ['monthly', MONTHLY], ['trial', TRIAL], ['one-time + recurring', COMBO], ['quote null', withQuote(MONTHLY, null)],
] as const)('no quote (%s): no due-today line or date; price, renewal and a live pay button stay', async (_k, j) => {
  const ui = await render(<JoinPackageScreen join={j} onClose={onClose} />);
  expect(firstCharge(ui)).toBeNull();
  expect(ui.getByTestId('join-package-price')).toBeTruthy();
  expect(ui.getByTestId('plan-terms-renewal')).toBeTruthy();
  expect(texts(ui)).not.toMatch(/today|first charge of|next charge of/);
  await pay(ui);
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ id: j.package.id, quote: null }));
});

describe('Finish joining: a resumed pending join never shows the old saved values', () => {
  async function savedDaysAgo(join: JoinOutcome): Promise<JoinOutcome> {
    presentJoinFrom({ coach_id: null, already_attached: false, join });
    takePresentedJoin(); // closed with "Not now"
    await settle();
    const saved = await readPendingJoin();
    expect(saved?.package.quote).toBeUndefined(); // the saved quote is dropped
    return saved as JoinOutcome;
  }

  it('re-reads the join; nothing old shows meanwhile; then only the answer of now', async () => {
    const saved = await savedDaysAgo(withQuote(MONTHLY, quote(4900, OLD)));
    let answer: (v: unknown) => void = () => {};
    mockAttach.mockReturnValue(new Promise((r) => { answer = r; }));
    const ui = await render(<JoinPackageScreen join={saved} resumed onClose={onClose} />);
    await waitFor(() => expect(mockAttach).toHaveBeenCalledWith('GP-SAM'));
    expect(firstCharge(ui)).toBeNull();
    expect(texts(ui)).not.toMatch(/October 20, 2026|today/);
    expect(ui.getByTestId('join-package-pay-spinner')).toBeTruthy(); // pay waits for the answer
    await pay(ui);
    expect(mockStart).not.toHaveBeenCalled();
    expect(ui.getByTestId('join-package-not-now')).toBeTruthy();
    // The coach changed the price since.
    const fresh = withQuote({ ...MONTHLY, package: { ...MONTHLY.package, amount_cents: 5900 } }, quote(5900, NEXT));
    await act(async () => answer({ data: { role: 'student', coach_id: null, already_attached: false, join: fresh } }));
    await settle();
    expect(firstCharge(ui)).toBe(
      'You pay $59.00 today for your first month. Your next charge of $59.00 is on November 16, 2026.',
    );
    expect(texts(ui)).not.toMatch(/\$49\.00|October 20, 2026/);
    await pay(ui);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ amountCents: 5900, quote: { dueTodayCents: 5900, firstChargeAt: NEXT } });
    await waitFor(async () => expect((await readPendingJoin())?.package.amount_cents).toBe(5900));
    expect(mockPost).not.toHaveBeenCalled(); // never the coachless redeem
    expect(mockPatch).not.toHaveBeenCalled(); // a paid join is not attached
  });

  it('a trial whose re-read fails shows no stale first charge date; pay stays live', async () => {
    const saved = await savedDaysAgo(withQuote(TRIAL, quote(0, OLD, OLD)));
    mockAttach.mockRejectedValue(new Error('offline'));
    const ui = await render(<JoinPackageScreen join={saved} resumed onClose={onClose} />);
    await settle();
    expect(firstCharge(ui)).toBeNull();
    expect(texts(ui)).not.toMatch(/October 20, 2026/);
    expect(ui.getByTestId('join-package-price').props.children).toBe('$49.00 a month, 14-day free trial');
    await pay(ui);
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'pkg-trial', quote: null }));
  });

  it.each([
    ['free', 'This package is free'],
    ['prepaid', 'This package is paid for'],
  ] as const)('the code became %s: the granted answer is a finished join, no payment', async (mode, title) => {
    const saved = await savedDaysAgo(withQuote(MONTHLY, quote(4900, OLD)));
    const granted = { ...withQuote(MONTHLY, null), status: 'granted', grant_mode: mode };
    mockAttach.mockResolvedValue({ data: { role: 'student', coach_id: 'coach-1', already_attached: false, join: granted } });
    const ui = await render(<JoinPackageScreen join={saved} resumed onClose={onClose} />);
    await settle();
    expect(ui.getByTestId('join-package-title').props.children).toBe(title);
    expect(ui.queryByTestId('join-package-pay')).toBeNull();
    expect(ui.queryByTestId('plan-terms')).toBeNull();
    expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1' });
    expect(await readPendingJoin()).toBeNull();
    await fireEvent.press(ui.getByTestId('join-package-start'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
