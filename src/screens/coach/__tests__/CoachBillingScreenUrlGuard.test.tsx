// Behavioral test: CoachBillingScreen MUST validate every backend-returned
// payment browser URL through assertStripeUrl() before opening it.
// Locks in the fix for audit P0-N1 (PR149 round 2) AND audit P1-A
// (PR149 round 3): proves the REAL validator accepts invoice hosts and
// that a rejected URL surfaces a user-visible alert.
//
// R26: This test does NOT mock the validator — it uses the production
// allow-list. Mocking the guard would hide a production-side rejection
// of a legitimate host (which is exactly the round-3 P1-A bug).

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' });
const mockOpenAuthSessionAsync = jest.fn().mockResolvedValue({ type: 'dismiss' });
jest.mock('expo-web-browser', () => ({
  __esModule: true,
  openBrowserAsync: (...a: unknown[]) => mockOpenBrowserAsync(...a),
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuthSessionAsync(...a),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

// IMPORTANT: stripeUrlValidator is NOT mocked. The real allow-list runs.

jest.mock('../../../theme/ThemeProvider', () => ({
  __esModule: true,
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceElevated: '#fafafa',
      primary: '#000',
      primaryPale: '#eee',
      textPrimary: '#000',
      textSecondary: '#444',
      textMuted: '#888',
      textOnPrimary: '#fff',
      border: '#ddd',
      error: '#f00',
      warning: '#fa0',
      noticeWarningIconBg: '#fee',
    },
  }),
}));

const mockGetStatus = jest.fn();
const mockGetFull = jest.fn();
const mockCreatePortalSession = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  coachBillingApi: {
    getStatus: (...a: unknown[]) => mockGetStatus(...a),
    getFull: (...a: unknown[]) => mockGetFull(...a),
    createPortalSession: (...a: unknown[]) => mockCreatePortalSession(...a),
  },
}));

jest.mock('../../../lib/analytics', () => ({ __esModule: true, track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({
  __esModule: true,
  mediumTap: jest.fn(),
  successTap: jest.fn(),
  warningTap: jest.fn(),
}));

import CoachBillingScreen from '../CoachBillingScreen';

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockOpenBrowserAsync.mockClear();
  mockOpenAuthSessionAsync.mockClear();
  mockGetStatus.mockReset();
  mockGetFull.mockReset();
  mockCreatePortalSession.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

function setupHappy(invoiceUrl: string, portalUrl: string) {
  mockGetStatus.mockResolvedValue({ data: { state: 'active' } });
  mockGetFull.mockResolvedValue({
    data: {
      subscription: null,
      invoices: [
        {
          id: 'inv_1',
          hosted_invoice_url: invoiceUrl,
          invoice_pdf: null,
          amount_paid_cents: 1000,
          amount_due_cents: 1000,
          currency: 'usd',
          status: 'paid',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
  });
  mockCreatePortalSession.mockResolvedValue({ data: { url: portalUrl } });
}

describe('CoachBillingScreen URL guard (real validator)', () => {
  it('opens browser for a valid billing portal URL', async () => {
    setupHappy(
      'https://invoice.stripe.com/i/x',
      'https://billing.stripe.com/p/session_abc',
    );
    // Returning a non-standard result type sidesteps the post-sheet reload
    // branch so the test boundary is deterministic.
    mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'locked' } as never);

    const { findByLabelText } = await render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );

    const portalBtn = await findByLabelText('Manage billing');
    await fireEvent.press(portalBtn);

    await waitFor(() => expect(mockOpenAuthSessionAsync).toHaveBeenCalled());
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      'https://billing.stripe.com/p/session_abc',
      expect.any(String),
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('blocks a non-Stripe portal URL, shows user-visible alert, does NOT open browser', async () => {
    setupHappy('https://invoice.stripe.com/i/x', 'https://evil.example.com/phish');

    const { findByLabelText } = await render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );
    const portalBtn = await findByLabelText('Manage billing');
    await act(async () => {
      await fireEvent.press(portalBtn);
    });

    await waitFor(() => expect(mockCreatePortalSession).toHaveBeenCalled());
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Billing portal unavailable',
      expect.stringMatching(/invalid/i),
    );
  });

  it('opens browser for a valid invoice.stripe.com URL (round-3 regression)', async () => {
    setupHappy(
      'https://invoice.stripe.com/i/abc',
      'https://billing.stripe.com/p/session_abc',
    );

    const { findByLabelText } = await render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );

    const invoiceRow = await findByLabelText(/^Invoice /);
    await act(async () => {
      await fireEvent.press(invoiceRow);
    });

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'https://invoice.stripe.com/i/abc',
      expect.any(Object),
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('opens browser for a valid pay.stripe.com invoice URL', async () => {
    setupHappy(
      'https://pay.stripe.com/invoice/acct_abc/test_abc',
      'https://billing.stripe.com/p/session_abc',
    );

    const { findByLabelText } = await render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );

    const invoiceRow = await findByLabelText(/^Invoice /);
    await act(async () => {
      await fireEvent.press(invoiceRow);
    });

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'https://pay.stripe.com/invoice/acct_abc/test_abc',
      expect.any(Object),
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('blocks a non-Stripe invoice URL, shows user-visible alert, does NOT open browser', async () => {
    setupHappy('https://evil.example.com/inv', 'https://billing.stripe.com/p/x');

    const { findByLabelText } = await render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );
    const invoiceRow = await findByLabelText(/^Invoice /);
    await act(async () => {
      await fireEvent.press(invoiceRow);
    });

    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Could not open invoice',
      expect.stringMatching(/invalid/i),
    );
  });
});
