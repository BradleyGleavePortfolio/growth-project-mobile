import { SUPPORT_EMAIL } from '../../constants/support';
import { extractRequestId, newRequestId } from '../../utils/correlation';
import {
  formatDunningAmount,
  formatDunningDate,
  formatDunningTotals,
  ROUTE_QUOTE,
  type CancelPlanResponse,
  type CardUpdateResponse,
  type MoneyTotal,
  type QuoteDispute,
} from './dunningApi';

/**
 * Specific, calm copy for every failure on the payment-lockout surfaces
 * (S-DUNNING). No generic "Something went wrong": each case says what
 * happened and gives a next action that works. Unknown failures carry the
 * backend request id as a support reference and are flagged for Sentry.
 *
 * SUPPORT_EMAIL is the owner's one support address (S-ERRORS ruling,
 * 2026-10-01 14:19), re-exported from src/constants/support.ts so the
 * address is written once (supportEmail.guard.test.ts).
 */

export { SUPPORT_EMAIL };

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
  | 'BANK_RESULT_UNCONFIRMED'
  | 'QUOTE_NOT_VALID'
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

/**
 * The backend's machine code: `code`, or an `error` written as a code
 * (SCREAMING_SNAKE). Nest's generic `error` is the HTTP reason phrase
 * ("Not Found", "Service Unavailable"), which is not a code: a 404 for a
 * route the server does not have (today's production for every native card
 * route) must read as "not available yet", and a bare 503 on a money call as
 * "not confirmed", never as an unknown code.
 */
function machineCode(body: { code?: unknown; error?: unknown }): string | null {
  if (typeof body.code === 'string' && body.code) return body.code;
  if (typeof body.error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(body.error)) return body.error;
  return null;
}

function serverMessage(body: { message?: unknown }): string | null {
  return typeof body.message === 'string' && body.message.trim().length > 0 ? body.message.trim() : null;
}

