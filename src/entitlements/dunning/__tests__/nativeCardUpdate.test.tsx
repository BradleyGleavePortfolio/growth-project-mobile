/**
 * OR-110-2 mobile: the native card update (SetupIntent -> PaymentSheet ->
 * confirm, with the 1A pay-now result and the 3DS bank step), the TGP
 * PaymentSheet theme, the UpdateCard screen, the universal-link routing and
 * the Android filter for the email link.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import realTokens from '../../../theme/tokens';
import {
  formatDunningAmount,
  normalizeCardSetup,
  normalizeCardUpdate,
  normalizeDunningStatus,
  normalizePaymentQuote,
  type ClientDunningStatus,
} from '../dunningApi';
import { cancelOutcomeCopy, cardUpdateOutcomeCopy, describeDunningError } from '../dunningErrorCopy';
import { DunningLockoutProvider } from '../DunningLockoutProvider';
import { dunningLockoutStore } from '../dunningLockoutStore';
import { buildPaymentSheetAppearance, sheetStyleFor } from '../paymentSheetAppearance';
import {
  __resetStripeSdkForTests,
  confirmWithBank,
  handleStripeReturnUrl,
  runNativeCardUpdate,
  STRIPE_RETURN_URL,
  type StripeSdk,
} from '../updateCard';
import { UpdateCardScreen, endPlanAlertBody, sheetButtonLabel, updateCardIntro } from '../UpdateCardScreen';

jest.mock('../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../theme/tokens').default;
  return {
    useTheme: () => ({
      semanticColors: t.lightTokens,
      tokens: t,
      colorScheme: 'light',
    }),
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

jest.mock('../../../utils/idempotency', () => ({
  generateIdempotencyKey: () => '00000000-0000-4000-8000-0000000000aa',
  randomUuid: () => '00000000-0000-4000-8000-0000000000cc',
}));

type SdkErrorDouble = { code: string; message: string };
type NextActionDouble = {
  paymentIntent?: { status: string };
  error?: SdkErrorDouble;
};
const mockSdk = {
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
  handleNextAction: jest.fn(async (): Promise<NextActionDouble> => ({
    paymentIntent: { status: 'Succeeded' },
  })),
  handleURLCallback: jest.fn(async () => true),
};
jest.mock('@stripe/stripe-react-native', () => mockSdk);

// The module double above, read back through jest with the production port type.
const sdk = jest.requireMock<StripeSdk>('@stripe/stripe-react-native');

const SETUP = {
  setup_intent_id: 'seti_1',
  setup_intent_client_secret: 'seti_1_secret_x',
  ephemeral_key: 'ek_test_1',
  customer_id: 'cus_1',
  publishable_key: 'pk_test_backend',
  merchant_display_name: 'The Growth Project',
};

function cardResult(outcome: string, extra: Record<string, unknown> = {}) {
  return {
    outcome,
    card: { brand: 'visa', last4: '4444', exp_month: 12, exp_year: 2030 },
    amount_paid_cents: outcome === 'paid' ? 15000 : 0,
    amount_due_cents: outcome === 'paid' || outcome === 'saved' ? 0 : 15000,
    currency: 'usd',
    access_restored: outcome === 'paid',
    payment_intent_client_secret: null,
    decline_code: null,
    message: 'server copy',
    ...extra,
  };
}

function axiosError(status: number | null, data?: Record<string, unknown>, headers?: Record<string, string>) {
  return status === null
    ? Object.assign(new Error('Network Error'), { response: undefined })
    : Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data: data ?? {}, headers: headers ?? {} },
      });
}

/** Route the two POSTs by URL. */
function backend(confirms: Array<unknown>, setup: unknown = SETUP) {
  const queue = [...confirms];
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/v1/checkout/payment-method/setup-intent') {
      if (setup instanceof Error) throw setup;
      return { data: setup };
    }
    if (url === '/v1/checkout/payment-method/confirm') {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { data: next };
    }
    if (url.startsWith('/v1/checkout/subscriptions/')) {
      return {
        data: {
          outcome: 'ended',
          purchase_id: 'p1',
          access_ends_at: '2026-10-11T16:00:00.000Z',
          voided_invoice_count: 1,
          voided_amount_cents: 15000,
          currency: 'usd',
        },
      };
    }
    throw new Error(`unexpected POST ${url}`);
  });
}

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
const PAST_DUE: ClientDunningStatus = {
  ...LOCKED,
  state: 'past_due',
  locked_at: null,
  day: 3,
};
const CLEAR: ClientDunningStatus = {
  ...LOCKED,
  state: 'none',
  amount_cents: null,
  day: null,
  locked_at: null,
};

const QUOTE = {
  quote_id: 'q1',
  complete: true,
  lines: [
    {
      invoice_id: 'in_1',
      purchase_id: 'p1',
      coach_name: 'Avery',
      currency: 'usd',
      amount_cents: 15000,
      created: 1,
    },
  ],
  totals: [{ currency: 'usd', amount_cents: 15000 }],
  disputes: [],
};
const APPROVED = [{ invoice_id: 'in_1', amount_cents: 15000, currency: 'usd' }];
const CONFIRM_BODY = { setup_intent_id: 'seti_1', approved_invoices: APPROVED };

