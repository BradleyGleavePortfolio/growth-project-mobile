import type * as StripeRN from '@stripe/stripe-react-native';
import { resolveStripePublishableKey } from '../../config/stripe';
import { captureError } from '../../services/sentry';
import { dunningApi, type ApprovedInvoice, type CardUpdateResponse } from './dunningApi';
import { describeDunningError, localDunningError, type DunningErrorCopy } from './dunningErrorCopy';
import { buildPaymentSheetAppearance, sheetStyleFor } from './paymentSheetAppearance';

/**
 * Native card update (OR-110-2), replacing the Stripe-hosted portal on the
 * client's dunning surfaces.
 *
 *   backend SetupIntent  ->  PaymentSheet (TGP-themed)  ->  backend confirm
 *                                                           (default card +
 *                                                            1A: pay now)
 *
 * When the bank wants the client to confirm the payment (3DS), the SDK's
 * handleNextAction runs on the PaymentIntent the backend returns, then the
 * confirm call is repeated. Every backend step is idempotent, so a retry
 * after a lost answer can never charge twice.
 */

export type StripeSdk = Pick<
  typeof StripeRN,
  'initStripe' | 'initPaymentSheet' | 'presentPaymentSheet' | 'handleNextAction' | 'handleURLCallback'
>;

/** Registered app scheme (app.json `scheme`); Stripe returns here after a bank redirect. */
export const STRIPE_URL_SCHEME = 'tgp';
export const STRIPE_RETURN_URL = 'tgp://stripe-redirect';

let cachedSdk: StripeSdk | null | undefined;

/**
 * Lazy so a build without the native module (Expo Go, an old binary) shows a
 * specific "update the app" message instead of crashing on import.
 */
export function loadStripeSdk(): StripeSdk | null {
  if (cachedSdk !== undefined) return cachedSdk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: Partial<StripeSdk> = require('@stripe/stripe-react-native');
    cachedSdk =
      typeof mod.initStripe === 'function' &&
      typeof mod.initPaymentSheet === 'function' &&
      typeof mod.presentPaymentSheet === 'function' &&
      typeof mod.handleNextAction === 'function' &&
      typeof mod.handleURLCallback === 'function'
        ? (mod as StripeSdk)
        : null;
  } catch {
    cachedSdk = null;
  }
  return cachedSdk;
}

/** Test seam. */
export function __resetStripeSdkForTests(): void {
  cachedSdk = undefined;
}

export type NativeCardUpdateResult =
  /** The client closed the card form; nothing was saved or charged. */
  | { kind: 'canceled' }
  /** The backend answered; `response.outcome` says what happened to the money. */
  | { kind: 'done'; response: CardUpdateResponse; setupIntentId: string }
  /**
   * The card is saved and the bank must confirm a payment, but the bank
   * step was closed or failed (B-322-3). The SetupIntent and the bank
   * secret are kept so "Confirm with my bank" works without a new card.
   */
  | {
      kind: 'bank_pending';
      setupIntentId: string;
      clientSecret: string;
      response: CardUpdateResponse | null;
      error: DunningErrorCopy | null;
    }
  /**
   * The confirm answer was lost (offline / gateway timeout) even after
   * retries (B-322-2): the payment may have gone through. The screen shows
   * "confirming" and can repeat the same confirm safely.
   */
  | { kind: 'unconfirmed'; setupIntentId: string; error: DunningErrorCopy }
  | { kind: 'error'; error: DunningErrorCopy };

export interface NativeCardUpdateOptions {
  surface: string;
  colorScheme: 'light' | 'dark';
  /** "Save card" outside dunning; "Save card and pay $150.00" while a payment is owed. */
  primaryButtonLabel: string;
  /** The exact open invoices the client approved on the quote (B-322-6). */
  approved: ApprovedInvoice[];
  /** Injected in tests; defaults to the lazily loaded SDK. */
  sdk?: StripeSdk | null;
  /** Called when the confirm answer was lost and the app is re-asking. */
  onConfirming?: () => void;
  /** Backoff between confirm re-asks after a lost answer (tests pass zeros). */
  retryDelaysMs?: number[];
}

