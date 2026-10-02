/**
 * Package payment for the Day 1 / package_prompt sheet (PackageSelectionSheet).
 *
 * OR-112-22: the sheet used to POST { package_id, idempotency_key } to
 * /v1/checkout/sessions. That DTO has no idempotency_key, so the global
 * ValidationPipe (forbidNonWhitelisted) answered 400, and that route returns a
 * hosted Checkout URL, never PaymentSheet secrets. No client could pay there.
 *
 * Backend contract (growth-project-backend main 9cfd70d6):
 *   POST /v1/checkout/payment-intent
 *     body  CreatePaymentIntentDto (src/checkout/checkout.controller.ts):
 *             package_id       @IsUUID()
 *             idempotency_key  @IsUUID()
 *           nothing else (whitelist + forbidNonWhitelisted)
 *     200   { client_secret, ephemeral_key, customer_id, publishable_key }
 *           (CheckoutService.createPaymentIntentForClient). Same (client, key)
 *           returns the same PaymentIntent without a second Stripe call, so a
 *           retry of one attempt can never charge twice.
 *     errors carry the machine code in `error` (HttpExceptionFilter keeps the
 *           thrown body's `error`), plus `request_id`:
 *             404 PACKAGE_NOT_FOUND, CLIENT_NOT_FOUND, COACH_NOT_FOUND
 *             400 PACKAGE_IS_FREE
 *             409 COACH_NOT_CONNECTED, COACH_NOT_PAYOUT_READY,
 *                 CONTRACT_SIGNATURE_REQUIRED
 *             503 CONNECT_NOT_CONFIGURED, PAYMENT_IN_PROGRESS, PAYMENT_RETRY
 *             429 throttle (checkout-mint, per hour; body has retryAfter)
 *             4xx/5xx STRIPE_CHECKOUT_ERROR, INTERNAL
 *   POST /v1/packages/:id/claim-free (src/invite-grant/invite-grant.controller.ts)
 *     $0 packages never reach Stripe; 200 { active, status, ... },
 *     400 PACKAGE_NOT_FREE, 404 PACKAGE_NOT_FOUND, 409 GRANT_REVOKED.
 *
 * Privacy: the client secret and ephemeral key live only in memory for the
 * one PaymentSheet call. Nothing here logs them, and Sentry reports carry
 * status, machine code, Stripe error code and the short reference only.
 */
import api from '../services/api';
import { captureError } from '../services/sentry';
import { errorStatus } from '../types/common';
import { shortReference, supportReferenceOf } from '../utils/correlation';

export const PAYMENT_INTENT_PATH = '/v1/checkout/payment-intent';
export const claimFreePath = (packageId: string) =>
  `/v1/packages/${encodeURIComponent(packageId)}/claim-free`;

/** Exactly the fields of the backend CreatePaymentIntentDto. */
export interface PaymentIntentRequest {
  package_id: string;
  idempotency_key: string;
}

export interface PaymentSheetSecrets {
  clientSecret: string;
  ephemeralKey: string;
  customerId: string;
  /** '' when the backend did not send one; the caller falls back to the build key. */
  publishableKey: string;
}