const OPTS = {
  surface: 'test',
  colorScheme: 'light' as const,
  primaryButtonLabel: 'Save card and pay $150.00',
  sdk,
  approved: APPROVED,
  retryDelaysMs: [0, 0],
};

/** GET routes: the quote, or the current status (tests change it mid-flow). */
let currentStatus: unknown = null;
let currentQuote: unknown = QUOTE;
function routeGets() {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/checkout/payment-method/quote') {
      if (currentQuote instanceof Error) throw currentQuote;
      return { data: currentQuote };
    }
    return { data: currentStatus };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetStripeSdkForTests();
  dunningLockoutStore.__resetForTests();
  mockSdk.presentPaymentSheet.mockImplementation(async () => ({}));
  mockSdk.initPaymentSheet.mockImplementation(async () => ({}));
  mockSdk.handleNextAction.mockImplementation(async () => ({
    paymentIntent: { status: 'Succeeded' },
  }));
  currentQuote = QUOTE;
  currentStatus = null;
  routeGets();
});

describe('runNativeCardUpdate (SetupIntent -> PaymentSheet -> confirm)', () => {
  it('1A: saves the card in a TGP-themed sheet and the backend pays the open $150.00 once', async () => {
    backend([cardResult('paid')]);
    const out = await runNativeCardUpdate(OPTS);
    expect(mockPost).toHaveBeenNthCalledWith(1, '/v1/checkout/payment-method/setup-intent', {
      idempotency_key: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(mockSdk.initStripe).toHaveBeenCalledWith({
      publishableKey: 'pk_test_backend',
      urlScheme: 'tgp',
      setReturnUrlSchemeOnAndroid: true,
    });
    expect(mockSdk.initPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        setupIntentClientSecret: 'seti_1_secret_x',
        customerId: 'cus_1',
        customerEphemeralKeySecret: 'ek_test_1',
        merchantDisplayName: 'The Growth Project',
        returnURL: STRIPE_RETURN_URL,
        allowsDelayedPaymentMethods: false,
        primaryButtonLabel: 'Save card and pay $150.00',
        style: 'alwaysLight',
        appearance: buildPaymentSheetAppearance(),
      }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(2, '/v1/checkout/payment-method/confirm', CONFIRM_BODY);
    expect(out).toEqual({
      kind: 'done',
      response: normalizeCardUpdate(cardResult('paid')),
      setupIntentId: 'seti_1',
    });
    if (out.kind === 'done') {
      expect(out.response.amount_paid_cents).toBe(15000);
      expect(Number.isInteger(out.response.amount_paid_cents)).toBe(true);
    }
  });

  it('closing the sheet saves nothing and never calls confirm', async () => {
    backend([]);
    mockSdk.presentPaymentSheet.mockImplementation(async () => ({
      error: { code: 'Canceled', message: 'x' },
    }));
    expect(await runNativeCardUpdate(OPTS)).toEqual({ kind: 'canceled' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('a build without the native module says to update the app (and reports it)', async () => {
    const out = await runNativeCardUpdate({ ...OPTS, sdk: null });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.error.code).toBe('CARD_SHEET_UNAVAILABLE');
      expect(out.error.message).toContain('Update the app');
    }
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalled();
  });

  it('falls back to the build-time publishable key; with neither, fails closed before any sheet', async () => {
    const prev = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_build';
    backend([cardResult('saved')], { ...SETUP, publishable_key: null });
    await runNativeCardUpdate(OPTS);
    expect(mockSdk.initStripe).toHaveBeenCalledWith(expect.objectContaining({ publishableKey: 'pk_test_build' }));

    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const prevLegacy = process.env.EXPO_PUBLIC_STRIPE_PK;
    delete process.env.EXPO_PUBLIC_STRIPE_PK;
    jest.clearAllMocks();
    backend([], { ...SETUP, publishable_key: null });
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'error' && out.error.code).toBe('PAYMENTS_NOT_CONFIGURED');
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = prev;
    if (prevLegacy !== undefined) process.env.EXPO_PUBLIC_STRIPE_PK = prevLegacy;
  });

  it('1A with 3DS: runs the bank step on the returned PaymentIntent, then confirms again (same SetupIntent)', async () => {
    backend([
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
      cardResult('paid'),
    ]);
    const out = await runNativeCardUpdate(OPTS);
    expect(mockSdk.handleNextAction).toHaveBeenCalledWith('pi_9_secret_y', 'tgp://stripe-redirect');
    const confirms = mockPost.mock.calls.filter(([u]) => u === '/v1/checkout/payment-method/confirm');
    expect(confirms).toEqual([
      ['/v1/checkout/payment-method/confirm', CONFIRM_BODY],
      ['/v1/checkout/payment-method/confirm', CONFIRM_BODY],
    ]);
    expect(out.kind === 'done' && out.response.outcome).toBe('paid');
  });

  it('closing the bank sheet keeps the card and offers "Confirm with my bank" (no second card entry)', async () => {
    backend([
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
    ]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Canceled', message: 'x' },
    }));
    const out = await runNativeCardUpdate(OPTS);
    expect(out).toEqual({
      kind: 'bank_pending',
      setupIntentId: 'seti_1',
      clientSecret: 'pi_9_secret_y',
      response: normalizeCardUpdate(
        cardResult('requires_action', {
          payment_intent_client_secret: 'pi_9_secret_y',
        }),
      ),
      error: null,
    });
    // Retry from the screen: bank step first, then confirm.
    mockSdk.handleNextAction.mockImplementation(async () => ({
      paymentIntent: { status: 'Succeeded' },
    }));
    backend([cardResult('paid')]);
    const retry = await confirmWithBank({
      sdk,
      surface: 'test',
      setupIntentId: 'seti_1',
      clientSecret: 'pi_9_secret_y',
      approved: APPROVED,
    });
    expect(retry.kind === 'done' && retry.response.outcome).toBe('paid');
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('a failed bank step is truthful: card saved, nothing charged (server re-checked)', async () => {
    backend([
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
      // R5 B-322-1: the re-check with the same SetupIntent still waits for the bank.
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
    ]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Failed', message: 'x' },
    }));
    const out = await runNativeCardUpdate(OPTS);
    // B-322-3: the SetupIntent and bank secret survive the failure for "Confirm with my bank".
    expect(out.kind).toBe('bank_pending');
    if (out.kind === 'bank_pending') {
      expect(out.setupIntentId).toBe('seti_1');
      expect(out.clientSecret).toBe('pi_9_secret_y');
      expect(out.error?.code).toBe('BANK_CONFIRMATION_FAILED');
      expect(out.error?.message).toContain('nothing was charged');
    }
  });

  it('declined new card: done with the declined outcome and the amount still due', async () => {
    backend([cardResult('declined', { decline_code: 'insufficient_funds' })]);
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'done' && out.response.decline_code).toBe('insufficient_funds');
    expect(out.kind === 'done' && out.response.amount_due_cents).toBe(15000);
  });

  it('a lost answer on the payment never claims "nothing changed"', async () => {
    backend([axiosError(503, { code: 'STRIPE_UNAVAILABLE', step: 'invoice_pay' }, { 'x-request-id': 'req-p' })]);
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'error' && out.error.code).toBe('PAYMENT_UNCONFIRMED');
    expect(out.kind === 'error' && out.error.message).toContain('Your payment is not confirmed yet');
    expect(out.kind === 'error' && out.error.message).toContain('req-p');
  });

  it('an unusable setup response is reported, not shown as a card form', async () => {
    backend([], { setup_intent_id: 'seti_1' });
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'error' && out.error.code).toBe('UNEXPECTED_RESPONSE');
    expect(mockSdk.initPaymentSheet).not.toHaveBeenCalled();
    expect(() => normalizeCardSetup({})).toThrow('DUNNING_RESPONSE_SHAPE');
  });

  it('hands only tgp://stripe-redirect returns to the SDK', async () => {
    expect(await handleStripeReturnUrl('tgp://stripe-redirect?x=1')).toBe(true);
    expect(await handleStripeReturnUrl('tgp://billing/update-card')).toBe(false);
    expect(mockSdk.handleURLCallback).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentSheet theme from TGP tokens', () => {
  it('maps light and dark semantic tokens, all #RRGGBB, rounded primary button', () => {
    const a = buildPaymentSheetAppearance();
    expect(a.colors.light.primary).toBe(realTokens.lightTokens.accent);
    expect(a.colors.light.background).toBe(realTokens.lightTokens.bgPrimary);
    expect(a.colors.dark.background).toBe(realTokens.darkTokens.bgPrimary);
    expect(a.primaryButton.colors.light.text).toBe(realTokens.lightTokens.textOnAccent);
    expect(a.primaryButton.shapes.borderRadius).toBe(realTokens.radius.button); // owner 17:07: rounded
    const all = [
      ...Object.values(a.colors.light),
      ...Object.values(a.colors.dark),
      ...Object.values(a.primaryButton.colors.light),
      ...Object.values(a.primaryButton.colors.dark),
    ];
    for (const c of all) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(sheetStyleFor('dark')).toBe('alwaysDark');
  });
});

