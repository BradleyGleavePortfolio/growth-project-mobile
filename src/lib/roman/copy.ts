/**
 * roman/copy — single source of truth for the P3 voice-expansion surfaces.
 *
 * Every string returned below is spec-derived from the locked Roman identity
 * spec (BradleyGleavePortfolio/tgp-agent-context
 * strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md), §2.3-§2.12, and is adjusted for
 * the available authoritative signals (the live mobile contracts do not always
 * carry the exact field the spec illustration assumed, so a line may be
 * shortened or made past-tense to stay truthful) and for `{token}`
 * substitution. Copy must never be inlined in a screen file — the
 * eight P3 surfaces (§2.3 Coach Brief, §2.4 check-in received, §2.5 new client
 * onboarded, §2.7 streak, §2.8 workout complete, §2.9 voice-log confirm, §2.10
 * generic error, §2.12 coach payout) all consume their prose from here so the
 * voice has exactly one home.
 *
 * Voice-contract compliance (spec §1.1-§1.6): no emoji ever, no contractions in
 * the default tone, no hype words, no slang.
 *
 * No exclamation in P3 UX copy: every P3 string — including all celebration
 * variants (§2.3 record morning, §2.4 first check-in, §2.5 roster milestone,
 * §2.7 30-day streak, §2.8 personal best, §2.9 voice PR, §2.12 record payout) —
 * carries ZERO exclamation points. Those celebration lines are written in
 * Roman's composed butler register: warm, measured, never effusive. The
 * forbidden-move sweep in copy.test.ts asserts zero exclamation marks across
 * every produced string.
 *
 * FACE + VOICE invariant
 * --------------------------------
 * Roman has a voice (these copy helpers) AND a face (the RomanAvatar).
 * Every persistent Roman P3 surface (card, banner, notice, readback)
 * that renders strings from this module MUST co-locate <RomanAvatar />.
 *
 * Sole exception: transient toast surfaces (see RomanErrorBanner's
 * `surface='toast'` branch) suppress the mascot for layout reasons —
 * the toast is short-lived and the avatar would clip on small screens.
 * If you add a new surface, either co-locate the avatar or document
 * a similarly bounded exception here.
 *
 * NOTE: §2.6 (first-payment, ED.3) is intentionally ABSENT here — the Roman P4
 * builder adds `romanFirstPayment` in parallel. Do not add §2.6 in P3.
 */


/** The three voice modes every surface selects from (spec §4 column c). */
export type RomanVoiceMode = 'default' | 'celebration' | 'error';

// ── §2.3 Coach Brief delivery (coach app) ──────────────────────────────────