/** Thrown when a 200 does not carry what PaymentSheet needs. */
export class PaymentIntentShapeError extends Error {
  constructor() {
    super('PAYMENT_INTENT_RESPONSE_SHAPE');
    this.name = 'PaymentIntentShapeError';
  }
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export async function createPackagePaymentIntent(
  packageId: string,
  idempotencyKey: string,
): Promise<PaymentSheetSecrets> {
  const body: PaymentIntentRequest = { package_id: packageId, idempotency_key: idempotencyKey };
  const res = await api.post<Record<string, unknown>>(PAYMENT_INTENT_PATH, body);
  const d = res?.data ?? {};
  if (!nonEmpty(d.client_secret) || !nonEmpty(d.ephemeral_key) || !nonEmpty(d.customer_id)) {
    throw new PaymentIntentShapeError();
  }
  return {
    clientSecret: d.client_secret,
    ephemeralKey: d.ephemeral_key,
    customerId: d.customer_id,
    publishableKey: nonEmpty(d.publishable_key) ? d.publishable_key : '',
  };
}

/** `true` when the free plan is active now; `false` when it is saved but waiting on consent. */
export async function claimFreePackage(packageId: string): Promise<boolean> {
  const res = await api.post<{ active?: unknown }>(claimFreePath(packageId));
  return res?.data?.active === true;
}

// ─── Stripe SDK ────────────────────────────────────────────────────────────

export interface StripeSdkError {
  code?: string;
  declineCode?: string;
  stripeErrorCode?: string;
  type?: string;
}

export interface PackageStripeSdk {
  initStripe: (params: {
    publishableKey: string;
    urlScheme?: string;
    setReturnUrlSchemeOnAndroid?: boolean;
  }) => Promise<void>;
  initPaymentSheet: (params: Record<string, unknown>) => Promise<{ error?: StripeSdkError }>;
  presentPaymentSheet: () => Promise<{ error?: StripeSdkError }>;
}

/** App scheme (app.json `scheme`); Stripe returns here after a bank redirect. */
export const STRIPE_URL_SCHEME = 'tgp';
export const STRIPE_RETURN_URL = 'tgp://stripe-redirect';

/**
 * Lazy so a build without the native module (Expo Go, an old binary) gets a
 * specific "update the app" message instead of a crash on import.
 */
export function loadPackageStripeSdk(): PackageStripeSdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: Partial<PackageStripeSdk> = require('@stripe/stripe-react-native');
    return typeof mod.initStripe === 'function' &&
      typeof mod.initPaymentSheet === 'function' &&
      typeof mod.presentPaymentSheet === 'function'
      ? (mod as PackageStripeSdk)
      : null;
  } catch {
    return null;
  }
}

// ─── What the client is told ──────────────────────────────────────────────

export const PACKAGE_PAYMENT_COPY = {
  offline:
    'This phone is offline, so the payment did not start and your card was not charged. Check your connection, then choose Select this plan again.',
  connectionDropped:
    'The connection dropped during the payment. Check your connection, then choose Select this plan again. Your plan shows in the app as soon as a payment goes through.',
  sessionEnded: 'Your session has ended. Sign in again, then choose your plan.',
  sdkMissing:
    'Card payments need the latest version of the app. Update the app from your app store, then choose your plan again.',
  declined:
    'Your bank declined this card, so nothing was charged. Choose Select this plan to use a different card, or ask your bank about the decline.',
  insufficientFunds:
    'This card does not have enough funds, so nothing was charged. Choose Select this plan to use a different card.',
  expiredCard:
    'This card has expired, so nothing was charged. Choose Select this plan to use a different card.',
  incorrectDetails:
    'The card number or security code did not match, so nothing was charged. Choose Select this plan and check the card details.',
  authFailed:
    'Your bank could not confirm this payment, so nothing was charged. Choose Select this plan to confirm with your bank again or use a different card.',
  sheetTimeout:
    'The payment form closed before the payment finished, so nothing was charged. Choose Select this plan to start again.',
  packageUnavailable:
    'This plan is no longer offered. Choose another plan below, or message your coach about it.',
  coachNotReady:
    'Your coach has not finished setting up card payments yet, so this plan cannot be bought right now. Message your coach, then choose Select this plan once they are set up.',
  contractRequired:
    'This plan needs a signed coaching agreement before payment. Message your coach for the agreement, then choose Select this plan again.',
  inProgress:
    'This payment is still being set up. Wait a few seconds, then choose Select this plan again. You will not be charged twice.',
  retrySameAttempt:
    'The last payment attempt did not finish and nothing was charged. Choose Select this plan again to continue.',
  rateLimited: (minutes: number) =>
    `There have been too many payment attempts. Wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, then choose Select this plan again.`,
  recurringElsewhere:
    'Plans that renew each month or year are started from Membership. Choose Skip for now, then open More, Membership and View coaching plans.',
  freePending:
    'This free plan is saved. It starts once your coaching agreement is accepted. Message your coach if it does not start.',
  freeRevoked:
    'Your coach removed this plan from your account. Message your coach to have it restored.',
  priceChanged:
    'The price of this plan has changed. Close this sheet and open your plans again to see the current price.',
  paymentsOff: (ref: string | null) =>
    `Card payments are not switched on for this app yet, so nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ''}.`,
  unknown: (ref: string | null) =>
    `The payment did not go through and nothing was charged. Email support${ref ? ` and quote reference ${ref}` : ''}, and the team will sort it out with you.`,
  confirming: 'Payment received. Setting up your plan.',
  confirmingFree: 'Adding your free plan.',
  confirmedPending:
    'Your payment went through. Your plan can take a minute to show in the app. Choose Continue to carry on.',
  confirmedPendingFree:
    'Your free plan is added. It can take a minute to show in the app. Choose Continue to carry on.',
  supportAction: 'Email support',
  supportSubject: (ref: string | null) =>
    ref ? `Help with a plan payment (ref ${ref})` : 'Help with a plan payment',
} as const;

