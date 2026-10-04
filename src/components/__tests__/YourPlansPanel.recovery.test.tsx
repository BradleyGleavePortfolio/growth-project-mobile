/**
 * B-SHEET3-119 (agent 119) — mobile #344 Your plans: B-344-1..6 regressions.
 * Real panel, plan copy and error mapping; only transport, theme, Sentry,
 * Linking and the clipboard are mocked.
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../theme/tokens').default;
  return { useTheme: () => ({ tokens, semanticColors: tokens.lightTokens, colorScheme: 'light' }) };
});
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

import YourPlansPanel from '../purchase/YourPlansPanel';

const ID = 'purchase-1';
const PLAN = {
  purchase_id: ID, package_id: 'pkg-1', package_name: 'Monthly coaching', state: 'active',
  entitlement_active: true, amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1,
  next_charge_at: '2026-11-02T12:00:00.000Z', cancel_at_period_end: false, access_ends_at: null,
  can_cancel: true, can_resume: false,
};
const PAST_DUE = { ...PLAN, state: 'past_due' };
const ENDING = { ...PLAN, next_charge_at: null, cancel_at_period_end: true, access_ends_at: '2026-11-02T12:00:00.000Z', can_cancel: false, can_resume: true };
const ok = (plan: object) => ({ data: { plans: [plan] } });
const http = (status: number, data: object) =>
  Object.assign(new Error('synthetic'), { response: { status, data, headers: { 'x-request-id': 'ref12345-zz' } }, config: { headers: {} } });
const cancelResult = (o: object) => ({ data: { purchase_id: ID, voided_invoice_count: 0, voided_amount_cents: 0, currency: 'usd', paid_period_kept: false, message: 'x', ...o } });
const autoConfirm = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
    (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
  });
const line = (r: ReturnType<typeof render>) => r.getByTestId(`your-plan-line-${ID}`).props.children;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(ok(PLAN));
});
afterEach(() => jest.restoreAllMocks());

describe('B-344-1 the plan list never disappears silently', () => {
  it('a bare 404 (route absent on the production backend) says how to end a plan instead', async () => {
    mockGet.mockRejectedValue(http(404, { statusCode: 404, message: 'Cannot GET', error: 'Not Found' }));
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId('your-plans-unavailable')).toBeTruthy());
    expect(r.getByText(/not available in the app yet\. Message your coach/)).toBeTruthy();
    expect(r.queryByTestId('your-plans')).toBeNull();
  });
  it('a 503 says the list could not load, with Try again and Email support; Try again recovers', async () => {
    mockGet.mockRejectedValueOnce(http(503, { code: 'STRIPE_CHECKOUT_ERROR' }));
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId('your-plans-failed')).toBeTruthy());
    expect(r.getByText(/could not load your renewing plans.*quote reference ref12345/)).toBeTruthy();
    expect(r.getByRole('button', { name: 'Email support' })).toBeTruthy();
    await fireEvent.press(r.getByTestId('your-plans-retry'));
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
  });
});

describe('B-344-2/5 ending a plan during dunning', () => {
  it('the confirmation says access ends now and covers a payment that landed meanwhile', async () => {
    mockGet.mockResolvedValue(ok(PAST_DUE));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
    expect(line(r)).not.toMatch(/payment notice/);
    await fireEvent.press(r.getByTestId(`your-plan-end-${ID}`));
    expect(alert.mock.calls[0][0]).toBe('End this plan now?');
    expect(alert.mock.calls[0][1]).toMatch(/ends access now and cancels the unpaid charge.*went through in the meantime, access continues through the period it paid for/);
  });
  it('outcome ended: the voided amount is told and the ended plan stays on screen', async () => {
    mockGet.mockResolvedValueOnce(ok(PAST_DUE)).mockResolvedValue(ok({ ...PAST_DUE, state: 'ended', can_cancel: false }));
    mockPost.mockResolvedValue(cancelResult({ outcome: 'ended', access_ends_at: '2026-10-04T17:00:00.000Z', voided_invoice_count: 1, voided_amount_cents: 9900 }));
    autoConfirm();
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`your-plan-end-${ID}`));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(line(r)).toBe('This plan has ended, and access ended today. The unpaid $99.00 is canceled and is never collected. Nothing more is charged.');
    expect(r.queryByTestId(`your-plan-end-${ID}`)).toBeNull();
  });
  it('outcome scheduled after a payment landed meanwhile, then a failed reload: outcome kept, stale said', async () => {
    mockGet.mockResolvedValueOnce(ok(PAST_DUE)).mockRejectedValue(http(503, { code: 'X_DOWN' }));
    mockPost.mockResolvedValue(cancelResult({ outcome: 'scheduled', access_ends_at: '2026-11-02T12:00:00.000Z', paid_period_kept: true }));
    autoConfirm();
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`your-plan-end-${ID}`));
    await waitFor(() => expect(r.getByTestId('your-plans-stale')).toBeTruthy());
    expect(line(r)).toBe('The latest payment went through before the plan ended, so access continues until November 2, 2026, the period it paid for. Nothing more is charged after that.');
    expect(r.queryByTestId(`your-plan-end-${ID}`)).toBeNull();
  });
});

describe('B-344-3 the newest answer wins', () => {
  it('a confirmed resume shows the next charge even when the reload fails', async () => {
    mockGet.mockResolvedValueOnce(ok(ENDING)).mockRejectedValue(http(503, { code: 'X_DOWN' }));
    mockPost.mockResolvedValue({ data: PLAN });
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-keep-${ID}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`your-plan-keep-${ID}`));
    await waitFor(() => expect(r.getByTestId('your-plans-stale')).toBeTruthy());
    expect(line(r)).toBe('Next charge of $99.00 a month on November 2, 2026.');
  });
  it('an action resolving after unmount starts no new read (C-344-3, same lines)', async () => {
    let release: (v: unknown) => void = () => undefined;
    mockGet.mockResolvedValue(ok(ENDING));
    mockPost.mockImplementation(() => new Promise((res) => { release = res; }));
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-keep-${ID}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`your-plan-keep-${ID}`));
    await r.unmount();
    await act(async () => { release({ data: PLAN }); });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('B-344-4/6 plan copy and a working support path', () => {
  it.each([
    ['cancel', http(401, {}), /^Your session ended, so your plan was not changed\. Sign in again, then choose End my plan again\.$/],
    ['cancel', http(429, {}), /so your plan was not changed\. Wait a few minutes, then choose End my plan again\./],
    ['resume', http(404, { statusCode: 404, error: 'Not Found' }), /^Keeping a renewing plan is not available in the app yet, so your plan was not changed\. Message your coach to keep it\.$/],
    ['cancel', http(409, { code: 'BILLING_ACTION_IN_PROGRESS' }), /^Another change to this plan is still being processed/],
  ])('%s %#: says what happened to the plan, never a payment', async (action, err, copy) => {
    mockGet.mockResolvedValue(ok(action === 'cancel' ? PLAN : ENDING));
    mockPost.mockRejectedValue(err);
    autoConfirm();
    const r = await render(<YourPlansPanel />);
    const btn = `your-plan-${action === 'cancel' ? 'end' : 'keep'}-${ID}`;
    await waitFor(() => expect(r.getByTestId(btn)).toBeTruthy());
    await fireEvent.press(r.getByTestId(btn));
    await waitFor(() => expect(r.getByTestId('your-plan-error')).toBeTruthy());
    expect(r.getByTestId('your-plan-error').props.children[0]).toMatch(copy);
    expect(r.getByTestId('your-plan-error').props.children[0]).not.toMatch(/payment did not start|choose your plan/);
  });
  it('an unknown failure quotes the reference once and Email support falls back to the address', async () => {
    mockPost.mockRejectedValue(http(500, { code: 'BILLING_ACTION_FAILED' }));
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    autoConfirm();
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`your-plan-end-${ID}`));
    await waitFor(() => expect(r.getByTestId('your-plan-error')).toBeTruthy());
    expect(r.getByTestId('your-plan-error').props.children).toEqual([expect.stringMatching(/email support and quote reference ref12345\.$/), null]);
    await fireEvent.press(r.getByRole('button', { name: 'Email support' }));
    await waitFor(() => expect(r.getByTestId('your-plans-support-fallback-address')).toBeTruthy());
  });
});