export interface RomanCoachBriefArgs {
  /** Coach's address form (first name or surname per operator §6 decision). */
  coachName: string;
  /** Number of clients needing attention today. */
  clientCount: number;
  /**
   * default — brief ready; celebration — a record morning (all clients on
   * track); error — the brief could not be assembled (a source is slow).
   * Trigger is decided by the host screen from the brief payload.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.3 Coach Brief. default/celebration/error variants, spec-derived and
 * adjusted for available authoritative signals.
 *
 * Trigger: `celebration` when every client is on track this morning;
 * `error` when the brief payload failed to assemble; otherwise `default`.
 */
export function romanCoachBrief(args: RomanCoachBriefArgs): string {
  const { coachName, clientCount, mode } = args;
  if (mode === 'celebration') {
    // §2.3 milestone-celebration (record morning).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    return `Good morning, ${coachName}. Every client is on track this morning. I cannot recall a tidier brief.`;
  }
  if (mode === 'error') {
    // spec §2.3 error (brief could not be assembled).
    return `Good morning, ${coachName}. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.`;
  }
  // §2.3 default. The brief payload (CoachBriefPayload, types/wave11.ts) carries
  // NO overnight-check-in-arrival count, so the line speaks only from the real
  // inputs it is given — the coach's name and the client-attention count. The
  // spec sample's "two check-ins arrived overnight" clause was a hardcoded
  // figure the host cannot prove (R5 truthful-signal rule), so it is dropped.
  return `Good morning, ${coachName}. Your brief is ready. ${clientCount} clients need attention today.`;
}

// ── §2.4 Client check-in-consistency claim awaiting sign-off (coach app) ─────

export interface RomanCheckInClaimArgs {
  /** Claiming client's display name. */
  clientName: string;
  /**
   * default — a check-in-consistency claim is pending the coach's sign-off;
   * celebration — the client's first such claim; error — the claim's proof
   * source could not be retrieved.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.4 Client check-in-consistency claim awaiting sign-off.
 *
 * The host signal is a `latestVerifiedProgress` item whose `kind` is
 * `check_in_consistency` and whose `signoffStatus` is `pending` (see
 * types/wave11.ts:43-45,68-91,146-147). That field is contractually defined as
 * the client's last verified-progress submission in the `pending` =
 * "submitted, awaiting coach review" state. It proves a check-in-consistency
 * CLAIM is awaiting the coach's sign-off; it does NOT prove a check-in form
 * arrived, that attachments exist, or that any review queue was reordered. The
 * copy therefore asserts only the pending-claim fact (R5/R6 truthful-signal
 * rule). No invented queue manipulation.
 *
 * Trigger: `celebration` on the client's first such claim; `error` when the
 * proof source could not be retrieved; otherwise `default`.
 */
export function romanCheckInClaim(args: RomanCheckInClaimArgs): string {
  const { clientName, mode } = args;
  if (mode === 'celebration') {
    // §2.4 milestone-celebration (the client's first check-in-consistency claim).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    return `${clientName} has a first check-in consistency claim awaiting your sign-off. A good beginning.`;
  }
  if (mode === 'error') {
    // §2.4 error (the claim's proof source could not be retrieved).
    return `${clientName} has a check-in consistency claim awaiting your sign-off, but I could not retrieve its proof. I am trying again now.`;
  }
  // §2.4 default — a pending check-in-consistency claim, the only fact the
  // host signal proves.
  return `${clientName} has a check-in consistency claim awaiting your sign-off.`;
}

// ── §2.5 New client onboarded for a coach (coach app) ───────────────────────

export interface RomanNewClientArgs {
  /** Newly onboarded client's display name. */
  clientName: string;
  /** Roster size after the join — used by the milestone line. */
  clientCount: number;
  /**
   * default — client joined; celebration — a roster milestone (e.g. 10th /
   * 50th); error — intake details did not transfer cleanly.
   */
  mode: RomanVoiceMode;
}

/**
 * Format an integer as an English ordinal (1 → "1st", 2 → "2nd", 3 → "3rd",
 * 21 → "21st", 22 → "22nd", 23 → "23rd"). The teens 11/12/13 are the classic
 * exception and always take "th" ("11th"/"12th"/"13th"), as does everything
 * else. Negative numbers are normalized via their absolute value for suffix
 * selection while preserving the original number in the rendered string.
 *
 * R11 D-005: the §2.5 roster-milestone celebration line previously interpolated
 * a hard-coded "th", producing "1th"/"2th"/"21th". Quiet-luxury copy must use
 * grammatical ordinals, so the milestone line now formats through this helper.
 */
export function formatOrdinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  const lastOne = abs % 10;
  let suffix = 'th';
  if (lastTwo < 11 || lastTwo > 13) {
    if (lastOne === 1) suffix = 'st';
    else if (lastOne === 2) suffix = 'nd';
    else if (lastOne === 3) suffix = 'rd';
  }
  return `${n}${suffix}`;
}

/**
 * §2.5 New client onboarded. spec-derived default/celebration/error,
 * adjusted for available authoritative signals.
 *
 * Trigger: `celebration` on a roster milestone (host decides which counts are
 * milestones); `error` when intake did not transfer cleanly; else `default`.
 */
export function romanNewClient(args: RomanNewClientArgs): string {
  const { clientName, clientCount, mode } = args;
  if (mode === 'celebration') {
    // §2.5 milestone-celebration (roster milestone).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    return `${clientName} has joined your roster — your ${formatOrdinal(clientCount)} client. The practice is growing handsomely.`;
  }
  if (mode === 'error') {
    // spec §2.5 error (onboarding partially failed).
    return `${clientName} has joined, but their intake details did not transfer cleanly. I will reconcile it and confirm.`;
  }
  // spec §2.5 default.
  return `${clientName} has joined your roster. Their file is prepared and waiting for you.`;
}

// ── §2.7 Streak milestone — 3 / 7 / 30 day (client app) ─────────────────────

/** The streak tiers the spec gives distinct copy for. */
export type RomanStreakTier = 3 | 7 | 30;

export interface RomanStreakArgs {
  /** Which milestone tier was reached (3 / 7 / 30). */
  tier: RomanStreakTier;
  /** Client's first name — used by the 7-day and 30-day lines. */
  firstName: string;
  /**
   * default — the 3-day line (measured); celebration — the 7-day and 30-day
   * lines (composed, no exclamation); error — the streak count failed to
   * compute.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.7 Streak milestone. spec-derived across the three tiers + error,
 * adjusted for available authoritative signals.
 *
 * Trigger: 3-day uses `default` (measured); 7-day and 30-day use
 * `celebration` (the mascot wears the knowing slight smile on 7/30 per §3.8);
 * `error` when the count could not be tallied.
 *
 * The 30-day celebration is the strongest milestone in P3 yet still closes on a
 * period — no exclamation in Roman P3 UX copy.
 */
export function romanStreak(args: RomanStreakArgs): string {
  const { tier, firstName, mode } = args;
  if (mode === 'error') {
    // spec §2.7 error (streak count failed to compute).
    return `Your streak is intact, ${firstName} — I am simply slow to tally it this morning. The number will be along shortly.`;
  }
  if (tier === 30) {
    // spec §2.7 milestone-celebration, 30-day. Composed butler register: warm
    // and measured, closed with a period — no exclamation in P3 UX copy.
    return `Thirty days, ${firstName}. A month without a missed day. This is the kind of record I am glad to keep.`;
  }
  if (tier === 7) {
    // spec §2.7 milestone-celebration, 7-day.
    return `Seven days unbroken, ${firstName}. A full week is no small thing. Onward.`;
  }
  // spec §2.7 default, 3-day (measured).
  return 'Three days running. A streak is just consistency that has been counting. Keep it.';
}

// ── §2.8 Workout completed by a client (client app) ─────────────────────────

export interface RomanWorkoutCompleteArgs {
  /**
   * default — workout recorded; celebration — a personal best on a lift;
   * error — the workout finished but the save failed.
   */
  mode: RomanVoiceMode;
  /** Lift name for the PR celebration line (required when mode is celebration). */
  liftName?: string;
}

/**
 * §2.8 Workout completed. spec-derived default/celebration/error,
 * adjusted for available authoritative signals.
 *
 * Trigger: `celebration` on a personal best (the mascot wears the slight
 * smile, §3.8); `error` when the session finished but could not be saved;
 * otherwise `default`.
 */
export function romanWorkoutComplete(args: RomanWorkoutCompleteArgs): string {
  const { mode, liftName } = args;
  if (mode === 'celebration') {
    // §2.8 milestone-celebration (personal best).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    // A PR celebration requires the lift name; fall back to the default line
    // rather than render a hollow "personal best on ." if it is missing.
    if (liftName == null || liftName.trim() === '') {
      return 'Workout complete. Recorded. That is one more behind you.';
    }
    return `Workout complete — and a personal best on ${liftName}, no less. Noted with admiration.`;
  }
  if (mode === 'error') {
    // spec §2.8 error (finished but save failed).
    return 'Your workout is finished, but I have not yet been able to save it. Do not close the app — I am writing it down now.';
  }
  // spec §2.8 default.
  return 'Workout complete. Recorded. That is one more behind you.';
}

// ── §2.9 Voice-logging confirmation (client app) ────────────────────────────

export interface RomanVoiceLogArgs {
  /** Parsed weight in pounds (readback unit per spec §2.9). */
  weight: number;
  /** Parsed rep count. */
  reps: number;
  /**
   * default — readback of a parsed set; celebration — the logged set is a new
   * best; error — the utterance could not be parsed (weight/reps unknown).
   */
  mode: RomanVoiceMode;
}

/**
 * §2.9 Voice-log confirmation. spec-derived readback, adjusted for available
 * authoritative signals. Kept short and literal so the number is never in
 * doubt (no quip on the default per spec §2.9). It reads back ONLY what was
 * parsed (weight and reps) and makes NO durable-save claim — the readback fires
 * on parse, before any persistence is confirmed, so a "Recorded." assertion
 * here would not be truthful (P1-B-03).
 *
 * Trigger: `celebration` when the logged set is a new best; `error` when the
 * spoken set could not be parsed; otherwise `default`.
 */
export function romanVoiceLog(args: RomanVoiceLogArgs): string {
  const { weight, reps, mode } = args;
  if (mode === 'error') {
    // spec §2.9 error (could not parse the utterance) — no tokens.
    return 'I did not catch that cleanly. Tell me the weight and the reps once more, and I will record it.';
  }
  if (mode === 'celebration') {
    // §2.9 milestone-celebration (a logged PR via voice).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    // No durable-save claim (P1-B-03): the readback fires on parse, so it states
    // the new-best fact about the parsed set, not that it has been persisted.
    return `${weight} pounds, ${reps} reps — and a new best. Noted.`;
  }
  // spec §2.9 default — pure readback of the parsed set, e.g.
  // "315 pounds, 5 reps." No "Recorded." claim (P1-B-03): the confirmation
  // fires the moment the utterance is parsed, before persistence is verified,
  // so asserting it has been recorded here would be untrue.
  return `${weight} pounds, ${reps} reps.`;
}

// ── §2.10 Generic error / system failure (BOTH apps) ────────────────────────

export interface RomanGenericErrorArgs {
  /**
   * default — a transient failure (retry available); error — a hard failure
   * after retries are exhausted. There is no celebration variant: a failure is
   * nothing to celebrate (spec §2.10 marks it N/A).
   */
  mode: Extract<RomanVoiceMode, 'default' | 'error'>;
}

/**
 * §2.10 Generic error. spec-derived default (transient) / error (hard
 * failure), adjusted for available authoritative signals.
 *
 * Trigger: `default` while a retry is still available; `error` once retries
 * are exhausted. Per the spec §2.10 schema note there is deliberately NO
 * celebration variant — callers cannot request one (the type forbids it).
 *
 * These two strings are the same canonical lines exported from
 * components/roman/romanVoice as ROMAN_ERROR_TRANSIENT / ROMAN_ERROR_EXHAUSTED;
 * they are restated here verbatim so the P3 surfaces import error copy from the
 * one P3 module, and a divergence between the two would fail the copy tests.
 */
export function romanGenericError(args: RomanGenericErrorArgs): string {
  if (args.mode === 'error') {
    // spec §2.10 Error (hard failure, retry exhausted).
    return 'That request did not complete, and my attempts to retry have not succeeded either. I have logged the matter. Please try again in a few minutes.';
  }
  // spec §2.10 Default (transient failure).
  return 'That request did not complete. I will try again.';
}

// ── §2.12 Coach payout sent to bank (coach app) ─────────────────────────────

export interface RomanPayoutArgs {
  /** Pre-formatted currency string, e.g. "$240.00". */
  amount: string;
  /**
   * Last four digits of the destination bank account. OPTIONAL: the mobile
   * `CoachEarningsSummary` contract does not carry the destination digits
   * (payouts are Stripe-managed and the last-four is not exposed to mobile —
   * see api/packagesApi.ts), and inventing them would be placeholder financial
   * data. When omitted (undefined/empty), Roman drops the "account ending …"
   * clause and states only the amount and the past-tense send date — both of
   * which ARE true of the available data (the mobile contract carries no
   * settlement-window or in-transit signal, so the copy never speaks of one).
   * Pass a real value only when a genuine last-four is available.
   */
  bankLast4?: string;
  /**
   * Pre-formatted date the last payout was sent, e.g. "June 9". Derived from the
   * real `lastPayoutAt` timestamp on the mobile `CoachEarningsSummary` contract
   * (api/packagesApi.ts:135-149). That contract carries ONLY historical payout
   * fields (`lastPayoutAt`, `lastPayoutAmountCents`) and a `nextPayoutEta`; it
   * exposes NO in-transit / settlement-window signal, so the copy speaks of the
   * last payout in the past tense — the only thing the data proves (R5/R6
   * truthful-signal rule).
   */
  sentOn: string;
  /**
   * default — the last payout, stated in the past tense; celebration — a record
   * payout / milestone total; error — the bank declined the transfer
   * instruction.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.12 Coach payout. Past-tense from the real historical payout data.
 *
 * Trigger: `celebration` on a record payout (the host decides "largest yet");
 * `error` when the payout initiation failed; otherwise `default`.
 */
export function romanPayout(args: RomanPayoutArgs): string {
  const { amount, bankLast4, sentOn, mode } = args;
  // The destination account is only named when a real last-four is available.
  // When it is absent, the "account ending …" clause is dropped entirely so the
  // line never ships a placeholder token in user-facing financial copy.
  const hasBankLast4 = bankLast4 != null && bankLast4.trim() !== '';
  if (mode === 'error') {
    // spec §2.12 error (payout initiation failed; bank declined). No account
    // token in this variant, so it is unaffected by the last-four availability.
    return `I was unable to send your payout of ${amount} just now — the bank declined the transfer instruction. Nothing is lost; I will retry and confirm once it is moving.`;
  }
  if (mode === 'celebration') {
    // §2.12 milestone-celebration (record payout).
    // Roman P3 voice: never use exclamation marks. Period-terminated lines only.
    // Past tense: the data proves the payout was sent, not that it is in transit.
    if (hasBankLast4) {
      return `Your last payout of ${amount} was sent on ${sentOn} to the account ending ${bankLast4} — your largest yet. A fine month's work.`;
    }
    // Destination-account omitted variant: amount, send date, and the "largest
    // yet" framing are all true of the available data; no account token.
    return `Your last payout of ${amount} was sent on ${sentOn} — your largest yet. A fine month's work.`;
  }
  // §2.12 default — past-tense statement of the real last payout.
  if (hasBankLast4) {
    return `Your last payout of ${amount} was sent on ${sentOn} to the account ending ${bankLast4}.`;
  }
  // Destination-account omitted variant: states the amount and the real send
  // date, which are sufficient and true of the historical payout data.
  return `Your last payout of ${amount} was sent on ${sentOn}.`;
}

// ── §2.6 First Payment Wow (ED.3) + ED.4 PR-detected chart commentary ───────
//
// Roman P4 showpiece copy, added ADDITIVELY per the P3/P4 split documented in
// the header above (main's P3 module intentionally omits §2.6 and reserves it
// for this P4 builder). Each export below is independent of the P3 builders.
//
// Exclamation accounting: the P3 strings above are all exclamation-free and the
// forbidden-move sweep enforces that. The §2.6 *celebration* variant of
// romanFirstPayment is the single intended home for the session's one rationed
// exclamation (spec §1.4 + §4 surface table). romanPRDetected (ED.4) stays
// exclamation-free. The copy.test.ts sweep therefore excludes romanFirstPayment
// from the zero-exclamation assertion and pins its exclamation count to exactly
// one, while still asserting zero on every other produced string.

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

// ── ED.6 coach-is-watching micro-signal (CompetencePill, client app) ─────────

/**
 * The surface the pill is rendered on. The only difference is whether the copy
 * names "this" (a single check-in detail) or "this thread" (a message thread),
 * per the brief's two phase-1 surfaces (ClientCheckInScreen / ClientMessageScreen).
 */
export type CoachReviewSurface = 'checkIn' | 'thread';

export interface RomanCoachReviewArgs {
  /** ISO-8601 timestamp of the coach's most-recent review. */
  reviewedAt: string;
  /** Which surface the pill sits on (controls "this" vs "this thread"). */
  surface: CoachReviewSurface;
  /**
   * Reference "now" for relative-time bucketing. Injectable so the relative
   * copy is deterministic in tests (defaults to the real wall clock).
   */
  now?: Date;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Calendar-day index in LOCAL time (year*372 + month*31 + day), monotonic. */
function localDayIndex(d: Date): number {
  return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * The relative-time phrase the pill renders, WITHOUT the leading subject. Pure
 * and deterministic given (`reviewedAt`, `now`). Buckets (brief §Relative time):
 *   - < 1 hour          → "just now"
 *   - < 24 hours        → "{N} hour" / "{N} hours ago"
 *   - same calendar day → "earlier today"
 *   - yesterday         → "yesterday"
 *   - within 7 days     → "{N} days ago"
 *   - older             → "on {Month D}"
 *
 * Future timestamps (clock skew) collapse to "just now" so the copy never reads
 * a nonsensical negative interval.
 */
export function romanCoachReviewRelative(reviewedAt: string, now: Date = new Date()): string {
  const then = new Date(reviewedAt);
  const diffMs = now.getTime() - then.getTime();

  // Future / sub-hour → "just now".
  if (diffMs < MS_PER_HOUR) return 'just now';

  const dayDiff = localDayIndex(now) - localDayIndex(then);

  // Within the last 24h but on the same calendar day → an hours phrasing reads
  // more precisely than "earlier today"; only fall to "earlier today" when the
  // hour count is ambiguous (>= 24h spanning a midnight is handled by dayDiff).
  if (diffMs < 24 * MS_PER_HOUR && dayDiff === 0) {
    const hours = Math.floor(diffMs / MS_PER_HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  if (dayDiff === 0) return 'earlier today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 7) return `${dayDiff} days ago`;

  return `on ${MONTHS[then.getMonth()]} ${then.getDate()}`;
}

/**
 * ED.6 coach-is-watching micro-signal — the full pill sentence.
 *
 * Roman's calm butler register: the STRAIGHT voice always (a micro-signal is
 * never a moment for a quip, brief §Voice rules). No exclamation, no emoji, no
 * contractions. The subject is always "Your coach" — Roman is the butler, not
 * the reviewer (brief §Out of scope). Composed from the deterministic relative
 * phrase so the same buckets drive both the copy and its tests.
 */
export function romanCoachReview(args: RomanCoachReviewArgs): string {
  const { reviewedAt, surface, now } = args;
  const relative = romanCoachReviewRelative(reviewedAt, now ?? new Date());
  const object = surface === 'thread' ? 'this thread' : 'this';
  return `Your coach reviewed ${object} ${relative}.`;
}

// ── EW2 Workout-builder undo (coach app) ──────────────────────────────

/**
 * EW2 — the in-screen toast fired when the coach reverts an edit in the workout
 * builder with the undo button (or the two-finger swipe-down gesture).
 *
 * Roman's calm butler register, voice-contract compliant (spec §1.1-§1.6): no
 * emoji, no contractions, no exclamation, no hype. The `depth` is the number of
 * undos STILL REMAINING after this revert (prior audit F5: the toast used to
 * pass the fixed capacity, so it always read "Twenty …" regardless of how many
 * steps were left). It is spelled out as a word so the line reads as prose
 * rather than a counter — "Reverted. Three steps still in the bank." At zero the
 * line drops the count ("Reverted. That was the last step.") and at one it reads
 * singular. The surface is transient (a ~1.4 s toast), so per the FACE+VOICE
 * invariant note at the top of this module it is exempt from co-locating the avatar.
 *
 * The ERROR path (a network failure during undo) does NOT get a bespoke line:
 * the spec routes it through the existing generic error stem
 * (`romanGenericError`) so a failed undo speaks the same calm voice used for
 * every other transient mutation failure, and the command stack is NOT popped so
 * the coach can retry.
 */
export interface RomanBuilderUndoToastArgs {
  /** Undos STILL REMAINING after this revert (prior audit F5). Spelled as a word. */
  depth: number;
}

/** Small fixed table so the depth reads as prose; falls back to the numeral. */
const CARDINAL_WORDS: Record<number, string> = {
  0: 'Zero',
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Eleven',
  12: 'Twelve',
  13: 'Thirteen',
  14: 'Fourteen',
  15: 'Fifteen',
  16: 'Sixteen',
  17: 'Seventeen',
  18: 'Eighteen',
  19: 'Nineteen',
  20: 'Twenty',
  25: 'Twenty-five',
  30: 'Thirty',
};

function cardinalWord(n: number): string {
  return CARDINAL_WORDS[n] ?? String(n);
}

export const romanBuilderUndoToast = {
  /**
   * Success toast for a completed undo. `depth` is the number of undos remaining
   * AFTER this revert: 0 → "That was the last step.", 1 → "One step still in the
   * bank.", N → "N steps still in the bank." (prior audit F5).
   */
  success(args: RomanBuilderUndoToastArgs = { depth: 0 }): string {
    if (args.depth <= 0) return 'Reverted. That was the last step.';
    const noun = args.depth === 1 ? 'step' : 'steps';
    return `Reverted. ${cardinalWord(args.depth)} ${noun} still in the bank.`;
  },
} as const;
/**
 * ED.2 — three-arc router daily-rings line (coach app).
 *
 * The line beneath the three arcs IS the celebration (brief §Visual reference:
 * "No accent celebration animation … The Roman voice line … updates copy when
 * 3/3 close — that IS the celebration"). Two single stems, both in the STRAIGHT
 * butler register (a daily completion is a quiet acknowledgement, not a
 * milestone — no quip, brief §Voice rules). EXCLAMATION-FREE: the session's one
 * rationed exclamation belongs to romanFirstPayment's celebration (§1.4 / §4),
 * so the daily line must not spend it. No emoji, no contractions beyond the
 * possessive "day's", measured respect (§1.1).
 *
 *   - celebration  → shown when all three arcs are closed (3/3 complete).
 *   - encouragement → shown while at least one arc is still open.
 */
export const romanDailyRingsCelebration =
  "Three rings closed. The day's work is done.";

export const romanDailyRingsEncouragement =
  'The day is in motion. Close the rings as you go.';
// ── ED.5 onboarding permanence markers (PermanenceMarker, coach app) ───────

/**
 * ED.5 permanence-marker stems. Roman speaks to the COACH during their own
 * onboarding, the instant a package or its price is saved: a brief, calm line
 * slides in under the input row for ~1.6s, then fades, leaving a persistent
 * checkmark beside the field label (the "permanence marker").
 *
 * These are Roman's STRAIGHT register — the saved-confirmation moment is a
 * reassurance, never a celebration, so the lines are measured, not effusive
 * (spec §1.1). The voice contract holds exactly as in the P3 module above:
 *   • no exclamation marks (these are not the rationed §2.6 celebration);
 *   • no emoji;
 *   • no contractions ("You can", not "You'll");
 *   • no "your coach" — Roman addresses the coach directly about their own
 *     setup, so each stem stands alone with no third-party subject.
 * The PermanenceMarker doctrine test pins all four invariants over both stems.
 */
export const romanPermanenceMarker = {
  /** Shown once a coach creates a package during onboarding. */
  packageSaved: 'Saved. You can change the package any time.',
  /** Shown once a coach sets the package price during onboarding. */
  priceSaved: 'Saved. You can adjust the price any time.',
} as const;

/** The keys of the permanence-marker copy map (the two onboarding affordances). */
export type RomanPermanenceMarkerKind = keyof typeof romanPermanenceMarker;