/** Client-side failures with no HTTP response (native sheet, bad body). */
export function localDunningError(
  code:
    | 'CARD_SHEET_UNAVAILABLE'
    | 'CARD_SHEET_FAILED'
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
    case 'PAYMENTS_NOT_CONFIGURED':
      return copy(
        code,
        `Card payments are not set up in this version of the app, so nothing was charged. Email ${SUPPORT_EMAIL} for help paying.`,
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
  const machine = machineCode(body);
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
      `The card update link did not come from Stripe, so it was not opened. Email ${SUPPORT_EMAIL} for a working link.`,
      reference,
      true,
    );
  }
  if (e.message === 'DUNNING_RESPONSE_SHAPE') {
    if ((err as { route?: unknown }).route === ROUTE_QUOTE) {
      // B-322-5: an incomplete or inconsistent quote stops the payment before
      // the card form opens, so nothing can be approved that is not shown.
      return copy(
        'QUOTE_NOT_VALID',
        `The amount you owe did not load in full, so the card form did not open and nothing was charged. Pull down to refresh, then tap Update card again. If it keeps happening, email ${SUPPORT_EMAIL} with the reference below.`,
        reference,
        true,
      );
    }
    if (action === 'confirm_card' || action === 'cancel_plan') {
      return copy(
        'RESULT_NOT_CONFIRMED',
        action === 'confirm_card'
          ? `The server answered in a way the app did not understand, so it is not confirmed yet whether your payment went through. Pull down to refresh to see where things stand. Trying again never charges you twice. If it keeps happening, email ${SUPPORT_EMAIL}.`
          : `The server answered in a way the app did not understand, so it is not confirmed yet whether your plan ended. Pull down to refresh to see where things stand. If it keeps happening, email ${SUPPORT_EMAIL}.`,
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
        ? 'The connection dropped while your card was being confirmed, so it is not clear yet whether the payment went through. Check your connection and pull down to refresh. Trying again never charges you twice.'
        : 'The connection dropped while your plan was ending, so it is not clear yet whether it went through. Check your connection and pull down to refresh, then tap End my plan again if it still shows. Repeating it is safe.',
      null,
      false,
    );
  }
  if (!e.response) {
    return copy(
      'OFFLINE',
      action === 'update_card'
        ? `The server could not be reached, so nothing was charged. Check your connection, then ${retryVerb}.`
        : `The server could not be reached. Check your connection, then ${retryVerb}.`,
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
    // A 404 without a machine code means the server predates the native
    // card routes (backend #628): production answers its generic
    // { error: 'Not Found' } envelope. Expected during rollout, so not
    // reported, and nothing was sent to the payment provider.
    return copy(
      'BILLING_ROUTE_NOT_AVAILABLE',
      action === 'cancel_plan'
        ? `Ending a plan in the app is not available yet, so nothing changed. Email ${SUPPORT_EMAIL} to end it.`
        : `Updating your card in the app is not available yet, so nothing was charged. Email ${SUPPORT_EMAIL} for help paying.`,
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
          'Your payment is not confirmed yet. Wait a minute, then pull down to refresh. Trying again never charges you twice.',
        reference,
        true,
      );
    case 'PLAN_CHANGE_RESULT_UNKNOWN':
      return copy(
        'PLAN_CHANGE_UNCONFIRMED',
        said ??
          'Your plan change is not confirmed yet. Wait a minute, then tap End my plan again. Repeating it is safe and never charges you.',
        reference,
        true,
      );
    case 'CUSTOMER_NOT_FOUND':
      return copy(
        'NO_BILLING_ACCOUNT',
        `No billing account was found for you. Message your coach for a new payment link, or email ${SUPPORT_EMAIL}.`,
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
        `That plan was not found on your account. Pull down to refresh. If it is still shown, email ${SUPPORT_EMAIL}.`,
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
        `Card updates are not available right now, so nothing was charged. Email ${SUPPORT_EMAIL} with the reference below for help paying.`,
        reference,
        true,
      );
    case 'STRIPE_REQUEST_FAILED':
      return copy(
        'STRIPE_REJECTED',
        `The payment provider could not complete this change, so nothing was charged. Email ${SUPPORT_EMAIL} with this reference to finish it.`,
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
        ? 'The server did not answer in time, so it is not clear yet whether your payment went through. Pull down to refresh in a minute. Trying again never charges you twice.'
        : 'The server did not answer in time, so it is not clear yet whether your plan ended. Pull down to refresh in a minute, then tap End my plan again if it still shows.',
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
        'Your payment is not confirmed yet. Wait a minute, then pull down to refresh. Trying again never charges you twice.',
        reference,
        true,
      );
    }
    if (step === 'invoice_void' || step === 'cancel') {
      return copy(
        'PLAN_CHANGE_UNCONFIRMED',
        'Your plan change is not confirmed yet. Wait a minute, then tap End my plan again. Repeating it is safe and never charges you.',
        reference,
        true,
      );
    }
    return copy(
      'STRIPE_UNAVAILABLE',
      `The payment provider did not respond, so nothing changed. Wait a minute and ${retryVerb}. If it keeps happening, email ${SUPPORT_EMAIL}.`,
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

/** "$150.00" / "$150.00 and 80.00 EUR" for the disputed amounts that are known. */
function disputedTotals(disputes: QuoteDispute[]): string | null {
  const byCurrency = new Map<string, number>();
  for (const d of disputes) {
    if (d.amount_cents == null || !d.currency) continue;
    const cur = d.currency.toLowerCase();
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + d.amount_cents);
  }
  const list: MoneyTotal[] = [...byCurrency].map(([currency, amount_cents]) => ({ currency, amount_cents }));
  return formatDunningTotals(list.filter((t) => t.amount_cents > 0));
}

/**
 * R-DISPUTE-PAUSE (owner 12:01 PDT 10-04, binding): a dispute on any charge
 * of a recurring plan ends that plan's access at once and pauses all of its
 * billing; nothing restarts it on its own (not the dispute closing, not a new
 * card); the plan's coach decides whether to restart it. Backend D2c answers
 * `reason: 'dispute_paused'`, `restart_by: 'coach'`. Every dispute surface in
 * the app says these three facts with this one sentence (B-352-2 / B-352-7):
 * no lock date, no support fix, no future-payment line.
 *
 * `scope`: 'account' when the whole app is locked by the dispute (the
 * lockout), 'plan' when other plans may still be active (banner, outcomes).
 */
export function disputePauseFacts(
  coachName: string | null | undefined,
  scope: 'account' | 'plan' | 'plans' = 'plan',
): string {
  if (scope === 'plans') {
    return `For those plans, access has ended and billing is paused. ${
      coachName ? `Your coach, ${coachName}, decides` : 'Each coach decides'
    } whether to restart them. They do not restart on their own or with a new card.`;
  }
  const lead =
    scope === 'account'
      ? 'Your access has ended and billing is paused.'
      : 'For that plan, access has ended and billing is paused.';
  const who = coachName ? `Your coach, ${coachName}, decides` : 'Your coach decides';
  return `${lead} ${who} whether to restart it. It does not restart on its own or with a new card.`;
}

/**
 * The dispute line kept in every card-update outcome (C-352-5: never
 * dropped): what the bank did, then the R-DISPUTE-PAUSE facts for the
 * disputed plan or plans. Null when no plan has a dispute open.
 *
 * B-352-9: the backend reports a dispute and an inquiry the same way, and an
 * inquiry withdraws no money, so the line says the bank opened a dispute or
 * inquiry (the backend's own wording), never that a payment was reversed or
 * taken back.
 */
export function disputeNotSettledLine(disputes: QuoteDispute[]): string | null {
  if (disputes.length === 0) return null;
  const amount = disputedTotals(disputes);
  const plans = new Set(disputes.map((d) => d.purchase_id)).size;
  const coaches = [...new Set(disputes.map((d) => d.coach_name).filter((c): c is string => Boolean(c)))];
  const coach = coaches.length === 1 ? coaches[0] : null;
  // C-352-11: the noun counts the disputed payments, the scope counts plans.
  const opened = disputes.length > 1 ? 'disputes or inquiries about payments' : 'a dispute or inquiry about a payment';
  const what = `Your bank opened ${opened}${amount ? ` of ${amount}` : ''}${coach ? ` to ${coach}` : ''}.`;
  return `${what} ${disputePauseFacts(coach, plans > 1 ? 'plans' : 'plan')}`;
}

/**
 * Calm, specific copy for each card-update outcome. Never invents an amount
 * and never sums currencies (B-322-1): amounts come from the per-currency
 * totals, "active again" only when the server confirmed access is back, and
 * the server's own sentence (which leads with what was paid) is preferred.
 */
export function cardUpdateOutcomeCopy(
  r: CardUpdateResponse,
  /** Disputes from the quote read before the card form, used when the answer reports none. */
  knownDisputes: QuoteDispute[] = [],
): {
  title: string;
  body: string;
  tone: 'done' | 'action';
} {
  const disputes = r.disputes ?? knownDisputes;
  const disputeLine = disputeNotSettledLine(disputes);
  const ending = r.card_last4 ? ` ending ${r.card_last4}` : '';
  const paid = formatDunningTotals(r.paid_totals);
  const due = formatDunningTotals(r.due_totals);
  const restored = r.access_state === 'restored' && r.access_restored;
  // B-352-2: with a disputed plan open, access news is scoped to the plan
  // that was paid; the disputed plan stays paused until its coach restarts it.
  const paidPlan = disputeLine ? 'The plan you paid for' : 'Your plan';
  const accessLine = restored
    ? ` ${paidPlan} is active again.`
    : r.access_state === 'updating' || r.access_state === 'partial'
      ? ` ${paidPlan} updates within a few minutes. Pull down to refresh.`
      : '';
  const clears = disputeLine ? 'The plan it pays for updates' : 'Your plan updates';
  const local = (): string => {
    switch (r.outcome) {
      case 'paid':
        return paid
          ? `Your card${ending} is saved and ${paid} went through.${accessLine}`
          : `Your card${ending} is saved and your balance is paid.${accessLine}`;
      case 'saved':
        // A dispute-only update has no open invoice to pay (backend copy).
        return disputeLine
          ? `Your card${ending} is saved. There was no open invoice to pay, so nothing was charged.`
          : `Your card${ending} is saved. Your next payment will use it.`;
      case 'processing':
        // C-322-2: money already collected is said first, then the payment
        // that is still processing.
        return paid
          ? `Your card${ending} is saved and ${paid} went through. The payment${due ? ` of ${due}` : ''} is processing. ${clears} as soon as it clears, usually within a few minutes.`
          : `Your card${ending} is saved and your payment${due ? ` of ${due}` : ''} is processing. ${clears} as soon as it clears, usually within a few minutes.`;
      case 'in_progress':
        // B-322-7: one plan settled while another plan's change was still
        // being processed; the known payment is never hidden.
        return paid
          ? `Your card${ending} is saved and ${paid} went through.${accessLine} Another change to your other plan was still being processed, so it was not charged now. Tap Check again in a few seconds to finish it. Checking again never charges you twice.`
          : `Your card${ending} is saved. Another change to your plan was still being processed, so nothing was charged now. Tap Check again in a few seconds to finish it. Checking again never charges you twice.`;
      case 'requires_action':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} Your bank wants you to confirm the payment${due ? ` of ${due}` : ''}. Tap Confirm with my bank to finish.`;
      case 'approval_required':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} The amount you owe changed${due ? ` to ${due}` : ''}, so it was not charged. Review it, then tap Pay to confirm.`;
      case 'payment_uncertain':
        return `Your card${ending} is saved.${paid ? ` ${paid} went through.` : ''} The rest is not confirmed yet. Pull down to refresh in a minute. Trying again never charges you twice.`;
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
  // are on screen; the server's `message` is for logs and older clients. The
  // dispute facts are always kept (C-352-5, R-DISPUTE-PAUSE).
  const body = disputeLine ? `${local()} ${disputeLine}` : local();
  switch (r.outcome) {
    case 'paid':
      return {
        title: restored || disputeLine ? 'Payment received' : 'Payment received, updating your plan',
        body,
        tone: 'done',
      };
    case 'saved':
      return { title: 'Card saved', body, tone: disputeLine ? 'action' : 'done' };
    case 'processing':
      return {
        title: paid ? 'Part of your payment went through' : 'Payment processing',
        body,
        tone: 'done',
      };
    case 'in_progress':
      return {
        title: paid ? 'Part of your payment went through' : 'Another change is in progress',
        body,
        tone: 'action',
      };
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

/**
 * Copy after ending a plan. 2A (ended now) vs option A (scheduled). With
 * `dispute` (a bank dispute or inquiry on the plan), the R-DISPUTE-PAUSE facts are
 * kept: access had already ended, billing was paused, only the coach
 * restarts it (B-352-7: no support fix, nothing restores on its own).
 */
export function cancelOutcomeCopy(
  r: CancelPlanResponse,
  opts: { dispute?: boolean } = {},
): {
  title: string;
  body: string;
} {
  const base = cancelOutcomeBase(r);
  return opts.dispute
    ? {
        title: base.title,
        body: `${base.body} Your bank had opened a dispute or inquiry about a payment on this plan, so its access had already ended and its billing was paused. Only your coach can restart it.`,
      }
    : base;
}

function cancelOutcomeBase(r: CancelPlanResponse): { title: string; body: string } {
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

/**
 * B-322-1: copy for a bank step (3DS) that failed, built from what the
 * server last said about this same SetupIntent: money already collected is
 * always named, and "not charged" is said only when the server has just
 * confirmed (`verified`) that the payment still waits for the bank. When the
 * server could not be asked, the result is "not confirmed yet", never zero.
 */
export function bankStepCopy(response: CardUpdateResponse | null, verified: boolean): DunningErrorCopy {
  const paid = formatDunningTotals(response?.paid_totals ?? []);
  const due = formatDunningTotals(response?.due_totals ?? []);
  const saved = `Your new card is saved${paid ? ` and ${paid} went through` : ''}.`;
  if (verified) {
    return copy(
      'BANK_CONFIRMATION_FAILED',
      `${saved} Your bank did not confirm the payment${due ? ` of ${due}` : ''}, so ${
        paid ? 'that amount was not charged' : 'nothing was charged'
      }. Tap Confirm with my bank to try again, or Use a different card.`,
      null,
      false,
    );
  }
  return copy(
    'BANK_RESULT_UNCONFIRMED',
    `${saved} The bank step did not finish, so the payment${due ? ` of ${due}` : ''} is not confirmed yet. Tap Confirm with my bank to check and finish it. Trying again never charges you twice.`,
    null,
    true,
  );
}