describe('outcome copy (integer minor units, no exclamation marks)', () => {
  it('names the money for every outcome', () => {
    const texts = (['paid', 'saved', 'processing', 'requires_action', 'declined'] as const).map((o) => {
      const c = cardUpdateOutcomeCopy(
        normalizeCardUpdate(
          cardResult(o, o === 'requires_action' ? { payment_intent_client_secret: 'pi_9_secret_y' } : {}),
        ),
      );
      return `${c.title} ${c.body}`;
    });
    expect(texts[0]).toContain('$150.00 went through');
    expect(texts[1]).toContain('Your next payment will use it');
    expect(texts[4]).toContain('declined the payment of $150.00, so nothing was charged');
    const cancel = [
      cancelOutcomeCopy({
        outcome: 'ended',
        purchase_id: 'p',
        access_ends_at: null,
        voided_invoice_count: 1,
        voided_amount_cents: 15000,
        currency: 'usd',
        paid_period_kept: false,
        message: null,
      }),
      cancelOutcomeCopy({
        outcome: 'scheduled',
        purchase_id: 'p',
        access_ends_at: '2026-11-01T00:00:00.000Z',
        voided_invoice_count: 0,
        voided_amount_cents: 0,
        currency: 'usd',
        paid_period_kept: false,
        message: null,
      }),
      cancelOutcomeCopy({
        outcome: 'already_ended',
        purchase_id: 'p',
        access_ends_at: null,
        voided_invoice_count: 0,
        voided_amount_cents: 0,
        currency: 'usd',
        paid_period_kept: false,
        message: null,
      }),
    ];
    expect(cancel[0].body).toContain('The unpaid $150.00 is canceled');
    expect(cancel[1].body).toContain('the end of the period you paid for');
    for (const t of [...texts, ...cancel.map((c) => c.title + c.body)]) expect(t).not.toContain('!');
    expect(formatDunningAmount(15000, 'jpy')).toBe('15000 JPY');
  });

  it('intro and sheet label say what will be charged before the client acts', () => {
    expect(updateCardIntro(LOCKED)).toContain('$150.00 is charged to it right away');
    expect(updateCardIntro(PAST_DUE)).toContain('You keep full access');
    expect(updateCardIntro(CLEAR)).toContain('If a payment is overdue');
    expect(sheetButtonLabel(normalizePaymentQuote(QUOTE))).toBe('Save card and pay $150.00');
    expect(sheetButtonLabel(normalizePaymentQuote({ ...QUOTE, lines: [], totals: [] }))).toBe('Save card');
  });
});

