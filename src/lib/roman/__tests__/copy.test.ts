/**
 * roman/copy — spec-derived assertion suite for the eight P3 surfaces.
 *
 * Every assertion pins the string produced from the locked identity spec
 * (AI_BUTLER_ROMAN_IDENTITY_SPEC.md §2.3-§2.12), adjusted for the available
 * authoritative signals and token substitution. A second sweep runs the §1.4
 * forbidden-move battery over every produced string (no emoji; no banned hype /
 * corporate / slang words) and enforces the no-exclamation rule for P3 UX copy:
 * every P3 string — including all celebration variants — must carry ZERO "!".
 */
import {
  romanCoachBrief,
  romanCheckInClaim,
  romanNewClient,
  romanStreak,
  romanWorkoutComplete,
  romanVoiceLog,
  romanGenericError,
  romanPayout,
  formatOrdinal,
} from '../copy';

// ── §2.3 Coach Brief ────────────────────────────────────────────────────────
describe('romanCoachBrief (§2.3)', () => {
  it('default — spec-exact with token substitution', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 6, mode: 'default' })).toBe(
      'Good morning, Marcus. Your brief is ready. 6 clients need attention today.',
    );
  });
  it('celebration — record morning, no exclamation (rationed to §2.7 30-day)', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 0, mode: 'celebration' })).toBe(
      'Good morning, Marcus. Every client is on track this morning. I cannot recall a tidier brief.',
    );
  });
  it('error — brief not assembled', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 6, mode: 'error' })).toBe(
      'Good morning, Marcus. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.',
    );
  });
});

// ── §2.4 Check-in received ────────────────────────────────────────────────────
// P2-UX-01 (R6): the host signal is a `latestVerifiedProgress` item whose
// kind is `check_in_consistency` and signoffStatus is `pending` — a pending
// verified-progress CLAIM awaiting the coach's sign-off (types/wave11.ts:
// 43-45,68-91,146-147). It does NOT prove a check-in form arrived or that any
// queue was reordered, so the copy asserts only the pending-claim fact.
describe('romanCheckInClaim (§2.4)', () => {
  it('default — truthful pending-claim line', () => {
    expect(romanCheckInClaim({ clientName: 'Dana', mode: 'default' })).toBe(
      'Dana has a check-in consistency claim awaiting your sign-off.',
    );
  });
  it('celebration — first such claim, no exclamation (rationed to §2.7 30-day)', () => {
    expect(romanCheckInClaim({ clientName: 'Dana', mode: 'celebration' })).toBe(
      'Dana has a first check-in consistency claim awaiting your sign-off. A good beginning.',
    );
  });
  it('error — claim proof could not be retrieved', () => {
    expect(romanCheckInClaim({ clientName: 'Dana', mode: 'error' })).toBe(
      'Dana has a check-in consistency claim awaiting your sign-off, but I could not retrieve its proof. I am trying again now.',
    );
  });
  it('default — asserts no queue reorder or form-arrival claim', () => {
    const line = romanCheckInClaim({ clientName: 'Dana', mode: 'default' });
    expect(line).not.toMatch(/queue|submitted a check-in|placed it/i);
  });
});

