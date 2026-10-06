import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockGetStatus = jest.fn();
const mockGetFull = jest.fn();
const mockCreatePortalSession = jest.fn();
const mockOpenBrowser = jest.fn();
const mockOpenAuth = jest.fn();
jest.mock('../../../services/api', () => ({
  coachBillingApi: {
    getStatus: () => mockGetStatus(),
    getFull: () => mockGetFull(),
    createPortalSession: () => mockCreatePortalSession(),
  },
}));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuth(...args),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
const mockColors = new Proxy({}, { get: () => '#000000' });
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: mockColors }),
}));

import CoachBillingScreen from '../CoachBillingScreen';

const realOS = Platform.OS;
const globals = globalThis as { __DEV__?: boolean };
const realDev = globals.__DEV__;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  globals.__DEV__ = false;
  jest.clearAllMocks();
  mockGetFull.mockResolvedValue({
    data: {
      invoices: [{
        id: 'invoice-review', hosted_invoice_url: 'https://invoice.stripe.com/i/review-placeholder',
        amount_paid_cents: 4900, amount_due_cents: 0, currency: 'usd', status: 'paid',
        created_at: '2026-10-01T00:00:00Z',
      }],
    },
  });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
  globals.__DEV__ = realDev;
});

describe('Android release coach software billing', () => {
  it.each(['none', 'paused', 'canceled', 'active', 'past_due', 'trialing'])(
    '%s keeps status but exposes no Stripe purchase/portal or payable invoice link',
    async (state) => {
      mockGetStatus.mockResolvedValue({ data: { state, summary: 'Upgrade your digital plan' } });
      const view = await render(<CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />);
      expect(await view.findByText('Your coach account status is shown here. Billing changes are not made in this app.'))
        .toBeTruthy();
      expect(view.queryByLabelText('Start subscription')).toBeNull();
      expect(view.queryByLabelText('Manage billing')).toBeNull();
      expect(view.queryByText('Upgrade your digital plan')).toBeNull();
      const invoice = view.getByLabelText(/Invoice.*paid/);
      expect(invoice).toBeDisabled();
      await fireEvent.press(invoice);
      expect(mockCreatePortalSession).not.toHaveBeenCalled();
      expect(mockOpenBrowser).not.toHaveBeenCalled();
      expect(mockOpenAuth).not.toHaveBeenCalled();
    },
  );
});