export interface PackagePaymentNotice {
  message: string;
  /** Stable machine name of the cause, for tests and Sentry. */
  cause: string;
  /** Show the support email action. */
  support: boolean;
  /** Short reference shown to the client and sent to Sentry. */
  reference: string | null;
  /** 'info' for guidance that is not a failure (renewing plan, free plan waiting on consent). */
  tone?: 'info';
}

export type PaymentStep = 'payment_intent' | 'claim_free' | 'sheet_init' | 'sheet_present' | 'config';

/**
 * Report an unexpected failure. Only status, machine code, Stripe error code
 * and the short reference: never the request, the response or a secret.
 */
export function reportPackagePaymentFailure(
  step: PaymentStep,
  notice: PackagePaymentNotice,
  extra: { status?: number | null; code?: string | null; stripe?: StripeSdkError | null } = {},
): void {
  try {
    captureError(new Error(`package sheet payment failed: ${notice.cause}`), {
      where: 'PackageSelectionSheet',
      step,
      cause: notice.cause,
      status: extra.status ?? null,
      code: extra.code ?? null,
      reference: notice.reference,
      stripe_error_code: extra.stripe?.code ?? null,
      stripe_decline_code: extra.stripe?.declineCode ?? null,
      stripe_error_type: extra.stripe?.type ?? null,
    });
  } catch {
    // Reporting can never break the payment flow.
  }
}

/** The backend machine code (`code`, else the thrown body's `error`), or null. */
export function backendCodeOf(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as { code?: unknown; error?: unknown };
  if (typeof d.code === 'string' && d.code) return d.code;
  if (typeof d.error === 'string' && d.error) return d.error;
  return null;
}

function retryAfterMinutes(err: unknown): number {
  const data = (err as { response?: { data?: { retryAfter?: unknown } } } | null)?.response?.data;
  const seconds = typeof data?.retryAfter === 'number' && data.retryAfter > 0 ? data.retryAfter : 3600;
  return Math.max(1, Math.ceil(seconds / 60));
}

function notice(cause: string, message: string): PackagePaymentNotice {
  return { cause, message, support: false, reference: null };
}

function supportNotice(cause: string, ref: string | null, paymentsOff = false): PackagePaymentNotice {
  return {
    cause,
    message: paymentsOff ? PACKAGE_PAYMENT_COPY.paymentsOff(ref) : PACKAGE_PAYMENT_COPY.unknown(ref),
    support: true,
    reference: ref,
  };
}

/**
 * Map a failed backend call (payment-intent or claim-free) to what the client
 * is told. `attemptRef` is the short form of this attempt's idempotency key,
 * used when the server sent no request id.
 */