// ── §2.5 New client onboarded ─────────────────────────────────────────────────
describe('romanNewClient (§2.5)', () => {
  it('default — spec-exact', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 4, mode: 'default' })).toBe(
      'Dana has joined your roster. Their file is prepared and waiting for you.',
    );
  });
  it('celebration — roster milestone, no exclamation (rationed to §2.7 30-day)', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 10, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 10th client. The practice is growing handsomely.',
    );
  });
  it('celebration — grammatical ordinals across milestone boundaries (R11 D-005)', () => {
    // The bug: a hard-coded "th" produced "1th"/"2th"/"21th". Each milestone
    // count must now read with its correct English ordinal.
    expect(romanNewClient({ clientName: 'Dana', clientCount: 1, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 1st client. The practice is growing handsomely.',
    );
    expect(romanNewClient({ clientName: 'Dana', clientCount: 2, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 2nd client. The practice is growing handsomely.',
    );
    expect(romanNewClient({ clientName: 'Dana', clientCount: 3, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 3rd client. The practice is growing handsomely.',
    );
    expect(romanNewClient({ clientName: 'Dana', clientCount: 21, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 21st client. The practice is growing handsomely.',
    );
    expect(romanNewClient({ clientName: 'Dana', clientCount: 11, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 11th client. The practice is growing handsomely.',
    );
  });
  it('error — intake did not transfer cleanly', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 4, mode: 'error' })).toBe(
      'Dana has joined, but their intake details did not transfer cleanly. I will reconcile it and confirm.',
    );
  });
});

// ── formatOrdinal helper (R11 D-005) ──────────────────────────────────────────
describe('formatOrdinal', () => {
  it('ones place: 1st / 2nd / 3rd, else th', () => {
    expect(formatOrdinal(1)).toBe('1st');
    expect(formatOrdinal(2)).toBe('2nd');
    expect(formatOrdinal(3)).toBe('3rd');
    expect(formatOrdinal(4)).toBe('4th');
    expect(formatOrdinal(5)).toBe('5th');
  });
  it('teens 11/12/13 are always th', () => {
    expect(formatOrdinal(11)).toBe('11th');
    expect(formatOrdinal(12)).toBe('12th');
    expect(formatOrdinal(13)).toBe('13th');
  });
  it('twenties follow the ones place again', () => {
    expect(formatOrdinal(20)).toBe('20th');
    expect(formatOrdinal(21)).toBe('21st');
    expect(formatOrdinal(22)).toBe('22nd');
    expect(formatOrdinal(23)).toBe('23rd');
    expect(formatOrdinal(24)).toBe('24th');
  });
  it('larger teens-within-hundreds (111/112/113) are th', () => {
    expect(formatOrdinal(111)).toBe('111th');
    expect(formatOrdinal(112)).toBe('112th');
    expect(formatOrdinal(113)).toBe('113th');
    expect(formatOrdinal(101)).toBe('101st');
  });
  it('zero and round hundreds are th', () => {
    expect(formatOrdinal(0)).toBe('0th');
    expect(formatOrdinal(100)).toBe('100th');
  });
});

// ── §2.7 Streak milestone ─────────────────────────────────────────────────────
describe('romanStreak (§2.7)', () => {
  it('3-day default — measured, no name token', () => {
    expect(romanStreak({ tier: 3, firstName: 'Sam', mode: 'default' })).toBe(
      'Three days running. A streak is just consistency that has been counting. Keep it.',
    );
  });
  it('7-day celebration — spec-exact', () => {
    expect(romanStreak({ tier: 7, firstName: 'Sam', mode: 'celebration' })).toBe(
      'Seven days unbroken, Sam. A full week is no small thing. Onward.',
    );
  });
  it('30-day celebration — composed period, no exclamation in P3 UX copy', () => {
    expect(romanStreak({ tier: 30, firstName: 'Sam', mode: 'celebration' })).toBe(
      'Thirty days, Sam. A month without a missed day. This is the kind of record I am glad to keep.',
    );
  });
  it('error — count failed to compute', () => {
    expect(romanStreak({ tier: 7, firstName: 'Sam', mode: 'error' })).toBe(
      'Your streak is intact, Sam — I am simply slow to tally it this morning. The number will be along shortly.',
    );
  });

  // The 30-day line is the strongest celebration in P3, yet it still carries no
  // exclamation: the line is stable across repeated calls and never renders a
  // "!", regardless of how many times it is requested in a session.
  it('30-day celebration — stable and exclamation-free on repeated calls', () => {
    const first = romanStreak({ tier: 30, firstName: 'Sam', mode: 'celebration' });
    const second = romanStreak({ tier: 30, firstName: 'Sam', mode: 'celebration' });
    expect(first).toBe(second);
    expect(first).not.toContain('!');
    expect(second).not.toContain('!');
  });
});

// ── §2.8 Workout completed ────────────────────────────────────────────────────
describe('romanWorkoutComplete (§2.8)', () => {
  it('default — spec-exact', () => {
    expect(romanWorkoutComplete({ mode: 'default' })).toBe(
      'Workout complete. Recorded. That is one more behind you.',
    );
  });
  it('celebration — personal best with lift name, no exclamation (rationed to §2.7 30-day)', () => {
    expect(romanWorkoutComplete({ mode: 'celebration', liftName: 'deadlift' })).toBe(
      'Workout complete — and a personal best on deadlift, no less. Noted with admiration.',
    );
  });
  it('celebration without a lift name falls back to the default line', () => {
    expect(romanWorkoutComplete({ mode: 'celebration' })).toBe(
      'Workout complete. Recorded. That is one more behind you.',
    );
  });
  it('error — finished but save failed', () => {
    expect(romanWorkoutComplete({ mode: 'error' })).toBe(
      'Your workout is finished, but I have not yet been able to save it. Do not close the app — I am writing it down now.',
    );
  });
});

// ── §2.9 Voice-log confirmation ───────────────────────────────────────────────
describe('romanVoiceLog (§2.9)', () => {
  it('default — readback of the parsed set, no durable-save claim (P1-B-03)', () => {
    const line = romanVoiceLog({ weight: 315, reps: 5, mode: 'default' });
    expect(line).toBe('315 pounds, 5 reps.');
    // P1-B-03: the readback fires on parse, so it must NOT claim persistence.
    expect(line).not.toMatch(/recorded|saved|logged|stored/i);
  });
  it('celebration — voice PR, no exclamation, no durable-save claim (P1-B-03)', () => {
    const line = romanVoiceLog({ weight: 315, reps: 5, mode: 'celebration' });
    expect(line).toBe('315 pounds, 5 reps — and a new best. Noted.');
    expect(line).not.toMatch(/recorded|saved|logged|stored/i);
    expect(line).not.toContain('!');
  });
  it('error — could not parse the utterance', () => {
    expect(romanVoiceLog({ weight: 0, reps: 0, mode: 'error' })).toBe(
      'I did not catch that cleanly. Tell me the weight and the reps once more, and I will record it.',
    );
  });
});

// ── §2.10 Generic error ───────────────────────────────────────────────────────
describe('romanGenericError (§2.10)', () => {
  it('default — transient failure', () => {
    expect(romanGenericError({ mode: 'default' })).toBe(
      'That request did not complete. I will try again.',
    );
  });
  it('error — hard failure, retry exhausted', () => {
    expect(romanGenericError({ mode: 'error' })).toBe(
      'That request did not complete, and my attempts to retry have not succeeded either. I have logged the matter. Please try again in a few minutes.',
    );
  });
});

// ── §2.12 Coach payout ────────────────────────────────────────────────────────
// P2-UX-03 (R6): the mobile CoachEarningsSummary contract carries only the
// historical send timestamp (`lastPayoutAt`), not an in-transit/settlement
// signal (api/packagesApi.ts:135-149), so the copy is PAST TENSE — the payout
// was sent on a real date, not "on its way".
describe('romanPayout (§2.12)', () => {
  it('default — past tense with amount, send date, and account', () => {
    expect(
      romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'default' }),
    ).toBe(
      'Your last payout of $240.00 was sent on June 9 to the account ending 4242.',
    );
  });
  it('celebration — record payout, no exclamation (rationed to §2.7 30-day)', () => {
    expect(
      romanPayout({ amount: '$1,200.00', bankLast4: '4242', sentOn: 'June 9', mode: 'celebration' }),
    ).toBe(
      "Your last payout of $1,200.00 was sent on June 9 to the account ending 4242 — your largest yet. A fine month's work.",
    );
  });
  it('error — bank declined the transfer', () => {
    expect(
      romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'error' }),
    ).toBe(
      'I was unable to send your payout of $240.00 just now — the bank declined the transfer instruction. Nothing is lost; I will retry and confirm once it is moving.',
    );
  });
  it('default — never claims the payout is in transit', () => {
    const line = romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'default' });
    expect(line).not.toMatch(/on its way|settle within|in transit/i);
    expect(line).toContain('was sent on');
  });

  // P2-UX-04 (R5): the CoachEarningsSummary contract does not carry the
  // destination bank's last-four. When omitted, the copy must DROP the
  // "account ending …" clause rather than ship a placeholder token. The amount
  // and send date are sufficient and true.
  it('default — OMITS the destination-account clause when bankLast4 is absent', () => {
    const line = romanPayout({ amount: '$240.00', sentOn: 'June 9', mode: 'default' });
    expect(line).toBe('Your last payout of $240.00 was sent on June 9.');
    expect(line).not.toContain('account ending');
  });
  it('default — also omits the clause for an empty/whitespace bankLast4', () => {
    expect(romanPayout({ amount: '$240.00', bankLast4: '', sentOn: 'June 9', mode: 'default' })).toBe(
      'Your last payout of $240.00 was sent on June 9.',
    );
    expect(romanPayout({ amount: '$240.00', bankLast4: '   ', sentOn: 'June 9', mode: 'default' })).not.toContain(
      'account ending',
    );
  });
  it('celebration — omits the destination-account clause when bankLast4 is absent, still no exclamation', () => {
    const line = romanPayout({ amount: '$1,200.00', sentOn: 'June 9', mode: 'celebration' });
    expect(line).toBe("Your last payout of $1,200.00 was sent on June 9 — your largest yet. A fine month's work.");
    expect(line).not.toContain('account ending');
    expect(line).not.toContain('!');
  });
  it('never renders a literal em-dash placeholder token (P2-UX-04 / #49)', () => {
    for (const mode of ['default', 'celebration'] as const) {
      const line = romanPayout({ amount: '$240.00', sentOn: 'June 9', mode });
      expect(line).not.toContain('\u2014\u2014\u2014\u2014');
      expect(line).not.toContain('ending undefined');
    }
  });
});

