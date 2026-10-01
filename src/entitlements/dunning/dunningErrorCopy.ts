import { extractRequestId } from '../../utils/correlation';

/**
 * Specific, calm copy for every failure on the payment-lockout surfaces
 * (S-DUNNING). No generic "Something went wrong": each case says what
 * happened and gives a next action that works. Unknown failures carry the
 * backend request id as a support reference and are flagged for Sentry.
 */

export const SUPPORT_EMAIL = 'hello@thegrowthproject.app';

export type DunningAction = 'update_card' | 'load_status';

export interface DunningErrorCopy {
  /** Stable machine code for tests and analytics. */
  code:
    | 'OFFLINE'
    | 'RATE_LIMITED'
    | 'NO_BILLING_ACCOUNT'
    | 'STRIPE_UNAVAILABLE'
    | 'LINK_REJECTED'
    | 'SESSION_EXPIRED'
    | 'STATUS_NOT_AVAILABLE'
    | 'UNKNOWN';
  message: string;
  /** Backend request id when the server supplied one. */
  reference: string | null;
  /** True when the failure is unexpected and must be reported to Sentry. */
  report: boolean;
}

function withReference(text: string, reference: string | null): string {
  return reference ? `${text} Reference: ${reference}.` : text;
}

export function describeDunningError(err: unknown, action: DunningAction): DunningErrorCopy {
  const reference = extractRequestId(err);
  const e = (err ?? {}) as {
    message?: unknown;
    response?: { status?: number; data?: { error?: unknown; code?: unknown } };
  };
  const status = e.response?.status;
  const body = e.response?.data ?? {};
  const machine =
    (typeof body.code === 'string' && body.code) ||
    (typeof body.error === 'string' && body.error) ||
    null;
  const retryVerb = action === 'update_card' ? 'tap Update card again' : 'pull down to refresh';

  if (e.message === 'STRIPE_URL_REJECTED') {
    return {
      code: 'LINK_REJECTED',
      message: withReference(
        `The card update link did not come from Stripe, so we did not open it. Email ${SUPPORT_EMAIL} and we will send you a working link.`,
        reference,
      ),
      reference,
      report: true,
    };
  }
  if (!e.response) {
    return {
      code: 'OFFLINE',
      message: `We could not reach the server. Check your connection, then ${retryVerb}.`,
      reference: null,
      report: false,
    };
  }
  if (status === 401) {
    return {
      code: 'SESSION_EXPIRED',
      message: 'Your session ended. Sign in again to update your card.',
      reference,
      report: false,
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: `Too many attempts in a short time. Wait a minute, then ${retryVerb}.`,
      reference,
      report: false,
    };
  }
  if (action === 'load_status' && status === 404) {
    // The status route ships with backend #628; an older server answers 404.
    // Expected during rollout, so not reported.
    return {
      code: 'STATUS_NOT_AVAILABLE',
      message: `Your billing status is not available yet. If your plan is paused, email ${SUPPORT_EMAIL}.`,
      reference,
      report: false,
    };
  }
  if (status === 404 && machine === 'CUSTOMER_NOT_FOUND') {
    return {
      code: 'NO_BILLING_ACCOUNT',
      message: `We could not find a billing account for you. Message your coach for a new payment link, or email ${SUPPORT_EMAIL}.`,
      reference,
      report: false,
    };
  }
  if (machine === 'STRIPE_CHECKOUT_ERROR' || status === 502 || status === 503 || status === 504) {
    return {
      code: 'STRIPE_UNAVAILABLE',
      message: withReference(
        `Stripe did not open the card update page. Wait a minute and ${retryVerb}. If it keeps happening, email ${SUPPORT_EMAIL}.`,
        reference,
      ),
      reference,
      report: (status ?? 0) >= 500,
    };
  }
  return {
    code: 'UNKNOWN',
    message: withReference(
      action === 'update_card'
        ? `The card update page did not open. Email ${SUPPORT_EMAIL} with this reference and we will fix it.`
        : `Your billing status did not load. Email ${SUPPORT_EMAIL} with this reference if it does not load after a refresh.`,
      reference,
    ),
    reference,
    report: true,
  };
}
