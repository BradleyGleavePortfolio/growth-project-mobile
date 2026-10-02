import type * as StripeRN from '@stripe/stripe-react-native';
import { resolveStripePublishableKey } from '../../config/stripe';
import { captureError } from '../../services/sentry';
import { dunningApi, type CardUpdateResponse } from './dunningApi';
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
  | { kind: 'error'; error: DunningErrorCopy };

export interface NativeCardUpdateOptions {
  surface: string;
  colorScheme: 'light' | 'dark';
  /** "Save card" outside dunning; "Save and pay $150.00" while a payment is owed. */
  primaryButtonLabel: string;
  /** Injected in tests; defaults to the lazily loaded SDK. */
  sdk?: StripeSdk | null;
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
    return fail(describeDunningError(err, 'update_card'), surface, err, { step: 'setup_intent' });
  }

  // The backend key always matches the secret key that minted the
  // SetupIntent (same mode, same account); the build-time key is the fallback.
  const publishableKey = setup.publishable_key ?? resolveStripePublishableKey();
  if (!publishableKey) {
    return fail(localDunningError('PAYMENTS_NOT_CONFIGURED'), surface, null);
  }

  try {
    await sdk.initStripe({ publishableKey, urlScheme: STRIPE_URL_SCHEME, setReturnUrlSchemeOnAndroid: true });
    const init = await sdk.initPaymentSheet({
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
    if (init.error) {
      return fail(localDunningError('CARD_SHEET_FAILED'), surface, new Error('PAYMENT_SHEET_INIT'), {
        stripe_error_code: init.error.code,
      });
    }
  } catch (err) {
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, err, { step: 'sheet_init' });
  }

  const presented = await sdk.presentPaymentSheet();
  if (presented.error) {
    if (presented.error.code === 'Canceled') return { kind: 'canceled' };
    return fail(localDunningError('CARD_SHEET_FAILED'), surface, new Error('PAYMENT_SHEET_PRESENT'), {
      stripe_error_code: presented.error.code,
    });
  }
  if (presented.didCancel) return { kind: 'canceled' };

  return confirmWithBank({ sdk, surface, setupIntentId: setup.setup_intent_id, clientSecret: null });
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
      const next = await sdk.handleNextAction(pendingSecret, STRIPE_RETURN_URL);
      if (next.error) {
        if (next.error.code === 'Canceled') {
          // Closed the bank sheet: the card stays saved, the invoice stays open.
          return last ? { kind: 'done', response: last, setupIntentId } : { kind: 'canceled' };
        }
        return fail(localDunningError('BANK_CONFIRMATION_FAILED'), surface, null, {
          stripe_error_code: next.error.code,
        });
      }
    }
    try {
      last = await dunningApi.confirmCardUpdate(setupIntentId);
    } catch (err) {
      return fail(describeDunningError(err, 'update_card'), surface, err, { step: 'confirm' });
    }
    if (last.outcome !== 'requires_action' || !last.payment_intent_client_secret) {
      return { kind: 'done', response: last, setupIntentId };
    }
    if (last.payment_intent_client_secret === pendingSecret) {
      // The bank step succeeded but the same payment still asks for it.
      return { kind: 'done', response: last, setupIntentId };
    }
    pendingSecret = last.payment_intent_client_secret;
  }
  return last ? { kind: 'done', response: last, setupIntentId } : fail(localDunningError('UNEXPECTED_RESPONSE'), surface, null);
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
