/**
 * roman/copy — Roman-voiced, spec-sourced strings for the P4 showpiece
 * surfaces (ED.3 First Payment Wow + ED.4 Progress Chart PR commentary).
 *
 * Every string returned here is taken from the locked identity spec
 * (BradleyGleavePortfolio/tgp-agent-context
 * strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md — mirrored verbatim in this repo's
 * working copy at doctrine/roman_identity_spec.md), cited per builder with its
 * §section. No string is improvised: the §2.6 variants are reproduced
 * character-for-character so the FACE+VOICE render sites paint exactly what the
 * operator locked.
 *
 * Voice-contract compliance (spec §1.1-§1.6, verified against §1.4 forbidden
 * moves): no emoji, no contractions in the default tone, no hype words, no
 * slang. The §2.6 celebration variant carries the single rationed exclamation
 * (spec §1.4 — "one exclamation point per session … only on a genuine
 * milestone celebration"); the first payment is the intended home for it
 * (spec §4 surface table — "the one exclamation may live here"). The default
 * and error §2.6 variants stay quip-free / exclamation-free.
 *
 * Module ownership (P3 / P4 split — builder coordination):
 *   P3 owns §2.3, §2.4, §2.5, §2.7, §2.8, §2.9, §2.10, §2.12.
 *   P4 owns §2.6 (romanFirstPayment) + the PR-detected commentary
 *   (romanPRDetected — a new function derived from §2.8 / §5 anti-pattern #6,
 *   not a numbered §2 context).
 * The two builders edit this file ADDITIVELY only — each exported function is
 * independent, so a union merge is conflict-free.
 */

/** §2.6 voice modes. `celebration` is the ED.3 centrepiece (the one moment). */
export type RomanFirstPaymentMode = 'default' | 'celebration' | 'error';

export interface RomanFirstPaymentArgs {
  /** Coach name, in whatever form the operator chose (spec §6 open decision). */
  coachName: string;
  /** Pre-formatted currency string, e.g. "$240.00" (spec §2 token convention). */
  amount: string;
  /** The paying client's name. */
  clientName: string;
  /** Which §2.6 variant to render. ED.3 uses 'celebration'. */
  mode: RomanFirstPaymentMode;
}

/**
 * §2.6 — First payment received by a coach (ED.3, "THE moment", coach app).
 *
 * Strings reproduced VERBATIM from the identity spec §2.6:
 *   - default:     `"{coachName}, your first payment has arrived: {amount}
 *                   from {clientName}. This is the part where the work becomes
 *                   a living. Well earned."`
 *   - celebration: `"{coachName} — your first payment has arrived. {amount},
 *                   from {clientName}. I have seen a great many first payments,
 *                   and they never stop meaning something. Congratulations!"`
 *                   (full warmth; carries the one permitted exclamation.)
 *   - error:       `"{coachName}, your first payment from {clientName} has
 *                   cleared — {amount}. My own records lagged a moment behind
 *                   the good news. It is reconciled now."`
 *                   (the error variant carries §2.6's one gentle, self-
 *                   deprecating quip — at Roman's expense, softening a non-
 *                   blocking ledger hiccup on a high-stakes screen.)
 */
export function romanFirstPayment(args: RomanFirstPaymentArgs): string {
  const { coachName, amount, clientName, mode } = args;

  switch (mode) {
    case 'celebration':
      // identity spec §2.6 milestone-celebration (the one exclamation lives here).
      return `${coachName} — your first payment has arrived. ${amount}, from ${clientName}. I have seen a great many first payments, and they never stop meaning something. Congratulations!`;
    case 'error':
      // identity spec §2.6 error variant (processor cleared, ledger lagged).
      return `${coachName}, your first payment from ${clientName} has cleared — ${amount}. My own records lagged a moment behind the good news. It is reconciled now.`;
    case 'default':
    default:
      // identity spec §2.6 Default.
      return `${coachName}, your first payment has arrived: ${amount} from ${clientName}. This is the part where the work becomes a living. Well earned.`;
  }
}

export interface RomanPRDetectedArgs {
  /** The lift the personal record was set on, e.g. "Back Squat". */
  liftName: string;
  /** The record weight in pounds (token convention: `{weight}`, spec §2). */
  weight: number;
}

/**
 * Progress-chart PR-detected commentary (ED.4, client app).
 *
 * This is NOT one of the twelve numbered §2 contexts — it is the inline
 * Roman line shown when the progress chart loads with a personal-record point
 * present. The copy is composed strictly in the §2.8 milestone register
 * ("a personal best on {liftName} … Noted with admiration") and matches the
 * spec §5 anti-pattern #6 CORRECTED line verbatim (the "GOOD" example):
 *   "A personal best on {liftName}. Noted with admiration."
 * with the weight folded in per the §2 token convention. It stays quip-free
 * and EXCLAMATION-FREE: the §2.8 celebration's exclamation is reserved for the
 * workout-complete moment, and ED.3's first-payment screen is the intended
 * home for the session's single rationed exclamation (spec §4 / §1.4) — so the
 * chart commentary must not spend it. Measured respect, not effusion (§1.1).
 */
export function romanPRDetected(args: RomanPRDetectedArgs): string {
  const { liftName, weight } = args;
  // Whole-pound records read cleaner without a trailing ".0"; preserve any
  // genuine fractional plate (e.g. 2.5 lb microloading) when present.
  const weightLabel = Number.isInteger(weight) ? String(weight) : String(weight);
  // §5 anti-pattern #6 corrected register + §2 `{weight}` pounds token.
  return `A personal best on ${liftName} — ${weightLabel} pounds. Noted with admiration.`;
}
