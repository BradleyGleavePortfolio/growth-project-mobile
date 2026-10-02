import { extractRequestId } from '../../utils/correlation';
import {
  formatDunningAmount,
  formatDunningDate,
  type CancelPlanResponse,
  type CardUpdateResponse,
} from './dunningApi';

/**
 * Specific, calm copy for every failure on the payment-lockout surfaces
 * (S-DUNNING). No generic "Something went wrong": each case says what
 * happened and gives a next action that works. Unknown failures carry the
 * backend request id as a support reference and are flagged for Sentry.
 *
 * SUPPORT_EMAIL is the owner's one support address (S-ERRORS ruling,
 * 2026-10-01 14:19). Mobile #324 adds src/constants/support.ts with the same
 * value and a guard; once it lands this should re-export that constant.
 */

export const SUPPORT_EMAIL = 'Bradleyapple1031@gmail.com';

export type DunningAction = 'update_card' | 'load_status' | 'cancel_plan';

export type DunningErrorCode =
  | 'OFFLINE'
  | 'RATE_LIMITED'
  | 'NO_BILLING_ACCOUNT'
  | 'STRIPE_UNAVAILABLE'
  | 'PAYMENT_UNCONFIRMED'
  | 'PLAN_CHANGE_UNCONFIRMED'
  | 'STRIPE_REJECTED'
  | 'PAYMENTS_NOT_CONFIGURED'
  | 'CARD_FORM_EXPIRED'
  | 'CARD_NOT_SAVED'
  | 'CARD_SHEET_UNAVAILABLE'
  | 'CARD_SHEET_FAILED'
  | 'BANK_CONFIRMATION_FAILED'
  | 'BILLING_ACTION_IN_PROGRESS'
  | 'PLAN_NOT_FOUND'
  | 'NOT_A_SUBSCRIPTION'
  | 'CANCEL_INCOMPLETE'
  | 'PLAN_NOT_LOADED'
  | 'LINK_REJECTED'
  | 'SESSION_EXPIRED'
  | 'STATUS_NOT_AVAILABLE'
  | 'UNEXPECTED_RESPONSE'
  | 'UNKNOWN';

export interface DunningErrorCopy {
  /** Stable machine code for tests and analytics. */
  code: DunningErrorCode;
  message: string;
  /** Backend request id when the server supplied one. */
  reference: string | null;
  /** True when the failure is unexpected and must be reported to Sentry. */
  report: boolean;
}

function withReference(text: string, reference: string | null): string {
  return reference ? `${text} Reference: ${reference}.` : text;
}

function copy(code: DunningErrorCode, message: string, reference: string | null, report: boolean): DunningErrorCopy {
  return { code, message: report ? withReference(message, reference) : message, reference, report };
}

/** Client-side failures with no HTTP response (native sheet, bad body). */
export function localDunningError(
  code:
    | 'CARD_SHEET_UNAVAILABLE'
    | 'CARD_SHEET_FAILED'
    | 'BANK_CONFIRMATION_FAILED'
    | 'PAYMENTS_NOT_CONFIGURED'
    | 'PLAN_NOT_LOADED'
    | 'UNEXPECTED_RESPONSE',
): DunningErrorCopy {
  switch (code) {
    case 'PLAN_NOT_LOADED':
      return copy(
        code,
        'Your plan details have not loaded yet, so nothing changed. Pull down to refresh, then tap End my plan again.',
        null,
        false,
      );
    case 'CARD_SHEET_UNAVAILABLE':
      return copy(
        code,
        `This version of the app cannot open the card form. Update the app from the App Store or Google Play, then tap Update card again. If you are on the latest version, email ${SUPPORT_EMAIL}.`,
        null,
        true,
      );
    case 'CARD_SHEET_FAILED':
      return copy(
        code,
        `The card form did not finish, so your card was not saved and nothing was charged. Tap Update card to try again, or use a different card.`,
        null,
        true,
      );
    case 'BANK_CONFIRMATION_FAILED':
      return copy(
        code,
        'Your new card is saved, but your bank did not confirm the payment, so nothing was charged. Tap Confirm with my bank to try again, or Use a different card.',
        null,
        false,
      );
    case 'PAYMENTS_NOT_CONFIGURED':
      return copy(
        code,
        `Card payments are not set up in this version of the app, so nothing was charged. Email ${SUPPORT_EMAIL} and we will help you pay.`,
        null,
        true,
      );
    default:
      return copy(
        'UNEXPECTED_RESPONSE',
        `The server sent an answer the app did not understand. Pull down to refresh to see where things stand. If it keeps happening, email ${SUPPORT_EMAIL}.`,
        null,
        true,
      );
  }
}

