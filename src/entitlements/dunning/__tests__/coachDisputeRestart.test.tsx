/**
 * R-DISPUTE-PAUSE coach restart: the Restart plan button shows only for a
 * plan the backend reports as dispute-paused, asks for confirmation, and
 * every backend refusal maps to its own sentence.
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import {
  DisputePausedPlansCard,
  RESTART_CONFIRM_TITLE,
} from '../../../components/coach/DisputePausedPlansCard';
import {
  RESTART_SUCCESS,
  isDisputePaused,
  loadDisputePausedPlans,
  restartDisputePausedPlan,
  restartRefusal,
} from '../coachDisputeRestart';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const colors = new Proxy({}, { get: () => '#000000' }) as ThemeColors;
const CLIENT = 'client-1';
const PURCHASE = 'purchase-1';

const pausedDunning = {
  status: 'active',
  last_failure_reason: 'charge_disputed',
  entered_at: '2026-10-01T10:00:00.000Z',
  locked_out_at: '2026-10-01T10:00:00.000Z',
};

function rosterRow(over: Record<string, unknown> = {}) {
  return {
    id: PURCHASE,
    client_user_id: CLIENT,
    billing_type: 'recurring',
    entitlement_active: false,
    status: 'active',
    ...over,
  };
}

function serve(row: Record<string, unknown>, dunning: Record<string, unknown> | null) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/coach/purchases') return { data: { purchases: [row], next_cursor: null } };
    if (url === `/v1/coach/payments/purchases/${row.id}`) {
      return {
        data: {
          purchase: { id: row.id, status: row.status, billing_type: row.billing_type, amount_cents: 4900, currency: 'usd' },
          dunning,
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function httpError(status: number, code: string) {
  return { response: { status, data: { code, error: code, message: 'server text' } } };
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

/** Press the confirm dialog's button with this label. */
async function pressAlertButton(label: string) {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as AlertButton[];
  const button = buttons.find((b) => b.text === label);
  await act(async () => {
    button?.onPress?.();
  });
}

describe('button only when the backend says the plan is dispute-paused', () => {
  it('shows Restart plan for a dispute-paused plan', async () => {
    serve(rosterRow(), pausedDunning);
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await waitFor(() => expect(r.getByTestId(`dispute-restart-${PURCHASE}`)).toBeTruthy());
    expect(r.getByText('Plan paused after a payment dispute or inquiry')).toBeTruthy();
  });

  it.each([
    ['a card decline', { ...pausedDunning, last_failure_reason: 'card_declined' }],
    ['a resolved cycle', { ...pausedDunning, status: 'resolved' }],
    ['no dunning row', null],
  ])('hides the card for %s', async (_label, dunning) => {
    serve(rosterRow(), dunning);
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(`/v1/coach/payments/purchases/${PURCHASE}`));
    expect(r.queryByTestId('dispute-paused-plans')).toBeNull();
  });

  it('never reads plans of another client, a one-time plan or a plan with access', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        purchases: [
          rosterRow({ id: 'p-other', client_user_id: 'client-2' }),
          rosterRow({ id: 'p-once', billing_type: 'one_time' }),
          rosterRow({ id: 'p-live', entitlement_active: true }),
          rosterRow({ id: 'p-ended', status: 'canceled' }),
        ],
        next_cursor: null,
      },
    });
    await expect(loadDisputePausedPlans(CLIENT)).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('isDisputePaused mirrors the backend restart pre-check', () => {
    const purchase = { status: 'active', billing_type: 'recurring' };
    expect(isDisputePaused({ purchase, dunning: pausedDunning })).toBe(true);
    expect(isDisputePaused({ purchase: { ...purchase, status: 'canceled' }, dunning: pausedDunning })).toBe(false);
    expect(isDisputePaused({ purchase, dunning: { ...pausedDunning, entered_at: null } })).toBe(false);
  });

  it('renders nothing when the read fails', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(r.queryByTestId('dispute-paused-plans')).toBeNull();
  });
});

