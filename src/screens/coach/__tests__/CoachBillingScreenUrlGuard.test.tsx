// Behavioral test: CoachBillingScreen MUST validate every backend-returned
// payment browser URL through assertStripeUrl() before opening it.
// Locks in the fix for audit P0-N1 (PR149 round 2).

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

// jest.mock factories can only reference variables prefixed with `mock`.
const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' });
jest.mock('expo-web-browser', () => ({
  __esModule: true,
  openBrowserAsync: (...a: unknown[]) => mockOpenBrowserAsync(...a),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

const mockAssertStripeUrl = jest.fn();
jest.mock('../../../utils/stripeUrlValidator', () => ({
  __esModule: true,
  assertStripeUrl: (...args: unknown[]) => mockAssertStripeUrl(...args),
  validateStripeUrl: jest.fn(() => true),
}));

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

beforeEach(() => {
  mockOpenBrowserAsync.mockClear();
  mockAssertStripeUrl.mockReset();
  mockGetStatus.mockReset();
  mockGetFull.mockReset();
  mockCreatePortalSession.mockReset();
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

describe('CoachBillingScreen URL guard', () => {
  it('validates portal URL with assertStripeUrl before opening browser', async () => {
    setupHappy(
      'https://invoice.stripe.com/i/x',
      'https://billing.stripe.com/p/session_abc',
    );
    mockAssertStripeUrl.mockImplementation(() => {});
    // The screen always re-fires load() after the sheet closes regardless
    // of result.type. Returning a 'locked' type sidesteps the reload branch
    // entirely so the test boundary is deterministic.
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: 'locked' });

    const { findByLabelText } = render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );

    const portalBtn = await findByLabelText('Manage billing');
    fireEvent.press(portalBtn);

    await waitFor(() => expect(mockOpenBrowserAsync).toHaveBeenCalled());
    expect(mockAssertStripeUrl).toHaveBeenCalledWith(
      'https://billing.stripe.com/p/session_abc',
      expect.stringContaining('CoachBillingScreen'),
    );
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'https://billing.stripe.com/p/session_abc',
      expect.any(Object),
    );
  });

  it('rejects a non-Stripe portal URL and does NOT open the browser', async () => {
    setupHappy('https://invoice.stripe.com/i/x', 'https://evil.example.com/phish');
    mockAssertStripeUrl.mockImplementation((url: string) => {
      if (url.includes('evil')) throw new Error('STRIPE_URL_REJECTED');
    });

    const { findByLabelText } = render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );
    const portalBtn = await findByLabelText('Manage billing');
    await act(async () => {
      fireEvent.press(portalBtn);
    });

    await waitFor(() => expect(mockCreatePortalSession).toHaveBeenCalled());
    expect(mockAssertStripeUrl).toHaveBeenCalled();
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('validates invoice URL with assertStripeUrl before opening browser', async () => {
    setupHappy(
      'https://invoice.stripe.com/i/abc',
      'https://billing.stripe.com/p/session_abc',
    );
    mockAssertStripeUrl.mockImplementation(() => {});

    const { findByLabelText } = render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );

    const invoiceRow = await findByLabelText(/^Invoice /);
    await act(async () => {
      fireEvent.press(invoiceRow);
    });

    expect(mockAssertStripeUrl).toHaveBeenCalledWith(
      'https://invoice.stripe.com/i/abc',
      expect.stringContaining('CoachBillingScreen'),
    );
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'https://invoice.stripe.com/i/abc',
      expect.any(Object),
    );
  });

  it('rejects a non-Stripe invoice URL and does NOT open the browser', async () => {
    setupHappy('https://evil.example.com/inv', 'https://billing.stripe.com/p/x');
    mockAssertStripeUrl.mockImplementation((url: string) => {
      if (url.includes('evil')) throw new Error('STRIPE_URL_REJECTED');
    });

    const { findByLabelText } = render(
      <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />,
    );
    const invoiceRow = await findByLabelText(/^Invoice /);
    await act(async () => {
      fireEvent.press(invoiceRow);
    });

    expect(mockAssertStripeUrl).toHaveBeenCalled();
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });
});
