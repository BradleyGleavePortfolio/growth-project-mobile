import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import type { ThemeColors } from '../theme/ThemeProvider';
import { normalizeDunningStatus } from '../entitlements/dunning/dunningApi';
import { lockoutSummary, lockoutNextStep, isDisputeCycle } from '../entitlements/dunning/DunningLockoutScreen';
import { bannerCopy } from '../entitlements/dunning/DunningBanner';
import { updateCardIntro } from '../entitlements/dunning/UpdateCardScreen';
import { loadDisputePausedPlans, isDisputePaused } from '../entitlements/dunning/coachDisputeRestart';
import { DisputePausedPlansCard, restartConfirmBody } from '../components/coach/DisputePausedPlansCard';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));
jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({ semanticColors: tokens.lightTokens, tokens, colorScheme: 'light' }) };
});
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(), initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn(),
}));

const RAW = {
  enabled: true, state: 'locked', kind: 'refund', reason: 'refund_paused',
  purchase_id: 'purchase', amount_cents: null, currency: 'usd',
  locked_at: '2026-10-06T12:00:00.000Z', lockout_at: null,
  coach_name: 'Morgan', billing_paused: true,
};
const DETAIL = {
  purchase: {
    id: 'purchase', billing_type: 'recurring', status: 'refunded',
    amount_cents: 1000, currency: 'usd',
  },
  dunning: {
    status: 'active', last_failure_reason: 'charge_refunded',
    entered_at: '2026-10-06T12:00:00.000Z',
  },
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

function serveRefund() {
  mockGet.mockImplementation(async (route: string) => ({
    data: route === '/v1/coach/purchases' ? {
      purchases: [{
        id: 'purchase', client_user_id: 'client', billing_type: 'recurring',
        status: 'refunded', entitlement_active: false,
      }],
      next_cursor: null,
    } : DETAIL,
  }));
}

describe('MONEY-REFUND-124 refund pause is not failed payment or a bank dispute', () => {
  it('preserves the backend refund reason and keeps the coach-restart action gates', () => {
    const status = normalizeDunningStatus(RAW);
    expect(status).toMatchObject({ kind: 'refund', reason: 'refund_paused', lockout_at: null });
    expect(isDisputeCycle(status)).toBe(true);
  });

  it('client lockout explains the refund and points to the coach, never a card charge', () => {
    const status = normalizeDunningStatus(RAW);
    expect(lockoutSummary(status)).toMatch(/fully refunded/);
    expect(lockoutSummary(status)).toMatch(/billing is paused/);
    expect(lockoutSummary(status)).not.toMatch(/bank opened|has not gone through|10 days/);
    expect(lockoutNextStep(status)).toMatch(/Message Morgan/);
    expect(lockoutNextStep(status)).not.toMatch(/Update card|charged right away/);
  });

  it('a refund pause not yet confirmed by Stripe does not claim billing is paused', () => {
    const status = normalizeDunningStatus({ ...RAW, billing_paused: false });
    expect(lockoutSummary(status)).toMatch(/billing pause is being completed/);
    expect(lockoutSummary(status)).not.toMatch(/billing is paused/);
  });

  it('banner and card screen distinguish a full refund from a decline or dispute', () => {
    const status = normalizeDunningStatus(RAW);
    expect(bannerCopy(status).title).toMatch(/full refund/);
    expect(bannerCopy(status).body).not.toMatch(/bank opened|did not go through/);
    expect(updateCardIntro(status)).toMatch(/fully refunded/);
    expect(updateCardIntro(status)).not.toMatch(/bank opened|charged.*right away/);
  });

  it('coach roster can load a refund-paused plan for the existing restart route', async () => {
    serveRefund();
    expect(isDisputePaused(DETAIL)).toBe(true);
    await expect(loadDisputePausedPlans('client')).resolves.toEqual([expect.objectContaining({
      purchaseId: 'purchase', pauseReason: 'refund',
    })]);
  });

  it('coach card offers restart with clear renewed-billing consent after a refund', async () => {
    serveRefund();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const colors = new Proxy({}, { get: () => '#000000' }) as ThemeColors;
    const view = await render(<DisputePausedPlansCard clientUserId="client" clientName="Taylor" colors={colors} />);
    await waitFor(() => expect(view.getByText('Plan paused after a full refund')).toBeTruthy());
    await fireEvent.press(view.getByTestId('dispute-restart-purchase'));
    expect(alert).toHaveBeenCalledWith(
      'Restart this plan?', expect.stringMatching(/refund is not reversed.*agreeing with the client/),
      expect.any(Array),
    );
    expect(mockPost).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('existing disputes keep their original explanation and restart confirmation', () => {
    const status = normalizeDunningStatus({ ...RAW, kind: 'dispute', reason: 'dispute_paused' });
    expect(lockoutSummary(status)).toMatch(/bank opened a dispute or inquiry/);
    expect(restartConfirmBody('Taylor')).toMatch(/payment dispute or inquiry is resolved or settled/);
  });
});