describe('restart', () => {
  it('confirms first, then restarts and says billing resumed', async () => {
    serve(rosterRow(), pausedDunning);
    mockPost.mockResolvedValue({ data: { restarted: true } });
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await fireEvent.press(await r.findByTestId(`dispute-restart-${PURCHASE}`));
    expect(alertSpy).toHaveBeenCalledWith(RESTART_CONFIRM_TITLE, expect.stringContaining('Sam Lee'), expect.any(Array));
    expect(mockPost).not.toHaveBeenCalled();
    await pressAlertButton('Restart plan');
    await waitFor(() => expect(r.getByText(RESTART_SUCCESS)).toBeTruthy());
    expect(mockPost).toHaveBeenCalledWith(`/v1/coach/purchases/${PURCHASE}/dispute-restart`, {});
    expect(r.queryByTestId(`dispute-restart-${PURCHASE}`)).toBeNull();
  });

  it('Cancel in the confirm dialog changes nothing', async () => {
    serve(rosterRow(), pausedDunning);
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await fireEvent.press(await r.findByTestId(`dispute-restart-${PURCHASE}`));
    await pressAlertButton('Cancel');
    expect(mockPost).not.toHaveBeenCalled();
    expect(r.getByTestId(`dispute-restart-${PURCHASE}`)).toBeTruthy();
  });

  it.each([
    [404, 'PURCHASE_NOT_FOUND', 'That plan is not on your roster, so nothing was changed. Pull down to refresh, then try again.', true],
    [409, 'PLAN_NOT_DISPUTE_PAUSED', 'This plan is not paused by a payment dispute or inquiry, so there is nothing to restart. Pull down to refresh.', true],
    [409, 'PLAN_ENDED', 'This plan has ended, so it cannot be restarted. The client can buy the package again.', true],
    [409, 'OTHER_LIVE_PLAN', 'The client already has another active plan for this package, so restarting this one would bill them twice. Nothing was changed.', true],
    [409, 'NEW_DISPUTE', 'The bank opened another payment dispute or inquiry on this plan, so it stays paused and nothing was charged.', false],
    [409, 'BILLING_BUSY', 'Billing for this plan is being updated right now, so nothing was changed. Try again in a minute.', false],
    [503, 'BILLING_UNAVAILABLE', 'Billing could not be reached, so the plan stays paused and nothing was charged. Try again in a few minutes.', false],
  ])('%i %s maps to its own sentence', async (status, code, sentence, final) => {
    mockPost.mockRejectedValue(httpError(status, code));
    await expect(restartDisputePausedPlan(PURCHASE)).resolves.toEqual({ ok: false, code, message: sentence, final });
  });

  it('shows the refusal and hides the button when the plan cannot be restarted', async () => {
    serve(rosterRow(), pausedDunning);
    mockPost.mockRejectedValue(httpError(409, 'OTHER_LIVE_PLAN'));
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await fireEvent.press(await r.findByTestId(`dispute-restart-${PURCHASE}`));
    await pressAlertButton('Restart plan');
    await waitFor(() => expect(r.getByTestId(`dispute-restart-outcome-${PURCHASE}`)).toBeTruthy());
    expect(r.getByText(/would bill them twice/)).toBeTruthy();
    expect(r.queryByTestId(`dispute-restart-${PURCHASE}`)).toBeNull();
  });

  it('keeps the button after a temporary refusal', async () => {
    serve(rosterRow(), pausedDunning);
    mockPost.mockRejectedValue(httpError(409, 'BILLING_BUSY'));
    const r = await render(<DisputePausedPlansCard clientUserId={CLIENT} clientName="Sam Lee" colors={colors} />);
    await fireEvent.press(await r.findByTestId(`dispute-restart-${PURCHASE}`));
    await pressAlertButton('Restart plan');
    await waitFor(() => expect(r.getByText(/being updated right now/)).toBeTruthy());
    expect(r.getByTestId(`dispute-restart-${PURCHASE}`)).toBeTruthy();
  });

  it('no response: says the result is not known and points to refresh', () => {
    const out = restartRefusal(new Error('Network Error'));
    expect(out).toMatchObject({ ok: false, code: 'NO_RESPONSE', final: false });
    expect(out.message).toMatch(/Pull down to refresh/);
  });

  it('copy is impersonal: no first person, no exclamation marks', () => {
    const lines = [
      RESTART_SUCCESS,
      restartRefusal(new Error('x')).message,
      restartRefusal({ response: { status: 409, data: { code: 'RESTART_REFUSED' } } }).message,
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/\b(we|us|our|I)\b/i);
      expect(line).not.toMatch(/!/);
    }
  });
});
