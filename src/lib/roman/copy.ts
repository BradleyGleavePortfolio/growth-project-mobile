/**
 * roman/copy — single source of truth for the P3 voice-expansion surfaces.
 *
 * Every string returned below is taken VERBATIM from the locked Roman identity
 * spec (BradleyGleavePortfolio/tgp-agent-context
 * strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md), §2.3-§2.12, deviating ONLY for
 * `{token}` substitution. Copy must never be inlined in a screen file — the
 * eight P3 surfaces (§2.3 Coach Brief, §2.4 check-in received, §2.5 new client
 * onboarded, §2.7 streak, §2.8 workout complete, §2.9 voice-log confirm, §2.10
 * generic error, §2.12 coach payout) all consume their prose from here so the
 * voice has exactly one home.
 *
 * Voice-contract compliance (spec §1.1-§1.6): no emoji ever, no exclamation
 * point EXCEPT the single rationed milestone instrument (it lives only on the
 * §2.3 record-morning, §2.5 roster-milestone, §2.7 30-day, §2.8 PR, §2.9 voice
 * PR, and §2.12 record-payout celebration lines per the spec's own sample
 * copy), no contractions in the default tone, no hype words, no slang.
 *
 * FACE+VOICE invariant: every render-site that imports a function from this
 * module MUST also mount <RomanAvatar /> in the same component tree. The P3
 * surface components under src/components/roman/ enforce this co-location.
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
 * §2.3 Coach Brief. default/celebration/error variants, spec-exact.
 *
 * Trigger: `celebration` when every client is on track this morning;
 * `error` when the brief payload failed to assemble; otherwise `default`.
 */
export function romanCoachBrief(args: RomanCoachBriefArgs): string {
  const { coachName, clientCount, mode } = args;
  if (mode === 'celebration') {
    // spec §2.3 milestone-celebration (record morning) — one exclamation.
    return `Good morning, ${coachName}. Every client is on track this morning. I cannot recall a tidier brief!`;
  }
  if (mode === 'error') {
    // spec §2.3 error (brief could not be assembled).
    return `Good morning, ${coachName}. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.`;
  }
  // spec §2.3 default.
  return `Good morning, ${coachName}. Your brief is ready. ${clientCount} clients need attention today, and two check-ins arrived overnight.`;
}

// ── §2.4 Client check-in submitted to coach (coach app) ─────────────────────

export interface RomanCheckInReceivedArgs {
  /** Submitting client's display name. */
  clientName: string;
  /**
   * default — a check-in arrived; celebration — the client's first-ever
   * check-in; error — the check-in arrived but its attachments failed to load.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.4 Client check-in received. spec-exact default/celebration/error.
 *
 * Trigger: `celebration` on the client's first-ever check-in; `error` when
 * attached photos could not be retrieved; otherwise `default`.
 */
export function romanCheckInReceived(args: RomanCheckInReceivedArgs): string {
  const { clientName, mode } = args;
  if (mode === 'celebration') {
    // spec §2.4 milestone-celebration (first-ever check-in) — one exclamation.
    return `${clientName} has submitted their first check-in. A good beginning — I would not keep them waiting!`;
  }
  if (mode === 'error') {
    // spec §2.4 error (attachments failed to load).
    return `${clientName} has submitted a check-in, but I could not retrieve the attached photos. I am trying again now.`;
  }
  // spec §2.4 default.
  return `${clientName} has submitted a check-in. I have placed it at the top of your queue.`;
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
 * §2.5 New client onboarded. spec-exact default/celebration/error.
 *
 * Trigger: `celebration` on a roster milestone (host decides which counts are
 * milestones); `error` when intake did not transfer cleanly; else `default`.
 */
export function romanNewClient(args: RomanNewClientArgs): string {
  const { clientName, clientCount, mode } = args;
  if (mode === 'celebration') {
    // spec §2.5 milestone-celebration (roster milestone) — one exclamation.
    return `${clientName} has joined your roster — your ${clientCount}th client. The practice is growing handsomely!`;
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
   * lines (30-day spends the session's one exclamation); error — the streak
   * count failed to compute.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.7 Streak milestone. spec-exact across the three tiers + error.
 *
 * Trigger: 3-day uses `default` (measured); 7-day and 30-day use
 * `celebration` (the mascot wears the knowing slight smile on 7/30 per §3.8);
 * `error` when the count could not be tallied.
 *
 * The 30-day celebration carries the session's one permitted exclamation.
 */
export function romanStreak(args: RomanStreakArgs): string {
  const { tier, firstName, mode } = args;
  if (mode === 'error') {
    // spec §2.7 error (streak count failed to compute).
    return `Your streak is intact, ${firstName} — I am simply slow to tally it this morning. The number will be along shortly.`;
  }
  if (tier === 30) {
    // spec §2.7 milestone-celebration, 30-day — one exclamation.
    return `Thirty days, ${firstName}. A month without a missed day. This is the kind of record I am glad to keep!`;
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
 * §2.8 Workout completed. spec-exact default/celebration/error.
 *
 * Trigger: `celebration` on a personal best (the mascot wears the slight
 * smile, §3.8); `error` when the session finished but could not be saved;
 * otherwise `default`.
 */
export function romanWorkoutComplete(args: RomanWorkoutCompleteArgs): string {
  const { mode, liftName } = args;
  if (mode === 'celebration') {
    // spec §2.8 milestone-celebration (personal best) — one exclamation.
    // A PR celebration requires the lift name; fall back to the default line
    // rather than render a hollow "personal best on ." if it is missing.
    if (liftName == null || liftName.trim() === '') {
      return 'Workout complete. Recorded. That is one more behind you.';
    }
    return `Workout complete — and a personal best on ${liftName}, no less. Noted with admiration!`;
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
 * §2.9 Voice-log confirmation. spec-exact readback. Kept short and literal so
 * the number is never in doubt (no quip on the default per spec §2.9).
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
    // spec §2.9 milestone-celebration (a logged PR via voice) — one exclamation.
    return `${weight} pounds, ${reps} reps. Recorded — and a new best. Noted!`;
  }
  // spec §2.9 default — e.g. "315 pounds, 5 reps. Recorded."
  return `${weight} pounds, ${reps} reps. Recorded.`;
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
 * §2.10 Generic error. spec-exact default (transient) / error (hard failure).
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
  /** Last four digits of the destination bank account. */
  bankLast4: string;
  /** Typical settlement window in business days (default line). */
  settleDays: number;
  /**
   * default — payout on its way; celebration — a record payout / milestone
   * total; error — the bank declined the transfer instruction.
   */
  mode: RomanVoiceMode;
}

/**
 * §2.12 Coach payout. spec-exact default/celebration/error.
 *
 * Trigger: `celebration` on a record payout (the host decides "largest yet");
 * `error` when the payout initiation failed; otherwise `default`.
 */
export function romanPayout(args: RomanPayoutArgs): string {
  const { amount, bankLast4, settleDays, mode } = args;
  if (mode === 'celebration') {
    // spec §2.12 milestone-celebration (record payout) — one exclamation.
    return `Your payout of ${amount} is on its way to the account ending ${bankLast4} — your largest yet. A fine month's work!`;
  }
  if (mode === 'error') {
    // spec §2.12 error (payout initiation failed; bank declined).
    return `I was unable to send your payout of ${amount} just now — the bank declined the transfer instruction. Nothing is lost; I will retry and confirm once it is moving.`;
  }
  // spec §2.12 default.
  return `Your payout of ${amount} is on its way to the account ending ${bankLast4}. Funds typically settle within ${settleDays} business days.`;
}