function fail(error: DunningErrorCopy, surface: string, err: unknown, extra: Record<string, unknown> = {}) {
  if (error.report) {
    captureError(err ?? new Error(error.code), {
      surface,
      dunning_error_code: error.code,
      request_id: error.reference,
      ...extra,
    });
  }
  return { kind: 'error' as const, error };
}

/** Run one native SDK call; a rejected promise becomes a value, never an uncaught throw (B-322-4). */
async function guarded<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

function isLostAnswer(err: unknown): boolean {
  const e = (err ?? {}) as {
    message?: unknown;
    response?: { status?: number; data?: { code?: unknown } };
  };
  if (e.message === 'DUNNING_RESPONSE_SHAPE') return false;
  if (!e.response) return true;
  const status = e.response.status ?? 0;
  return (status === 502 || status === 503 || status === 504) && typeof e.response.data?.code !== 'string';
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runNativeCardUpdate(opts: NativeCardUpdateOptions): Promise<NativeCardUpdateResult> {
  const { surface } = opts;
  const sdk = opts.sdk === undefined ? loadStripeSdk() : opts.sdk;
  if (!sdk) {
    return fail(localDunningError('CARD_SHEET_UNAVAILABLE'), surface, null);
  }

  let setup;
  try {
    setup = await dunningApi.createCardSetup();
  } catch (err) {
    return fail(describeDunningError(err, 'update_card'), surface, err, {
      step: 'setup_intent',
    });
  }

  // The backend key always matches the secret key that minted the
  // SetupIntent (same mode, same account); the build-time key is the fallback.
  const publishableKey = setup.publishable_key ?? resolveStripePublishableKey();
  if (!publishableKey) {
    return fail(localDunningError('PAYMENTS_NOT_CONFIGURED'), surface, null);
  }

  const init = await guarded(async () => {
    await sdk.initStripe({
      publishableKey,
      urlScheme: STRIPE_URL_SCHEME,
      setReturnUrlSchemeOnAndroid: true,
    });
    return sdk.initPaymentSheet({
      merchantDisplayName: setup.merchant_display_name,
      customerId: setup.customer_id,
      customerEphemeralKeySecret: setup.ephemeral_key,
      setupIntentClientSecret: setup.setup_intent_client_secret,
      returnURL: STRIPE_RETURN_URL,
      allowsDelayedPaymentMethods: false,
      primaryButtonLabel: opts.primaryButtonLabel,
      style: sheetStyleFor(opts.colorScheme),
      appearance: buildPaymentSheetAppearance(),
    });
  });
  if (!init.ok) {
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, init.err, {
      step: 'sheet_init',
    });
  }
  if (init.value?.error) {
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, new Error('PAYMENT_SHEET_INIT'), {
      stripe_error_code: init.value.error.code,
    });
  }

  const presented = await guarded(() => sdk.presentPaymentSheet());
  if (!presented.ok) {
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, presented.err, { step: 'sheet_present' });
  }
  if (presented.value?.error) {
    if (presented.value.error.code === 'Canceled') return { kind: 'canceled' };
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, new Error('PAYMENT_SHEET_PRESENT'), {
      stripe_error_code: presented.value.error.code,
    });
  }
  if ((presented.value as { didCancel?: boolean } | undefined)?.didCancel) return { kind: 'canceled' };

  return confirmWithBank({
    sdk,
    surface,
    setupIntentId: setup.setup_intent_id,
    clientSecret: null,
    approved: opts.approved,
    onConfirming: opts.onConfirming,
    retryDelaysMs: opts.retryDelaysMs,
  });
}

