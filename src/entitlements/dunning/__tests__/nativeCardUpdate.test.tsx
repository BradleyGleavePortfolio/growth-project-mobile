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
  type ClientDunningStatus,
} from '../dunningApi';
import { cancelOutcomeCopy, cardUpdateOutcomeCopy } from '../dunningErrorCopy';
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
import { UpdateCardScreen, sheetButtonLabel, updateCardIntro } from '../UpdateCardScreen';

jest.mock('../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../theme/tokens').default;
  return { useTheme: () => ({ semanticColors: t.lightTokens, tokens: t, colorScheme: 'light' }) };
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
}));

type SdkErrorDouble = { code: string; message: string };
type NextActionDouble = { paymentIntent?: { status: string }; error?: SdkErrorDouble };
const mockSdk = {
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
  handleNextAction: jest.fn(async (): Promise<NextActionDouble> => ({ paymentIntent: { status: 'Succeeded' } })),
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
const PAST_DUE: ClientDunningStatus = { ...LOCKED, state: 'past_due', locked_at: null, day: 3 };
const CLEAR: ClientDunningStatus = { ...LOCKED, state: 'none', amount_cents: null, day: null, locked_at: null };

const OPTS = { surface: 'test', colorScheme: 'light' as const, primaryButtonLabel: 'Save and pay $150.00', sdk };

beforeEach(() => {
  jest.clearAllMocks();
  __resetStripeSdkForTests();
  dunningLockoutStore.__resetForTests();
  mockSdk.presentPaymentSheet.mockImplementation(async () => ({}));
  mockSdk.initPaymentSheet.mockImplementation(async () => ({}));
  mockSdk.handleNextAction.mockImplementation(async () => ({ paymentIntent: { status: 'Succeeded' } }));
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
        primaryButtonLabel: 'Save and pay $150.00',
        style: 'alwaysLight',
        appearance: buildPaymentSheetAppearance(),
      }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(2, '/v1/checkout/payment-method/confirm', { setup_intent_id: 'seti_1' });
    expect(out).toEqual({ kind: 'done', response: normalizeCardUpdate(cardResult('paid')), setupIntentId: 'seti_1' });
    if (out.kind === 'done') {
      expect(out.response.amount_paid_cents).toBe(15000);
      expect(Number.isInteger(out.response.amount_paid_cents)).toBe(true);
    }
  });

  it('closing the sheet saves nothing and never calls confirm', async () => {
    backend([]);
    mockSdk.presentPaymentSheet.mockImplementation(async () => ({ error: { code: 'Canceled', message: 'x' } }));
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
    backend([cardResult('requires_action', { payment_intent_client_secret: 'pi_9_secret_y' }), cardResult('paid')]);
    const out = await runNativeCardUpdate(OPTS);
    expect(mockSdk.handleNextAction).toHaveBeenCalledWith('pi_9_secret_y', 'tgp://stripe-redirect');
    const confirms = mockPost.mock.calls.filter(([u]) => u === '/v1/checkout/payment-method/confirm');
    expect(confirms).toEqual([
      ['/v1/checkout/payment-method/confirm', { setup_intent_id: 'seti_1' }],
      ['/v1/checkout/payment-method/confirm', { setup_intent_id: 'seti_1' }],
    ]);
    expect(out.kind === 'done' && out.response.outcome).toBe('paid');
  });

  it('closing the bank sheet keeps the card and offers "Confirm with my bank" (no second card entry)', async () => {
    backend([cardResult('requires_action', { payment_intent_client_secret: 'pi_9_secret_y' })]);
    mockSdk.handleNextAction.mockImplementation(async () => ({ error: { code: 'Canceled', message: 'x' } }));
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'done' && out.response.outcome).toBe('requires_action');
    // Retry from the screen: bank step first, then confirm.
    mockSdk.handleNextAction.mockImplementation(async () => ({ paymentIntent: { status: 'Succeeded' } }));
    backend([cardResult('paid')]);
    const retry = await confirmWithBank({ sdk, surface: 'test', setupIntentId: 'seti_1', clientSecret: 'pi_9_secret_y' });
    expect(retry.kind === 'done' && retry.response.outcome).toBe('paid');
    expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('a failed bank step is truthful: card saved, nothing charged', async () => {
    backend([cardResult('requires_action', { payment_intent_client_secret: 'pi_9_secret_y' })]);
    mockSdk.handleNextAction.mockImplementation(async () => ({ error: { code: 'Failed', message: 'x' } }));
    const out = await runNativeCardUpdate(OPTS);
    expect(out.kind === 'error' && out.error.code).toBe('BANK_CONFIRMATION_FAILED');
    expect(out.kind === 'error' && out.error.message).toContain('nothing was charged');
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
    expect(out.kind === 'error' && out.error.message).toContain('could not confirm whether your payment went through');
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
  it('maps light and dark semantic tokens, all #RRGGBB, square primary button', () => {
    const a = buildPaymentSheetAppearance();
    expect(a.colors.light.primary).toBe(realTokens.lightTokens.accent);
    expect(a.colors.light.background).toBe(realTokens.lightTokens.bgPrimary);
    expect(a.colors.dark.background).toBe(realTokens.darkTokens.bgPrimary);
    expect(a.primaryButton.colors.light.text).toBe(realTokens.lightTokens.textOnAccent);
    expect(a.primaryButton.shapes.borderRadius).toBe(0);
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
      const c = cardUpdateOutcomeCopy(normalizeCardUpdate(cardResult(o)));
      return `${c.title} ${c.body}`;
    });
    expect(texts[0]).toContain('$150.00 went through');
    expect(texts[1]).toContain('Your next payment will use it');
    expect(texts[4]).toContain('declined the payment of $150.00, so nothing was charged');
    const cancel = [
      cancelOutcomeCopy({ outcome: 'ended', purchase_id: 'p', access_ends_at: null, voided_invoice_count: 1, voided_amount_cents: 15000, currency: 'usd' }),
      cancelOutcomeCopy({ outcome: 'scheduled', purchase_id: 'p', access_ends_at: '2026-11-01T00:00:00.000Z', voided_invoice_count: 0, voided_amount_cents: 0, currency: 'usd' }),
      cancelOutcomeCopy({ outcome: 'already_ended', purchase_id: 'p', access_ends_at: null, voided_invoice_count: 0, voided_amount_cents: 0, currency: 'usd' }),
    ];
    expect(cancel[0].body).toContain('The unpaid $150.00 is canceled');
    expect(cancel[1].body).toContain('the end of the period you paid for');
    for (const t of [...texts, ...cancel.map((c) => c.title + c.body)]) expect(t).not.toContain('!');
    expect(formatDunningAmount(15000, 'jpy')).toBe('15000 JPY');
  });

  it('intro and sheet label say what will be charged before the client acts', () => {
    expect(updateCardIntro(LOCKED)).toContain('we charge $150.00 to it right away');
    expect(updateCardIntro(PAST_DUE)).toContain('You keep full access');
    expect(updateCardIntro(CLEAR)).toContain('If a payment is overdue');
    expect(sheetButtonLabel(LOCKED)).toBe('Save and pay $150.00');
    expect(sheetButtonLabel(CLEAR)).toBe('Save card');
  });
});

async function renderScreen(status: ClientDunningStatus, autostart = false) {
  mockGet.mockResolvedValue({ data: status });
  const navigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };
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
      if (url === '/v1/checkout/payment-method/confirm') mockGet.mockResolvedValue({ data: CLEAR });
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
    backend([cardResult('requires_action', { payment_intent_client_secret: 'pi_9_secret_y' })]);
    mockSdk.handleNextAction.mockImplementationOnce(async () => ({ error: { code: 'Canceled', message: 'x' } }));
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
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
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

describe('email link routing', () => {
  it('app.json registers the Android filters for the email link and the tgp billing host', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('../../../../app.json') as {
      expo: { android: { intentFilters: Array<{ data: Array<Record<string, string>> }> } };
    };
    const data = app.expo.android.intentFilters.flatMap((f) => f.data);
    expect(data).toContainEqual({ scheme: 'https', host: 'app.trygrowthproject.com', pathPrefix: '/billing/update-card' });
    expect(data).toContainEqual({ scheme: 'tgp', host: 'billing' });
  });
});
