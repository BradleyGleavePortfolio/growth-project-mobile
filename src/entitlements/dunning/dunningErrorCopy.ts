import { extractRequestId, newRequestId } from '../../utils/correlation';
import {
  formatDunningAmount,
  formatDunningDate,
  formatDunningTotals,
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

/**
 * `update_card`: before the card is saved (setup / quote). `confirm_card`:
 * the confirm call, after the card form finished; from here a lost answer
 * may hide a payment that went through, so it is never "nothing charged".
 */
export type DunningAction = 'update_card' | 'confirm_card' | 'load_status' | 'cancel_plan';

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
  | 'BILLING_ROUTE_NOT_AVAILABLE'
  | 'UNEXPECTED_RESPONSE'
  | 'RESULT_NOT_CONFIRMED'
  | 'INVALID_REQUEST'
  | 'INVALID_PLAN_LINK'
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

/**
 * B-322-5: the reference is part of the visible message whenever one exists
 * (a reported failure without a server request id gets a client reference,
 * which is also sent to Sentry), so support can always find it.
 */
function copy(code: DunningErrorCode, message: string, reference: string | null, report: boolean): DunningErrorCopy {
  const ref = reference ?? (report ? newRequestId() : null);
  return { code, message: withReference(message, ref), reference: ref, report };
}

function serverMessage(body: { message?: unknown }): string | null {
  return typeof body.message === 'string' && body.message.trim().length > 0 ? body.message.trim() : null;
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
    response?: {
      status?: number;
      data?: {
        error?: unknown;
        code?: unknown;
        step?: unknown;
        message?: unknown;
      };
    };
  };
  const status = e.response?.status;
  const body = e.response?.data ?? {};
  const machine =
    (typeof body.code === 'string' && body.code) || (typeof body.error === 'string' && body.error) || null;
  const step = typeof body.step === 'string' ? body.step : null;
  const retryVerb =
    action === 'update_card' || action === 'confirm_card'
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
    if (action === 'confirm_card' || action === 'cancel_plan') {
      return copy(
        'RESULT_NOT_CONFIRMED',
        action === 'confirm_card'
          ? `The server answered in a way the app did not understand, so we cannot confirm whether your payment went through. Pull down to refresh to see where things stand. Trying again never charges you twice. If it keeps happening, email ${SUPPORT_EMAIL}.`
          : `The server answered in a way the app did not understand, so we cannot confirm whether your plan ended. Pull down to refresh to see where things stand. If it keeps happening, email ${SUPPORT_EMAIL}.`,
        reference,
        true,
      );
    }
    return copy(
      'UNEXPECTED_RESPONSE',
      `The server sent an answer the app did not understand. Pull down to refresh to see where things stand. If it keeps happening, email ${SUPPORT_EMAIL}.`,
      reference,
      true,
    );
  }
  if (!e.response && (action === 'confirm_card' || action === 'cancel_plan')) {
    // B-322-2: the request may have reached the server; its answer was lost.
    return copy(
      'RESULT_NOT_CONFIRMED',
      action === 'confirm_card'
        ? 'We lost the connection while confirming your card, so we cannot tell yet whether the payment went through. Check your connection and pull down to refresh. Trying again never charges you twice.'
        : 'We lost the connection while ending your plan, so we cannot tell yet whether it went through. Check your connection and pull down to refresh, then tap End my plan again if it still shows. Repeating it is safe.',
      null,
      false,
    );
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
    return copy(
      'RATE_LIMITED',
      `Too many attempts in a short time. Wait a minute, then ${retryVerb}.`,
      reference,
      false,
    );
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
  if (status === 404 && !machine) {
    // A bare 404 (no machine code) means the server predates the native
    // card routes (backend #628). Expected during rollout, so not reported.
    return copy(
      'BILLING_ROUTE_NOT_AVAILABLE',
      action === 'cancel_plan'
        ? `Ending a plan in the app is not available yet, so nothing changed. Email ${SUPPORT_EMAIL} and we will end it for you.`
        : `Updating your card in the app is not available yet, so nothing was charged. Email ${SUPPORT_EMAIL} and we will help you pay.`,
      reference,
      false,
    );
  }
  const said = serverMessage(body);
  switch (machine) {
    case 'INVALID_BILLING_REQUEST':
      return copy(
        'INVALID_REQUEST',
        said ??
          `The app sent an incomplete billing request, so nothing was charged or changed. Close this screen, pull down to refresh, and try again. If it keeps happening, update the app.`,
        reference,
        true,
      );
    case 'INVALID_PLAN_ID':
      return copy(
        'INVALID_PLAN_LINK',
        said ?? 'That plan link is not valid, so nothing was changed. Pull down to refresh your plans, then try again.',
        reference,
        true,
      );
    case 'PAYMENT_RESULT_UNKNOWN':
      return copy(
        'PAYMENT_UNCONFIRMED',
        said ??
          'We could not confirm whether your payment went through. Wait a minute, then pull down to refresh. Trying again never charges you twice.',
        reference,
        true,
      );
    case 'PLAN_CHANGE_RESULT_UNKNOWN':
      return copy(
        'PLAN_CHANGE_UNCONFIRMED',
        said ??
          'We could not confirm that your plan change went through. Wait a minute, then tap End my plan again. Repeating it is safe and never charges you.',
        reference,
        true,
      );
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
        said ??
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
        said ??
          'Your plan did not finish ending. Nothing was charged, and if the unpaid invoice was already canceled it stays canceled. Wait a minute, then tap End my plan again. Repeating it is safe.',
        reference,
        true,
      );
    case 'PAYMENTS_NOT_CONFIGURED':
      return copy(
        'PAYMENTS_NOT_CONFIGURED',
        `Card updates are not available right now, so nothing was charged. Email ${SUPPORT_EMAIL} with the reference below and we will help you pay.`,
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
  if (machine === 'STRIPE_UNAVAILABLE' && said) {
    // The server knows the phase and only says "nothing changed" when true.
    return copy('STRIPE_UNAVAILABLE', said, reference, true);
  }
  if (
    !machine &&
    (status === 502 || status === 503 || status === 504) &&
    (action === 'confirm_card' || action === 'cancel_plan')
  ) {
    // A bare gateway error on a money call: the server may have finished it.
    return copy(
      'RESULT_NOT_CONFIRMED',
      action === 'confirm_card'
        ? 'The server did not answer in time, so we cannot tell yet whether your payment went through. Pull down to refresh in a minute. Trying again never charges you twice.'
        : 'The server did not answer in time, so we cannot tell yet whether your plan ended. Pull down to refresh in a minute, then tap End my plan again if it still shows.',
      reference,
      true,
    );
  }
  if (
    machine === 'STRIPE_UNAVAILABLE' ||
    machine === 'STRIPE_CHECKOUT_ERROR' ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
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
    action === 'update_card' || action === 'confirm_card'
      ? `Your card update did not finish. Pull down to refresh to see where things stand, and email ${SUPPORT_EMAIL} with this reference if it looks wrong.`
      : action === 'cancel_plan'
        ? `Your plan change did not finish. Pull down to refresh, and email ${SUPPORT_EMAIL} with this reference if your plan still shows as active.`
        : `Your billing status did not load. Email ${SUPPORT_EMAIL} with this reference if it does not load after a refresh.`;
  return copy('UNKNOWN', unknown, reference, true);
}

/**
 * Calm, specific copy for each card-update outcome. Never invents an amount
 * and never sums currencies (B-322-1): amounts come from the per-currency
 * totals, "active again" only when the server confirmed access is back, and
 * the server's own sentence (which leads with what was paid) is preferred.
 */
export function cardUpdateOutcomeCopy(r: CardUpdateResponse): {
  title: string;
  body: string;
  tone: 'done' | 'action';
} {
  const ending = r.card_last4 ? ` ending ${r.card_last4}` : '';
  const paid = formatDunningTotals(r.paid_totals);
  const due = formatDunningTotals(r.due_totals);
  const restored = r.access_state === 'restored' && r.access_restored;
  const accessLine = restored
    ? ' Your plan is active again.'
    : r.access_state === 'updating' || r.access_state === 'partial'
      ? ' Your plan updates within a few minutes. Pull down to refresh.'
      : '';
  const local = (): string => {
    switch (r.outcome) {
      case 'paid':
        return paid
          ? `Your card${ending} is saved and ${paid} went through.${accessLine}`
          : `Your card${ending} is saved and your balance is paid.${accessLine}`;
      case 'saved':
        return `Your card${ending} is saved. Your next payment will use it.`;
      case 'processing':
        return `Your card${ending} is saved and your payment${due ? ` of ${due}` : ''} is processing. Your plan updates as soon as it clears, usually within a few minutes.`;
      case 'requires_action':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} Your bank wants you to confirm the payment${due ? ` of ${due}` : ''}. Tap Confirm with my bank to finish.`;
      case 'approval_required':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} The amount you owe changed${due ? ` to ${due}` : ''}, so it was not charged. Review it, then tap Pay to confirm.`;
      case 'payment_uncertain':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} We could not confirm the rest yet. Pull down to refresh in a minute. Trying again never charges you twice.`;
      case 'failed':
        return paid
          ? `Your card${ending} is saved and ${paid} went through. The rest${due ? ` (${due})` : ''} did not go through. Tap Update card to try again.`
          : `Your card${ending} is saved, but the payment${due ? ` of ${due}` : ''} did not go through, so nothing was charged. Tap Update card to try again.`;
      case 'declined':
      default:
        return paid
          ? `Your card${ending} is saved and ${paid} went through, but your bank declined the rest${due ? ` (${due})` : ''}. Try a different card, or call your bank and try again.`
          : `Your card${ending} is saved, but your bank declined the payment${due ? ` of ${due}` : ''}, so nothing was charged. Try a different card, or call your bank and try again.`;
    }
  };
  // Built from the structured fields so the copy always names buttons that
  // are on screen; the server's `message` is for logs and older clients.
  const body = local();
  switch (r.outcome) {
    case 'paid':
      return {
        title: restored ? 'Payment received' : 'Payment received, updating your plan',
        body,
        tone: 'done',
      };
    case 'saved':
      return { title: 'Card saved', body, tone: 'done' };
    case 'processing':
      return { title: 'Payment processing', body, tone: 'done' };
    case 'requires_action':
      return { title: 'Your bank needs to confirm', body, tone: 'action' };
    case 'approval_required':
      return { title: 'Please review the amount', body, tone: 'action' };
    case 'payment_uncertain':
      return { title: 'Confirming your payment', body, tone: 'action' };
    case 'failed':
      return {
        title: paid ? 'Part of your payment went through' : 'Payment did not go through',
        body,
        tone: 'action',
      };
    case 'declined':
    default:
      return {
        title: paid ? 'Part of your payment went through' : 'Payment declined',
        body,
        tone: 'action',
      };
  }
}

/** Copy after ending a plan. 2A (ended now) vs option A (scheduled). */
export function cancelOutcomeCopy(r: CancelPlanResponse): {
  title: string;
  body: string;
} {
  if (r.outcome === 'scheduled' && r.paid_period_kept) {
    const until = formatDunningDate(r.access_ends_at);
    return {
      title: 'Your payment went through',
      body: until
        ? `Your payment went through just before you ended the plan, so you keep access until ${until}, the end of the period you paid for. Your plan ends then and you will not be charged again.`
        : 'Your payment went through just before you ended the plan, so you keep access until the end of the period you paid for. Your plan ends then and you will not be charged again.',
    };
  }
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
    return {
      title: 'Your plan has ended',
      body: 'This plan had already ended. Nothing more will be charged for it.',
    };
  }
  const voided = formatDunningAmount(r.voided_amount_cents || null, r.currency);
  return {
    title: 'Your plan has ended',
    body: voided
      ? `The unpaid ${voided} is canceled, so you will not be charged for it. Your data stays in your account until you delete it.`
      : 'You will not be charged again. Your data stays in your account until you delete it.',
  };
}