/** One confirm call; a lost answer is re-asked with the same SetupIntent and approval. */
async function confirmOnce(args: {
  surface: string;
  setupIntentId: string;
  approved: ApprovedInvoice[];
  onConfirming?: () => void;
  retryDelaysMs?: number[];
}): Promise<{ ok: true; response: CardUpdateResponse } | { ok: false; result: NativeCardUpdateResult }> {
  const delays = args.retryDelaysMs ?? [1000, 3000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) {
      args.onConfirming?.();
      await wait(delays[attempt - 1]);
    }
    try {
      return {
        ok: true,
        response: await dunningApi.confirmCardUpdate(args.setupIntentId, args.approved),
      };
    } catch (err) {
      lastErr = err;
      if (!isLostAnswer(err)) {
        return {
          ok: false,
          result: fail(describeDunningError(err, 'confirm_card'), args.surface, err, { step: 'confirm' }),
        };
      }
    }
  }
  const error = describeDunningError(lastErr, 'confirm_card');
  if (error.report) {
    captureError(lastErr ?? new Error(error.code), {
      surface: args.surface,
      dunning_error_code: error.code,
      request_id: error.reference,
      step: 'confirm_lost_answer',
    });
  }
  return {
    ok: false,
    result: { kind: 'unconfirmed', setupIntentId: args.setupIntentId, error },
  };
}

/**
 * Confirm the saved card with the backend, handling a bank confirmation
 * (3DS) in between. With `clientSecret` set, starts with the bank step (the
 * "Confirm with my bank" retry after the client closed the bank sheet).
 */
export async function confirmWithBank(args: {
  sdk?: StripeSdk | null;
  surface: string;
  setupIntentId: string;
  clientSecret: string | null;
  approved: ApprovedInvoice[];
  onConfirming?: () => void;
  retryDelaysMs?: number[];
}): Promise<NativeCardUpdateResult> {
  const { surface, setupIntentId } = args;
  const sdk = args.sdk === undefined ? loadStripeSdk() : args.sdk;
  let pendingSecret = args.clientSecret;
  let last: CardUpdateResponse | null = null;
  // Each round settles one invoice that needed the bank; three covers a
  // client with more than one open invoice without looping forever.
  for (let round = 0; round < 3; round += 1) {
    if (pendingSecret) {
      if (!sdk) return fail(localDunningError('CARD_SHEET_UNAVAILABLE'), surface, null);
      const secret = pendingSecret;
      const next = await guarded(() => sdk.handleNextAction(secret, STRIPE_RETURN_URL));
      const nextError = next.ok ? next.value?.error : { code: 'Failed' };
      if (nextError) {
        const canceled = nextError.code === 'Canceled';
        const error = canceled ? null : localDunningError('BANK_CONFIRMATION_FAILED');
        if (error) {
          captureError(next.ok ? new Error('HANDLE_NEXT_ACTION') : next.err, {
            surface,
            dunning_error_code: error.code,
            stripe_error_code: nextError.code,
          });
        }
        // B-322-3: keep the SetupIntent and the bank secret for a retry.
        return {
          kind: 'bank_pending',
          setupIntentId,
          clientSecret: secret,
          response: last,
          error,
        };
      }
    }
    const out = await confirmOnce({ ...args, setupIntentId });
    if (!out.ok) return out.result;
    last = out.response;
    if (last.outcome !== 'requires_action' || !last.payment_intent_client_secret) {
      return { kind: 'done', response: last, setupIntentId };
    }
    if (last.payment_intent_client_secret === pendingSecret) {
      // The bank step succeeded but the same payment still asks for it.
      return { kind: 'done', response: last, setupIntentId };
    }
    pendingSecret = last.payment_intent_client_secret;
  }
  return last
    ? { kind: 'done', response: last, setupIntentId }
    : fail(localDunningError('UNEXPECTED_RESPONSE'), surface, null);
}

/**
 * Hand a `tgp://stripe-redirect` return (bank redirect during 3DS) back to the
 * SDK. Returns true when Stripe consumed it.
 */
export async function handleStripeReturnUrl(url: string | null | undefined): Promise<boolean> {
  if (!url || !url.toLowerCase().startsWith(STRIPE_RETURN_URL)) return false;
  const sdk = loadStripeSdk();
  if (!sdk) return false;
  try {
    return await sdk.handleURLCallback(url);
  } catch {
    return false;
  }
}