// ── §1.4 forbidden-move sweep over every produced string ──────────────────────
// No P3 UX copy string may carry an exclamation. EVERY string — including all
// celebration variants (the §2.7 30-day streak line included) — must carry ZERO
// exclamations.
const ALL_STRINGS: Array<{ label: string; value: string }> = [
  { label: '§2.3 default', value: romanCoachBrief({ coachName: 'M', clientCount: 6, mode: 'default' }) },
  { label: '§2.3 celebration', value: romanCoachBrief({ coachName: 'M', clientCount: 0, mode: 'celebration' }) },
  { label: '§2.3 error', value: romanCoachBrief({ coachName: 'M', clientCount: 6, mode: 'error' }) },
  { label: '§2.4 default', value: romanCheckInClaim({ clientName: 'D', mode: 'default' }) },
  { label: '§2.4 celebration', value: romanCheckInClaim({ clientName: 'D', mode: 'celebration' }) },
  { label: '§2.4 error', value: romanCheckInClaim({ clientName: 'D', mode: 'error' }) },
  { label: '§2.5 default', value: romanNewClient({ clientName: 'D', clientCount: 4, mode: 'default' }) },
  { label: '§2.5 celebration', value: romanNewClient({ clientName: 'D', clientCount: 10, mode: 'celebration' }) },
  { label: '§2.5 error', value: romanNewClient({ clientName: 'D', clientCount: 4, mode: 'error' }) },
  { label: '§2.7 3-day', value: romanStreak({ tier: 3, firstName: 'S', mode: 'default' }) },
  { label: '§2.7 7-day', value: romanStreak({ tier: 7, firstName: 'S', mode: 'celebration' }) },
  { label: '§2.7 30-day', value: romanStreak({ tier: 30, firstName: 'S', mode: 'celebration' }) },
  { label: '§2.7 error', value: romanStreak({ tier: 7, firstName: 'S', mode: 'error' }) },
  { label: '§2.8 default', value: romanWorkoutComplete({ mode: 'default' }) },
  { label: '§2.8 celebration', value: romanWorkoutComplete({ mode: 'celebration', liftName: 'squat' }) },
  { label: '§2.8 error', value: romanWorkoutComplete({ mode: 'error' }) },
  { label: '§2.9 default', value: romanVoiceLog({ weight: 315, reps: 5, mode: 'default' }) },
  { label: '§2.9 celebration', value: romanVoiceLog({ weight: 315, reps: 5, mode: 'celebration' }) },
  { label: '§2.9 error', value: romanVoiceLog({ weight: 0, reps: 0, mode: 'error' }) },
  { label: '§2.10 default', value: romanGenericError({ mode: 'default' }) },
  { label: '§2.10 error', value: romanGenericError({ mode: 'error' }) },
  { label: '§2.12 default', value: romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'default' }) },
  { label: '§2.12 celebration', value: romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'celebration' }) },
  { label: '§2.12 error', value: romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'error' }) },
];