async function renderScreen(status: ClientDunningStatus, autostart = false) {
  currentStatus = status;
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const utils = await render(
    <DunningLockoutProvider
      enabled
      onMessageCoach={jest.fn()}
      onOpenDataExport={jest.fn()}
      onOpenDeleteAccount={jest.fn()}
      onOpenUpdateCard={jest.fn()}
      onSignOut={jest.fn()}
      getCurrentRouteName={() => 'UpdateCard'}
      subscribeToRouteChanges={() => () => undefined}
    >
      <UpdateCardScreen route={{ params: { autostart } }} navigation={navigation} />
    </DunningLockoutProvider>,
  );
  return { ...utils, navigation };
}

describe('UpdateCardScreen', () => {
  it('locked client: opens the card form on arrival, pays, unlocks, and offers Done', async () => {
    backend([cardResult('paid')]);
    // Status reads are locked until the confirm call pays; clear after it.
    const routePost = mockPost.getMockImplementation() as (url: string, body: unknown) => Promise<unknown>;
    mockPost.mockImplementation(async (url: string, body: unknown) => {
      const res = await routePost(url, body);
      if (url === '/v1/checkout/payment-method/confirm') currentStatus = CLEAR;
      return res;
    });
    const { findByTestId, getByTestId, queryByTestId, navigation } = await renderScreen(LOCKED, true);
    await findByTestId('update-card-result-paid');
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
    expect(queryByTestId('dunning-lockout-screen')).toBeNull();
    await waitFor(() => expect(dunningLockoutStore.isLocked()).toBe(false));
    expect(queryByTestId('update-card-end-plan')).toBeNull();
    await fireEvent.press(getByTestId('update-card-done'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('requires_action shows "Confirm with my bank", which settles the payment', async () => {
    backend([
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
    ]);
    mockSdk.handleNextAction.mockImplementationOnce(async () => ({
      error: { code: 'Canceled', message: 'x' },
    }));
    const { findByTestId, getByTestId, queryByTestId, getByText } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    await findByTestId('update-card-result-requires_action');
    // The copy names the button that is actually on screen, and a different card stays one tap away.
    expect(getByText(/Tap Confirm with my bank to finish/)).toBeTruthy();
    expect(getByTestId('update-card-different')).toBeTruthy();
    expect(queryByTestId('update-card-add')).toBeNull();
    backend([cardResult('paid')]);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-confirm-bank'));
    });
    await findByTestId('update-card-result-paid');
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('declined: says so, keeps "End my plan instead", and offers another card', async () => {
    backend([cardResult('declined')]);
    const { findByTestId, getByTestId, getByText } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    await findByTestId('update-card-result-declined');
    expect(getByText('Try a different card')).toBeTruthy();
    expect(getByTestId('update-card-end-plan')).toBeTruthy();
  });

  it('End my plan instead (2A) confirms first and then cancels the purchase', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    backend([]);
    const { findByTestId, getByTestId, navigation } = await renderScreen(PAST_DUE);
    await findByTestId('update-card-end-plan');
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await fireEvent.press(getByTestId('update-card-end-plan'));
    const buttons = alert.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    expect(buttons[0].text).toBe('Keep my plan');
    await act(async () => {
      buttons[1].onPress?.();
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/v1/checkout/subscriptions/p1/cancel', {}));
    await waitFor(() => expect(alert.mock.calls[1]?.[0]).toBe('Your plan has ended'));
    expect(navigation.goBack).toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe('S-DUNNING-R3 money truth on the device', () => {
  it('B-322-1: a partial success names what went through per currency and never says "nothing was charged"', () => {
    const r = normalizeCardUpdate(
      cardResult('declined', {
        amount_paid_cents: null,
        amount_due_cents: null,
        currency: null,
        paid_totals: [{ currency: 'usd', amount_cents: 15000 }],
        due_totals: [{ currency: 'eur', amount_cents: 8000 }],
        access_restored: false,
        access_state: 'partial',
      }),
    );
    const c = cardUpdateOutcomeCopy(r);
    expect(c.title).toBe('Part of your payment went through');
    expect(c.body).toContain('$150.00 went through');
    expect(c.body).toContain(formatDunningAmount(8000, 'eur') as string);
    expect(c.body).not.toContain('nothing was charged');
    expect(c.body).not.toContain('active again');
    // paid but access not confirmed back: no "active again".
    const paidUpdating = cardUpdateOutcomeCopy(
      normalizeCardUpdate(
        cardResult('paid', {
          access_restored: false,
          access_state: 'updating',
        }),
      ),
    );
    expect(paidUpdating.body).toContain('$150.00 went through');
    expect(paidUpdating.body).not.toContain('active again');
  });

  it('B-322-2: a lost confirm answer re-asks with the same card and approval, then reports the real result', async () => {
    backend([axiosError(null), axiosError(503), cardResult('paid')]);
    const onConfirming = jest.fn();
    const out = await runNativeCardUpdate({ ...OPTS, onConfirming });
    expect(out.kind === 'done' && out.response.amount_paid_cents).toBe(15000);
    expect(onConfirming).toHaveBeenCalledTimes(2);
    const confirms = mockPost.mock.calls.filter(([u]) => u === '/v1/checkout/payment-method/confirm');
    expect(confirms).toHaveLength(3);
    for (const call of confirms) expect(call[1]).toEqual(CONFIRM_BODY);
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('B-322-2: when every answer is lost the app says it cannot tell yet, never "nothing was charged"', async () => {
    backend([axiosError(null), axiosError(null), axiosError(null)]);
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind).toBe('unconfirmed');
    if (out.kind === 'unconfirmed') {
      expect(out.setupIntentId).toBe('seti_1');
      expect(out.error.code).toBe('RESULT_NOT_CONFIRMED');
      expect(out.error.message).toContain('not clear yet whether the payment went through');
      expect(out.error.message).not.toContain('nothing was charged');
    }
    const offlineCancel = describeDunningError(axiosError(null), 'cancel_plan');
    expect(offlineCancel.code).toBe('RESULT_NOT_CONFIRMED');
    expect(offlineCancel.message).not.toContain('nothing changed');
  });

  it('B-322-4: rejected native SDK promises become specific errors, never uncaught throws', async () => {
    backend([]);
    mockSdk.presentPaymentSheet.mockImplementation(async () => {
      throw new Error('native crash');
    });
    const a = await runNativeCardUpdate(OPTS);
    expect(a.kind === 'error' && a.error.code).toBe('CARD_SHEET_FAILED');

    mockSdk.presentPaymentSheet.mockImplementation(async () => ({}));
    mockSdk.initPaymentSheet.mockImplementation(async () => {
      throw new Error('init crash');
    });
    const b = await runNativeCardUpdate(OPTS);
    expect(b.kind === 'error' && b.error.code).toBe('CARD_SHEET_FAILED');

    mockSdk.initPaymentSheet.mockImplementation(async () => ({}));
    mockSdk.handleNextAction.mockImplementation(async () => {
      throw new Error('3ds crash');
    });
    backend([
      cardResult('requires_action', {
        payment_intent_client_secret: 'pi_9_secret_y',
      }),
    ]);
    const c = await runNativeCardUpdate(OPTS);
    expect(c.kind).toBe('bank_pending');
    // R5 B-322-1: a rejected bank step whose re-check got no answer is "not
    // confirmed yet", never "nothing was charged".
    expect(c.kind === 'bank_pending' && c.error?.code).toBe('BANK_RESULT_UNCONFIRMED');
    expect(c.kind === 'bank_pending' && c.error?.message).not.toContain('nothing was charged');
    expect(mockCaptureError).toHaveBeenCalled();
  });

  it('B-322-5: malformed success bodies fail closed, and references are visible', () => {
    expect(() => normalizeCardUpdate({ outcome: 'mystery' })).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(() => normalizeCardUpdate(cardResult('requires_action'))).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(() => normalizeCardUpdate(cardResult('paid', { amount_paid_cents: '15000' }))).toThrow(
      'DUNNING_RESPONSE_SHAPE',
    );
    expect(() => normalizeDunningStatus({ enabled: true, state: 'weird' })).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(() =>
      normalizeDunningStatus({
        enabled: true,
        state: 'locked',
        purchase_id: null,
      }),
    ).toThrow('DUNNING_RESPONSE_SHAPE');
    expect(() => normalizePaymentQuote({ quote_id: 'q', lines: [{ invoice_id: 'in_1' }] })).toThrow(
      'DUNNING_RESPONSE_SHAPE',
    );
    const shape = describeDunningError(new Error('DUNNING_RESPONSE_SHAPE'), 'confirm_card');
    expect(shape.code).toBe('RESULT_NOT_CONFIRMED');
    expect(shape.message).toMatch(/Reference: \S+\./);
    const unknown = describeDunningError(axiosError(500, {}, { 'x-request-id': 'req-9' }), 'confirm_card');
    expect(unknown.message).toContain('Reference: req-9.');
    const invalid = describeDunningError(
      axiosError(400, {
        code: 'INVALID_BILLING_REQUEST',
        message: 'approved_invoices must be a list.',
      }),
      'confirm_card',
    );
    expect(invalid.code).toBe('INVALID_REQUEST');
    expect(invalid.message).toContain('approved_invoices must be a list.');
  });

  it('B-322-5: a malformed status keeps the lockout instead of clearing it', async () => {
    const { findByTestId } = await renderScreen(LOCKED);
    await waitFor(() => expect(dunningLockoutStore.isLocked()).toBe(true));
    currentStatus = { enabled: true, state: 'surprise' };
    await act(async () => {
      dunningLockoutStore.reportLocked({
        requestId: null,
        requestUrl: '/v1/x',
      });
    });
    await findByTestId('update-card-screen');
    expect(dunningLockoutStore.isLocked()).toBe(true);
  });

  it('B-322-6: the screen reads the quote before the sheet, labels the exact amount and confirms that approval', async () => {
    backend([cardResult('paid')]);
    const { findByTestId, getByTestId } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    await findByTestId('update-card-result-paid');
    const quoteCall =
      mockGet.mock.invocationCallOrder[
        mockGet.mock.calls.findIndex(([u]) => u === '/v1/checkout/payment-method/quote')
      ];
    expect(quoteCall).toBeLessThan(mockSdk.initPaymentSheet.mock.invocationCallOrder[0]);
    expect(mockSdk.initPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryButtonLabel: 'Save card and pay $150.00',
      }),
    );
    expect(mockPost).toHaveBeenCalledWith('/v1/checkout/payment-method/confirm', CONFIRM_BODY);
  });

  it('B-322-6: approval_required shows the fresh amount and re-confirms the same card with it', async () => {
    const fresh = {
      ...QUOTE,
      quote_id: 'q2',
      lines: [...QUOTE.lines, { ...QUOTE.lines[0], invoice_id: 'in_2', amount_cents: 1000 }],
      totals: [{ currency: 'usd', amount_cents: 16000 }],
    };
    backend([
      cardResult('approval_required', {
        amount_paid_cents: 0,
        amount_due_cents: 16000,
        quote: fresh,
      }),
      cardResult('paid', { amount_paid_cents: 16000 }),
    ]);
    const { findByTestId, getByTestId, getByText } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    await findByTestId('update-card-result-approval_required');
    expect(getByText('Pay $160.00')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-resume'));
    });
    await findByTestId('update-card-result-paid');
    expect(mockPost).toHaveBeenLastCalledWith('/v1/checkout/payment-method/confirm', {
      setup_intent_id: 'seti_1',
      approved_invoices: [
        { invoice_id: 'in_1', amount_cents: 15000, currency: 'usd' },
        { invoice_id: 'in_2', amount_cents: 1000, currency: 'usd' },
      ],
    });
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('autostart with the quote unreachable shows a specific error (no uncaught rejection)', async () => {
    currentQuote = axiosError(null);
    const { findByTestId } = await renderScreen(LOCKED, true);
    const err = await findByTestId('update-card-error');
    expect(err.props.children).toContain('nothing was charged');
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it('C-322-1: "access ends now" only while a payment is overdue; otherwise period end, no refund', () => {
    expect(endPlanAlertBody(PAST_DUE)).toContain('Your access ends now');
    expect(endPlanAlertBody(CLEAR)).toContain('end of the period you already paid for');
    expect(endPlanAlertBody(CLEAR)).not.toContain('ends now');
    const kept = cancelOutcomeCopy({
      outcome: 'scheduled',
      purchase_id: 'p',
      access_ends_at: '2026-11-01T00:00:00.000Z',
      voided_invoice_count: 0,
      voided_amount_cents: 0,
      currency: 'usd',
      paid_period_kept: true,
      message: null,
    });
    expect(kept.title).toBe('Your payment went through');
    expect(kept.body).toContain('you keep access until');
    for (const t of [endPlanAlertBody(PAST_DUE), endPlanAlertBody(CLEAR), kept.body]) expect(t).not.toContain('!');
  });
});

describe('email link routing', () => {
  it('app.json registers the Android filters for the email link and the tgp billing host', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('../../../../app.json') as {
      expo: {
        android: {
          intentFilters: Array<{ data: Array<Record<string, string>> }>;
        };
      };
    };
    const data = app.expo.android.intentFilters.flatMap((f) => f.data);
    expect(data).toContainEqual({
      scheme: 'https',
      host: 'app.trygrowthproject.com',
      pathPrefix: '/billing/update-card',
    });
    expect(data).toContainEqual({ scheme: 'tgp', host: 'billing' });
  });
});

/* ------------------------------------------------------------------ */
/* S-DUNNING-R5 (Sol RC on #322 @ 0b4813dc): B-322-1, B-322-5,         */
/* B-322-7, C-322-2 and the first-person copy rule.                    */
/* ------------------------------------------------------------------ */

// The real backend #628 response for "one plan paid, the other busy",
// dumped from test/dunning-r3-money-truth-e2e.spec.ts (DUMP_R4_CONTRACT=1)
// at backend head 342283da.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BACKEND_IN_PROGRESS = require('./fixtures/backend628-in-progress.json') as Record<string, unknown>;

const PARTIAL_BANK = {
  outcome: 'requires_action',
  card: { brand: 'visa', last4: '4444', exp_month: 12, exp_year: 2030 },
  amount_paid_cents: 15000,
  amount_due_cents: 9000,
  currency: 'usd',
  paid_totals: [{ currency: 'usd', amount_cents: 15000 }],
  due_totals: [{ currency: 'usd', amount_cents: 9000 }],
  access_restored: false,
  access_state: 'partial',
  payment_intent_client_secret: 'pi_9_secret_y',
  decline_code: null,
  message: 'server copy',
};

describe('S-DUNNING-R5 B-322-1: a bank step that fails after a partial payment', () => {
  it('server re-check still waits for the bank: names what went through and says only that amount was not charged', async () => {
    backend([PARTIAL_BANK, PARTIAL_BANK]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Failed', message: 'x' },
    }));
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind).toBe('bank_pending');
    if (out.kind !== 'bank_pending') return;
    expect(out.error?.code).toBe('BANK_CONFIRMATION_FAILED');
    expect(out.error?.message).toContain('$150.00 went through');
    expect(out.error?.message).toContain('payment of $90.00, so that amount was not charged');
    expect(out.error?.message).not.toContain('nothing was charged');
    expect(out.clientSecret).toBe('pi_9_secret_y');
    // Both confirms used the same SetupIntent and approval (never a new charge).
    const confirms = mockPost.mock.calls.filter(([u]) => u === '/v1/checkout/payment-method/confirm');
    expect(confirms).toHaveLength(2);
    expect(confirms[1][1]).toEqual(CONFIRM_BODY);
  });

  it('bank SDK rejects and the re-check is lost: "not confirmed yet" with the paid amount, reported', async () => {
    backend([PARTIAL_BANK, axiosError(null), axiosError(null), axiosError(null)]);
    mockSdk.handleNextAction.mockImplementation(async () => {
      throw new Error('3ds crash');
    });
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind).toBe('bank_pending');
    if (out.kind !== 'bank_pending') return;
    expect(out.error?.code).toBe('BANK_RESULT_UNCONFIRMED');
    expect(out.error?.message).toContain('$150.00 went through');
    expect(out.error?.message).toContain('is not confirmed yet');
    expect(out.error?.message).not.toMatch(/nothing was charged|not charged/);
    expect(out.error?.reference).toBeTruthy();
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        dunning_error_code: 'BANK_RESULT_UNCONFIRMED',
        reconciled: false,
      }),
    );
  });

  it('the re-check shows the bank step actually succeeded: done/paid, no failure copy', async () => {
    backend([
      PARTIAL_BANK,
      cardResult('paid', {
        amount_paid_cents: 24000,
        access_state: 'restored',
      }),
    ]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Unknown', message: 'x' },
    }));
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'done' && out.response.outcome).toBe('paid');
  });

  it('Confirm with my bank retry (screen state): the retained paid amount stays named when the retry fails offline', async () => {
    backend([PARTIAL_BANK, PARTIAL_BANK, axiosError(null), axiosError(null), axiosError(null)]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Failed', message: 'x' },
    }));
    const { findByTestId, getByTestId } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    const first = await findByTestId('update-card-error');
    expect(first.props.children).toContain('so that amount was not charged');
    // Retry: the bank step crashes and the server cannot be asked.
    mockSdk.handleNextAction.mockImplementation(async () => {
      throw new Error('3ds crash');
    });
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-confirm-bank'));
    });
    await waitFor(() =>
      expect(getByTestId('update-card-error').props.children).toContain(
        '$150.00 went through. The bank step did not finish',
      ),
    );
    expect(getByTestId('update-card-error').props.children).not.toContain('nothing was charged');
    expect(getByTestId('update-card-confirm-bank')).toBeTruthy();
    expect(getByTestId('update-card-different')).toBeTruthy();
  });

  it('a direct confirmWithBank retry after a remount uses lastKnown for the paid amount', async () => {
    backend([axiosError(null), axiosError(null), axiosError(null)]);
    mockSdk.handleNextAction.mockImplementation(async () => ({
      error: { code: 'Failed', message: 'x' },
    }));
    const out = await confirmWithBank({
      sdk,
      surface: 'test',
      setupIntentId: 'seti_1',
      clientSecret: 'pi_9_secret_y',
      approved: APPROVED,
      retryDelaysMs: [0, 0],
      lastKnown: normalizeCardUpdate(PARTIAL_BANK),
    });
    expect(out.kind === 'bank_pending' && out.error?.message).toContain('$150.00 went through');
    expect(out.kind === 'bank_pending' && out.error?.message).not.toContain('nothing was charged');
  });
});