export function describeDunningError(err: unknown, action: DunningAction): DunningErrorCopy {
  const reference = extractRequestId(err);
  const e = (err ?? {}) as {
    message?: unknown;
    response?: { status?: number; data?: { error?: unknown; code?: unknown; step?: unknown } };
  };
  const status = e.response?.status;
  const body = e.response?.data ?? {};
  const machine =
    (typeof body.code === 'string' && body.code) || (typeof body.error === 'string' && body.error) || null;
  const step = typeof body.step === 'string' ? body.step : null;
  const retryVerb =
    action === 'update_card'
      ? 'tap Update card again'
      : action === 'cancel_plan'
        ? 'tap End my plan again'
        : 'pull down to refresh';

  if (e.message === 'STRIPE_URL_REJECTED') {
    return copy(
      'LINK_REJECTED',
      `The card update link did not come from Stripe, so we did not open it. Email ${SUPPORT_EMAIL} and we will send you a working link.`,
      reference,
      true,
    );
  }
  if (e.message === 'DUNNING_RESPONSE_SHAPE') {
    return { ...localDunningError('UNEXPECTED_RESPONSE'), reference };
  }
  if (!e.response) {
    return copy(
      'OFFLINE',
      action === 'update_card'
        ? `We could not reach the server, so nothing was charged. Check your connection, then ${retryVerb}.`
        : `We could not reach the server. Check your connection, then ${retryVerb}.`,
      null,
      false,
    );
  }
  if (status === 401) {
    return copy(
      'SESSION_EXPIRED',
      action === 'cancel_plan'
        ? 'Your session ended. Sign in again to change your plan.'
        : 'Your session ended. Sign in again to update your card.',
      reference,
      false,
    );
  }
  if (status === 429) {
    return copy('RATE_LIMITED', `Too many attempts in a short time. Wait a minute, then ${retryVerb}.`, reference, false);
  }
  if (action === 'load_status' && status === 404) {
    // The status route ships with backend #628; an older server answers 404.
    // Expected during rollout, so not reported.
    return copy(
      'STATUS_NOT_AVAILABLE',
      `Your billing status is not available yet. If your plan is paused, email ${SUPPORT_EMAIL}.`,
      reference,
      false,
    );
  }
  switch (machine) {
    case 'CUSTOMER_NOT_FOUND':
      return copy(
        'NO_BILLING_ACCOUNT',
        `We could not find a billing account for you. Message your coach for a new payment link, or email ${SUPPORT_EMAIL}.`,
        reference,
        false,
      );
    case 'SETUP_INTENT_NOT_FOUND':
      return copy(
        'CARD_FORM_EXPIRED',
        'That card form is no longer valid, so nothing was saved or charged. Tap Update card to open a fresh one.',
        reference,
        true,
      );
    case 'SETUP_INTENT_NOT_CONFIRMED':
      return copy(
        'CARD_NOT_SAVED',
        'Your new card was not saved yet, so nothing was charged. Tap Update card and add the card again.',
        reference,
        false,
      );
    case 'BILLING_ACTION_IN_PROGRESS':
      return copy(
        'BILLING_ACTION_IN_PROGRESS',
        'A payment change for this plan is already in progress. Wait a minute, then pull down to refresh before trying again.',
        reference,
        false,
      );
    case 'PURCHASE_NOT_FOUND':
      return copy(
        'PLAN_NOT_FOUND',
        `We could not find that plan on your account. Pull down to refresh. If it is still shown, email ${SUPPORT_EMAIL}.`,
        reference,
        true,
      );
    case 'NOT_A_SUBSCRIPTION':
      return copy(
        'NOT_A_SUBSCRIPTION',
        'This plan is a one-time purchase, so there is nothing to end. Message your coach if you want to change it.',
        reference,
        false,
      );
    case 'CANCEL_INCOMPLETE':
      return copy(
        'CANCEL_INCOMPLETE',
        'Your plan did not finish ending, and nothing was charged. Wait a minute, then tap End my plan again. Repeating it is safe.',
        reference,
        true,
      );
    case 'PAYMENTS_NOT_CONFIGURED':
      return copy(
        'PAYMENTS_NOT_CONFIGURED',
        `Card payments are not available right now, so nothing was charged. Email ${SUPPORT_EMAIL} and we will help you pay.`,
        reference,
        true,
      );
    case 'STRIPE_REQUEST_FAILED':
      return copy(
        'STRIPE_REJECTED',
        `Our payment provider could not complete this change, so nothing was charged. Email ${SUPPORT_EMAIL} with this reference and we will finish it for you.`,
        reference,
        true,
      );
    default:
      break;
  }
  if (machine === 'STRIPE_UNAVAILABLE' || machine === 'STRIPE_CHECKOUT_ERROR' || status === 502 || status === 503 || status === 504) {
    if (step === 'invoice_pay') {
      // A lost answer on a payment may still have charged: never say "nothing changed".
      return copy(
        'PAYMENT_UNCONFIRMED',
        'We could not confirm whether your payment went through. Wait a minute, then pull down to refresh. Trying again never charges you twice.',
        reference,
        true,
      );
    }
    if (step === 'invoice_void' || step === 'cancel') {
      return copy(
        'PLAN_CHANGE_UNCONFIRMED',
        'We could not confirm that your plan change went through. Wait a minute, then tap End my plan again. Repeating it is safe and never charges you.',
        reference,
        true,
      );
    }
    return copy(
      'STRIPE_UNAVAILABLE',
      `Our payment provider did not respond, so nothing changed. Wait a minute and ${retryVerb}. If it keeps happening, email ${SUPPORT_EMAIL}.`,
      reference,
      (status ?? 0) >= 500,
    );
  }
  const unknown =
    action === 'update_card'
      ? `Your card update did not finish. Pull down to refresh to see where things stand, and email ${SUPPORT_EMAIL} with this reference if it looks wrong.`
      : action === 'cancel_plan'
        ? `Your plan change did not finish. Pull down to refresh, and email ${SUPPORT_EMAIL} with this reference if your plan still shows as active.`
        : `Your billing status did not load. Email ${SUPPORT_EMAIL} with this reference if it does not load after a refresh.`;
  return copy('UNKNOWN', unknown, reference, true);
}