const EMOJI_RE = new RegExp(
  [
    '[\\u{1F300}-\\u{1FAFF}]',
    '[\\u{2600}-\\u{27BF}]',
    '[\\u{2190}-\\u{21FF}]',
    '[\\u{2B00}-\\u{2BFF}]',
    '[\\u{1F000}-\\u{1F02F}]',
    '[\\u{1F1E6}-\\u{1F1FF}]',
    '[\\u{FE00}-\\u{FE0F}]',
  ].join('|'),
  'u',
);

const BANNED_WORDS = [
  'synergy', 'leverage', 'circle back', 'touch base', 'bandwidth', 'action item', "let's align",
  'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer',
  'ship it', 'mvp', 'north star', 'low-hanging fruit',
  'crushing it', "let's go", 'beast mode', 'no pain no gain', "let's get it",
  'slay', 'no cap', 'rizz', 'lowkey', "it's giving",
];

describe('roman/copy — §1.4 forbidden-move sweep', () => {
  it.each(ALL_STRINGS)('"$label" contains no emoji', ({ value }) => {
    expect(EMOJI_RE.test(value)).toBe(false);
  });

  it.each(ALL_STRINGS)('"$label" carries zero exclamation marks', ({ value }) => {
    const count = (value.match(/!/g) ?? []).length;
    // No exclamation anywhere in P3 UX copy — including every celebration.
    expect(count).toBe(0);
  });

  it('no P3 string carries an exclamation', () => {
    const withBang = ALL_STRINGS.filter(({ value }) => value.includes('!'));
    expect(withBang).toHaveLength(0);
  });

  it.each(ALL_STRINGS)('"$label" contains no banned hype / slang / corporate word', ({ value }) => {
    const lower = value.toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  });

  it.each(ALL_STRINGS)('"$label" is non-empty and trimmed', ({ value }) => {
    expect(value.length).toBeGreaterThan(0);
    expect(value).toBe(value.trim());
  });
});
