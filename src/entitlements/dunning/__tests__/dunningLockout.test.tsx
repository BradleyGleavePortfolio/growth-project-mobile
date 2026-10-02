/**
 * S-DUNNING mobile: 403 LOCKED_DUNNING handling, the single lockout state,
 * the Days 0-9 banner, and specific error copy.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { dunningLockoutStore, isLockedDunningResponse } from '../dunningLockoutStore';
import { describeDunningError, SUPPORT_EMAIL } from '../dunningErrorCopy';
import { normalizeDunningStatus, formatDunningAmount, type ClientDunningStatus } from '../dunningApi';
import { DunningLockoutProvider, REACHABLE_WHILE_LOCKED } from '../DunningLockoutProvider';
import { DunningBanner, bannerCopy } from '../DunningBanner';
import { lockoutSummary, supportMailto } from '../DunningLockoutScreen';

jest.mock('../../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../../theme/tokens').default;
  return {
    useTheme: () => ({ semanticColors: realTokens.lightTokens, tokens: realTokens, colorScheme: 'light' }),
  };
});

const mockCaptureError = jest.fn();
jest.mock('../../../services/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('../../../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));


const LOCKED: ClientDunningStatus = {
  enabled: true,
  state: 'locked',
  purchase_id: 'p1',
  amount_cents: 15000,
  currency: 'usd',
  failed_at: '2026-10-01T15:00:00.000Z',
  lockout_at: '2026-10-11T15:00:00.000Z',
  locked_at: '2026-10-11T15:07:00.000Z',
  day: 10,
  coach_name: 'Avery',
  card_last4: '4242',
  card_brand: 'visa',
};
const PAST_DUE: ClientDunningStatus = { ...LOCKED, state: 'past_due', locked_at: null, day: 3 };
const CLEAR: ClientDunningStatus = { ...LOCKED, state: 'none', amount_cents: null, day: null, locked_at: null };

function axiosError(status: number | null, data?: Record<string, unknown>, headers?: Record<string, string>) {
  return status === null
    ? Object.assign(new Error('Network Error'), { response: undefined })
    : Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data: data ?? {}, headers: headers ?? {} },
      });
}

const nav = {
  route: 'HomeMain' as string | undefined,
  listeners: new Set<() => void>(),
  go(name: string) {
    this.route = name;
    this.listeners.forEach((fn) => fn());
  },
};

async function renderProvider(child: React.ReactNode = <Text>app</Text>) {
  const handlers = {
    onMessageCoach: jest.fn(),
    onOpenDataExport: jest.fn(),
    onOpenDeleteAccount: jest.fn(),
    onSignOut: jest.fn(),
    onOpenUpdateCard: jest.fn(),
  };
  const utils = await render(
    <DunningLockoutProvider
      enabled
      {...handlers}
      getCurrentRouteName={() => nav.route}
      subscribeToRouteChanges={(fn) => {
        nav.listeners.add(fn);
        return () => nav.listeners.delete(fn);
      }}
    >
      {child}
    </DunningLockoutProvider>,
  );
  return { ...utils, handlers };
}

beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  mockGet.mockReset();
  mockPost.mockReset();
  mockCaptureError.mockReset();
  nav.route = 'HomeMain';
  nav.listeners.clear();
});

describe('LOCKED_DUNNING detection', () => {
  it('matches only a 403 whose body code is LOCKED_DUNNING', () => {
    expect(isLockedDunningResponse(403, { code: 'LOCKED_DUNNING' })).toBe(true);
    expect(isLockedDunningResponse(403, { code: 'COACH_ONLY' })).toBe(false);
    expect(isLockedDunningResponse(402, { code: 'LOCKED_DUNNING' })).toBe(false);
    expect(isLockedDunningResponse(403, undefined)).toBe(false);
  });
});

describe('DunningLockoutProvider', () => {
  it('shows one full-screen lockout when any request reports LOCKED_DUNNING', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const { findByTestId, getByTestId } = await renderProvider();
    await act(async () => {
      dunningLockoutStore.reportLocked({ requestId: 'req-123' });
    });
    await findByTestId('dunning-lockout-screen');
    expect(getByTestId('dunning-lockout-summary').props.children.join('')).toContain('$150.00 to Avery');
  });

  it('steps aside on the screens a locked client can still use, and returns after', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const { findByTestId, queryByTestId } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    expect([...REACHABLE_WHILE_LOCKED].sort()).toEqual(['DataExport', 'DeleteAccount', 'Messages', 'UpdateCard']);
    await act(async () => {
      nav.go('DataExport');
    });
    expect(queryByTestId('dunning-lockout-screen')).toBeNull();
    await act(async () => {
      nav.go('MoreMain');
    });
    await findByTestId('dunning-lockout-screen');
  });

  it('routes to data export, account deletion, coach thread and sign out', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const { findByTestId, getByTestId, handlers } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    await fireEvent.press(getByTestId('dunning-lockout-data-export'));
    await fireEvent.press(getByTestId('dunning-lockout-delete-account'));
    await fireEvent.press(getByTestId('dunning-lockout-message-coach'));
    await fireEvent.press(getByTestId('dunning-lockout-sign-out'));
    expect(handlers.onOpenDataExport).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenDeleteAccount).toHaveBeenCalledTimes(1);
    expect(handlers.onMessageCoach).toHaveBeenCalledTimes(1);
    expect(handlers.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('Update card opens the native card screen (no Stripe-hosted portal), and the lockout steps aside there', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const { findByTestId, getByTestId, queryByTestId, handlers } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    await fireEvent.press(getByTestId('dunning-lockout-update-card'));
    expect(handlers.onOpenUpdateCard).toHaveBeenCalledWith({ autostart: true, surface: 'DunningLockoutScreen' });
    expect(mockPost).not.toHaveBeenCalledWith('/v1/checkout/billing-portal', expect.anything());
    await act(async () => {
      nav.go('UpdateCard');
    });
    expect(queryByTestId('dunning-lockout-screen')).toBeNull();
  });

  it('lockout copy no longer sends the client to the portal invoice history', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const { findByTestId, queryByText, getByText } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    expect(queryByText(/Invoice history/)).toBeNull();
    expect(getByText(/We charge it right away/)).toBeTruthy();
  });

  it('End my plan (2A) asks first, then voids the unpaid invoice and ends the plan', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGet.mockResolvedValueOnce({ data: LOCKED }).mockResolvedValue({ data: CLEAR });
    mockPost.mockResolvedValue({
      data: {
        outcome: 'ended',
        purchase_id: 'p1',
        access_ends_at: '2026-10-11T16:00:00.000Z',
        voided_invoice_count: 1,
        voided_amount_cents: 15000,
        currency: 'usd',
        message: 'server copy',
      },
    });
    const { findByTestId, getByTestId, queryByTestId } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    await fireEvent.press(getByTestId('dunning-lockout-end-plan'));
    expect(mockPost).not.toHaveBeenCalled();
    const [title, body, buttons] = alert.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
    expect(title).toBe('End your plan now?');
    expect(body).toContain('The unpaid $150.00 is canceled');
    expect(buttons.map((b) => b.text)).toEqual(['Keep my plan', 'End my plan']);
    await act(async () => {
      buttons[1].onPress?.();
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/v1/checkout/subscriptions/p1/cancel', {}));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(alert.mock.calls[1][0]).toBe('Your plan has ended');
    expect(alert.mock.calls[1][1]).toContain('The unpaid $150.00 is canceled, so you will not be charged for it.');
    await waitFor(() => expect(queryByTestId('dunning-lockout-screen')).toBeNull());
    alert.mockRestore();
  });

  it('End my plan failure is specific and keeps the client on the lockout', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGet.mockResolvedValue({ data: LOCKED });
    mockPost.mockRejectedValue(axiosError(503, { code: 'CANCEL_INCOMPLETE' }, { 'x-request-id': 'req-c1' }));
    const { findByTestId, getByTestId } = await renderProvider();
    await findByTestId('dunning-lockout-screen');
    await fireEvent.press(getByTestId('dunning-lockout-end-plan'));
    const buttons = alert.mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });
    const err = await findByTestId('dunning-lockout-end-error');
    expect(err.props.children).toContain('tap End my plan again');
    expect(err.props.children).toContain('req-c1');
    expect(mockCaptureError).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('renders nothing extra and clears the store when the client is not dunned', async () => {
    mockGet.mockResolvedValue({ data: CLEAR });
    const { queryByTestId, findByText } = await renderProvider();
    await findByText('app');
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/checkout/dunning'));
    expect(queryByTestId('dunning-lockout-screen')).toBeNull();
  });
});

describe('DunningBanner (Days 0-9)', () => {
  it('shows amount, date and both actions while past due', async () => {
    mockGet.mockResolvedValue({ data: PAST_DUE });
    const { findByTestId, getByTestId, queryByTestId, handlers } = await renderProvider(
      <DunningBanner surface="HomeScreen" />,
    );
    await findByTestId('dunning-banner');
    expect(queryByTestId('dunning-lockout-screen')).toBeNull();
    await fireEvent.press(getByTestId('dunning-banner-message-coach'));
    expect(handlers.onMessageCoach).toHaveBeenCalled();
  });

  it('is hidden when the backend flag is off', async () => {
    mockGet.mockResolvedValue({ data: { ...PAST_DUE, enabled: false } });
    const { queryByTestId, findByText } = await renderProvider(
      <>
        <Text>home</Text>
        <DunningBanner surface="HomeScreen" />
      </>,
    );
    await findByText('home');
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(queryByTestId('dunning-banner')).toBeNull();
  });

  it('banner copy names the amount and the lock date and has no exclamation mark', () => {
    const copy = bannerCopy(PAST_DUE);
    expect(copy.body).toContain('$150.00');
    expect(copy.body).toMatch(/Update your card by \w+day, October 1[01] to keep access/);
    expect(`${copy.title}${copy.body}${lockoutSummary(LOCKED)}`).not.toContain('!');
  });
});

describe('specific error copy', () => {
  it.each([
    [axiosError(null), 'OFFLINE', false],
    [axiosError(429), 'RATE_LIMITED', false],
    [axiosError(404, { error: 'CUSTOMER_NOT_FOUND' }), 'NO_BILLING_ACCOUNT', false],
    [axiosError(502, { error: 'STRIPE_CHECKOUT_ERROR', request_id: 'req-9' }), 'STRIPE_UNAVAILABLE', true],
    [axiosError(500, { request_id: 'req-7' }), 'UNKNOWN', true],
    [new Error('STRIPE_URL_REJECTED'), 'LINK_REJECTED', true],
    [axiosError(404, { code: 'SETUP_INTENT_NOT_FOUND' }), 'CARD_FORM_EXPIRED', true],
    [axiosError(409, { code: 'SETUP_INTENT_NOT_CONFIRMED' }), 'CARD_NOT_SAVED', false],
    [axiosError(409, { code: 'BILLING_ACTION_IN_PROGRESS' }), 'BILLING_ACTION_IN_PROGRESS', false],
    [axiosError(404, { code: 'PURCHASE_NOT_FOUND' }), 'PLAN_NOT_FOUND', true],
    [axiosError(409, { code: 'NOT_A_SUBSCRIPTION' }), 'NOT_A_SUBSCRIPTION', false],
    [axiosError(503, { code: 'CANCEL_INCOMPLETE' }), 'CANCEL_INCOMPLETE', true],
    [axiosError(503, { code: 'PAYMENTS_NOT_CONFIGURED' }), 'PAYMENTS_NOT_CONFIGURED', true],
    [axiosError(502, { code: 'STRIPE_REQUEST_FAILED' }), 'STRIPE_REJECTED', true],
    [axiosError(503, { code: 'STRIPE_UNAVAILABLE', step: 'invoice_pay' }), 'PAYMENT_UNCONFIRMED', true],
    [axiosError(503, { code: 'STRIPE_UNAVAILABLE', step: 'invoice_void' }), 'PLAN_CHANGE_UNCONFIRMED', true],
    [axiosError(503, { code: 'STRIPE_UNAVAILABLE', step: 'setup_intent' }), 'STRIPE_UNAVAILABLE', true],
    [new Error('DUNNING_RESPONSE_SHAPE'), 'UNEXPECTED_RESPONSE', true],
    [axiosError(404), 'BILLING_ROUTE_NOT_AVAILABLE', false],
  ])('maps %#', (err, code, report) => {
    const copy = describeDunningError(err, 'update_card');
    expect(copy.code).toBe(code);
    expect(copy.report).toBe(report);
    expect(copy.message).not.toMatch(/something went wrong/i);
    expect(copy.message).not.toMatch(/^please try again\.?$/i);
    expect(copy.message).not.toContain('!');
  });

  it('a 404 status read (backend not deployed yet) is expected and not reported', () => {
    const copy = describeDunningError(axiosError(404, {}), 'load_status');
    expect(copy.code).toBe('STATUS_NOT_AVAILABLE');
    expect(copy.report).toBe(false);
  });

  it('unknown failures carry the request reference and the support address', () => {
    const copy = describeDunningError(axiosError(500, {}, { 'x-request-id': 'req-abc' }), 'update_card');
    expect(copy.reference).toBe('req-abc');
    expect(copy.message).toContain('req-abc');
    expect(copy.message).toContain(SUPPORT_EMAIL);
  });

  it('support mailto carries the reference', () => {
    expect(decodeURIComponent(supportMailto('req-1'))).toContain('Request reference: req-1');
  });
});

describe('status normaliser', () => {
  it('fails closed on unexpected shapes (B-322-5: the provider keeps its last known state)', () => {
    expect(() => normalizeDunningStatus(null)).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(() => normalizeDunningStatus({ state: 'weird', enabled: true })).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(normalizeDunningStatus({ state: 'none', enabled: false }).state).toBe('none');
    expect(formatDunningAmount(null, 'usd')).toBeNull();
    expect(formatDunningAmount(990, 'eur')).toBe('9.90 EUR');
  });
});