/** Calm, specific copy for each card-update outcome. Never invents an amount. */
export function cardUpdateOutcomeCopy(r: CardUpdateResponse): { title: string; body: string; tone: 'done' | 'action' } {
  const ending = r.card_last4 ? ` ending ${r.card_last4}` : '';
  const paid = formatDunningAmount(r.amount_paid_cents || null, r.currency);
  const due = formatDunningAmount(r.amount_due_cents || null, r.currency);
  switch (r.outcome) {
    case 'paid':
      return {
        title: 'Payment received',
        body: paid
          ? `Your card${ending} is saved and ${paid} went through. Your plan is active again.`
          : `Your card${ending} is saved and your balance is paid. Your plan is active again.`,
        tone: 'done',
      };
    case 'saved':
      return {
        title: 'Card saved',
        body: `Your card${ending} is saved. Your next payment will use it.`,
        tone: 'done',
      };
    case 'processing':
      return {
        title: 'Payment processing',
        body: `Your card${ending} is saved and your payment${due ? ` of ${due}` : ''} is processing. Your plan updates as soon as it clears, usually within a few minutes.`,
        tone: 'done',
      };
    case 'requires_action':
      return {
        title: 'Your bank needs to confirm',
        body: `Your card${ending} is saved. Your bank wants you to confirm the payment${due ? ` of ${due}` : ''}. Tap Confirm with my bank to finish.`,
        tone: 'action',
      };
    case 'declined':
    default:
      return {
        title: 'Payment declined',
        body: `Your card${ending} is saved, but your bank declined the payment${due ? ` of ${due}` : ''}, so nothing was charged. Try a different card, or call your bank and try again.`,
        tone: 'action',
      };
  }
}

/** Copy after ending a plan. 2A (ended now) vs option A (scheduled). */
export function cancelOutcomeCopy(r: CancelPlanResponse): { title: string; body: string } {
  if (r.outcome === 'scheduled') {
    const until = formatDunningDate(r.access_ends_at);
    return {
      title: 'Your plan is canceled',
      body: until
        ? `You keep access until ${until}, the end of the period you paid for. You will not be charged again.`
        : 'You keep access until the end of the period you paid for. You will not be charged again.',
    };
  }
  if (r.outcome === 'already_ended') {
    return { title: 'Your plan has ended', body: 'This plan had already ended. Nothing more will be charged for it.' };
  }
  const voided = formatDunningAmount(r.voided_amount_cents || null, r.currency);
  return {
    title: 'Your plan has ended',
    body: voided
      ? `The unpaid ${voided} is canceled, so you will not be charged for it. Your data stays in your account until you delete it.`
      : 'You will not be charged again. Your data stays in your account until you delete it.',
  };
}