describe('S-DUNNING-R5 B-322-5: the quote must be complete and consistent', () => {
  const line = (id: string, amount: number, currency = 'usd') => ({
    invoice_id: id,
    purchase_id: 'p1',
    coach_name: 'Avery',
    currency,
    amount_cents: amount,
  });
  it('rejects missing totals, missing complete, mismatched totals or currencies, and duplicate invoices', () => {
    const bad: unknown[] = [
      { quote_id: 'q', complete: true, lines: [line('in_1', 15000)] },
      {
        quote_id: 'q',
        lines: [line('in_1', 15000)],
        totals: [{ currency: 'usd', amount_cents: 15000 }],
      },
      { ...QUOTE, complete: false },
      { ...QUOTE, totals: [{ currency: 'usd', amount_cents: 14999 }] },
      { ...QUOTE, totals: [{ currency: 'eur', amount_cents: 15000 }] },
      { ...QUOTE, totals: [] },
      {
        ...QUOTE,
        lines: [line('in_1', 15000), line('in_1', 15000)],
        totals: [{ currency: 'usd', amount_cents: 30000 }],
      },
      {
        ...QUOTE,
        totals: [
          { currency: 'usd', amount_cents: 15000 },
          { currency: 'usd', amount_cents: 0 },
        ],
      },
      {
        ...QUOTE,
        lines: [],
        totals: [{ currency: 'usd', amount_cents: 15000 }],
      },
    ];
    for (const q of bad) expect(() => normalizePaymentQuote(q)).toThrow('DUNNING_RESPONSE_SHAPE');
  });

  it('accepts multi-currency quotes and the complete empty quote ("Save card")', () => {
    const multi = normalizePaymentQuote({
      ...QUOTE,
      lines: [line('in_1', 15000), line('in_2', 5000), line('in_3', 2000, 'eur')],
      totals: [
        { currency: 'eur', amount_cents: 2000 },
        { currency: 'usd', amount_cents: 20000 },
      ],
    });
    expect(sheetButtonLabel(multi)).toBe('Save card and pay 20.00 EUR and $200.00');
    const empty = normalizePaymentQuote({
      quote_id: 'q0',
      complete: true,
      lines: [],
      totals: [],
      disputes: [],
    });
    expect(sheetButtonLabel(empty)).toBe('Save card');
  });

  it('an inconsistent quote stops before the card form with specific copy and a reference', async () => {
    currentQuote = { ...QUOTE, totals: [{ currency: 'usd', amount_cents: 1 }] };
    const { findByTestId, getByTestId } = await renderScreen(LOCKED);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    const err = await findByTestId('update-card-error');
    expect(err.props.children).toContain('The amount you owe did not load in full');
    expect(err.props.children).toContain('nothing was charged');
    expect(err.props.children).toMatch(/Reference: \S+/);
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalledWith('/v1/checkout/payment-method/confirm', expect.anything());
  });
});