export function describeBackendFailure(
  err: unknown,
  step: 'payment_intent' | 'claim_free',
  attemptRef: string | null,
): PackagePaymentNotice {
  if (err instanceof PaymentIntentShapeError) {
    const n = supportNotice('response_shape', attemptRef);
    reportPackagePaymentFailure(step, n, { status: 200, code: 'PAYMENT_INTENT_RESPONSE_SHAPE' });
    return n;
  }
  const status = errorStatus(err) ?? null;
  if (status === null) return notice('offline', PACKAGE_PAYMENT_COPY.offline);
  const code = backendCodeOf(err);
  const ref = shortReference(supportReferenceOf(err)) ?? attemptRef;

  if (status === 401) return notice('session_ended', PACKAGE_PAYMENT_COPY.sessionEnded);
  if (status === 429) return notice('rate_limited', PACKAGE_PAYMENT_COPY.rateLimited(retryAfterMinutes(err)));
  switch (code) {
    case 'PACKAGE_NOT_FOUND':
      return notice('package_unavailable', PACKAGE_PAYMENT_COPY.packageUnavailable);
    case 'COACH_NOT_CONNECTED':
    case 'COACH_NOT_PAYOUT_READY':
      return notice('coach_not_ready', PACKAGE_PAYMENT_COPY.coachNotReady);
    case 'CONTRACT_SIGNATURE_REQUIRED':
      return notice('contract_required', PACKAGE_PAYMENT_COPY.contractRequired);
    case 'PAYMENT_IN_PROGRESS':
      return notice('in_progress', PACKAGE_PAYMENT_COPY.inProgress);
    case 'PAYMENT_RETRY':
      return notice('retry_same_attempt', PACKAGE_PAYMENT_COPY.retrySameAttempt);
    case 'PACKAGE_NOT_FREE':
      return notice('price_changed', PACKAGE_PAYMENT_COPY.priceChanged);
    case 'GRANT_REVOKED':
      return notice('free_revoked', PACKAGE_PAYMENT_COPY.freeRevoked);
    case 'CONNECT_NOT_CONFIGURED': {
      const n = supportNotice('payments_not_configured', ref, true);
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
    default: {
      const n = supportNotice(
        code ? `backend_${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : `http_${status}`,
        ref,
      );
      reportPackagePaymentFailure(step, n, { status, code });
      return n;
    }
  }
}

const DECLINE_INSUFFICIENT = new Set(['insufficient_funds']);
const DECLINE_EXPIRED = new Set(['expired_card']);
const DECLINE_DETAILS = new Set(['incorrect_cvc', 'invalid_cvc', 'incorrect_number', 'invalid_number', 'invalid_expiry_month', 'invalid_expiry_year']);
const AUTH_FAILED = new Set(['payment_intent_authentication_failure', 'authentication_required', 'setup_intent_authentication_failure']);

/** Is this PaymentSheet result the client closing the sheet? (not an error) */
export function isSheetCanceled(error: StripeSdkError | undefined | null): boolean {
  return error?.code === 'Canceled';
}

/** Map a PaymentSheet (init or present) error to what the client is told. */
export function describeSheetFailure(
  error: StripeSdkError,
  step: 'sheet_init' | 'sheet_present',
  attemptRef: string | null,
): PackagePaymentNotice {
  const decline = error.declineCode ?? '';
  const stripeCode = error.stripeErrorCode ?? '';
  if (error.code === 'Timeout') return notice('sheet_timeout', PACKAGE_PAYMENT_COPY.sheetTimeout);
  if (AUTH_FAILED.has(stripeCode) || AUTH_FAILED.has(decline)) {
    return notice('authentication_failed', PACKAGE_PAYMENT_COPY.authFailed);
  }
  if (DECLINE_INSUFFICIENT.has(decline) || DECLINE_INSUFFICIENT.has(stripeCode)) {
    return notice('insufficient_funds', PACKAGE_PAYMENT_COPY.insufficientFunds);
  }
  if (DECLINE_EXPIRED.has(decline) || DECLINE_EXPIRED.has(stripeCode)) {
    return notice('expired_card', PACKAGE_PAYMENT_COPY.expiredCard);
  }
  if (DECLINE_DETAILS.has(decline) || DECLINE_DETAILS.has(stripeCode)) {
    return notice('incorrect_details', PACKAGE_PAYMENT_COPY.incorrectDetails);
  }
  if (decline || stripeCode === 'card_declined' || error.type === 'card_error') {
    return notice('card_declined', PACKAGE_PAYMENT_COPY.declined);
  }
  if (error.type === 'api_connection_error') {
    return notice('connection_dropped', PACKAGE_PAYMENT_COPY.connectionDropped);
  }
  const n = supportNotice(`stripe_${step}`, attemptRef);
  reportPackagePaymentFailure(step, n, { stripe: error });
  return n;
}

/** The SDK threw instead of answering (rare); always a support case. */
export function describeSheetCrash(step: 'sheet_init' | 'sheet_present', attemptRef: string | null): PackagePaymentNotice {
  const n = supportNotice(`stripe_${step}_threw`, attemptRef);
  reportPackagePaymentFailure(step, n);
  return n;
}

/** This build has no Stripe native module (Expo Go, an old binary). */
export function describeSdkMissing(): PackagePaymentNotice {
  return notice('sdk_missing', PACKAGE_PAYMENT_COPY.sdkMissing);
}

/** No publishable key in the backend answer or the build: payments are off. */
export function describeMissingPublishableKey(attemptRef: string | null): PackagePaymentNotice {
  const n = supportNotice('publishable_key_missing', attemptRef, true);
  reportPackagePaymentFailure('config', n);
  return n;
}