describe('S-DUNNING-R5 B-322-7: in_progress (paired with the backend #628 response)', () => {
  it('the real backend in_progress response normalizes and keeps the paid amount', () => {
    const r = normalizeCardUpdate(BACKEND_IN_PROGRESS);
    expect(r.outcome).toBe('in_progress');
    expect(r.paid_totals).toEqual([{ currency: 'usd', amount_cents: 15000 }]);
    expect(r.access_state).toBe('partial');
    const c = cardUpdateOutcomeCopy(r);
    expect(c.title).toBe('Part of your payment went through');
    expect(c.body).toContain('Your card ending 4242 is saved and $150.00 went through.');
    expect(c.body).toContain('Tap Check again');
    expect(c.body).not.toContain('nothing was charged');
    expect(c.tone).toBe('action');
  });

  it('the screen shows the known payment and "Check again" repeats the same confirm', async () => {
    const paid = {
      ...BACKEND_IN_PROGRESS,
      outcome: 'paid',
      access_state: 'restored',
      access_restored: true,
    };
    backend([BACKEND_IN_PROGRESS, paid]);
    const { findByTestId, getByTestId, getByText } = await renderScreen(PAST_DUE);
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-add'));
    });
    await findByTestId('update-card-result-in_progress');
    expect(getByText('Check again')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('update-card-resume'));
    });
    await findByTestId('update-card-result-paid');
    const confirms = mockPost.mock.calls.filter(([u]) => u === '/v1/checkout/payment-method/confirm');
    expect(confirms).toHaveLength(2);
    expect(confirms[1][1]).toEqual(confirms[0][1]);
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });
});

describe('S-DUNNING-R5 C-322-2 and copy rules', () => {
  it('processing after a partial payment leads with what went through', () => {
    const c = cardUpdateOutcomeCopy(
      normalizeCardUpdate({
        ...PARTIAL_BANK,
        outcome: 'processing',
        payment_intent_client_secret: null,
      }),
    );
    expect(c.body).toContain('$150.00 went through. The payment of $90.00 is processing.');
    expect(c.title).toBe('Part of your payment went through');
  });

  it('client-facing dunning copy never speaks as "we" / "our"', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    const dir = path.join(__dirname, '..');
    for (const file of [
      'dunningErrorCopy.ts',
      'UpdateCardScreen.tsx',
      'DunningBanner.tsx',
      'DunningLockoutScreen.tsx',
    ]) {
      const src: string = fs.readFileSync(path.join(dir, file), 'utf8');
      const literals =
        src
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .join('\n')
          .match(/(['`"])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      const offending = literals.filter((t) => /\b(we|We|our|Our|us)\b/.test(t));
      expect({ file, offending }).toEqual({ file, offending: [] });
    }
  });
});
