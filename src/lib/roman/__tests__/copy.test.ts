/**
 * roman/copy — spec-exact assertion suite for the eight P3 surfaces.
 *
 * Every assertion pins the EXACT string from the locked identity spec
 * (AI_BUTLER_ROMAN_IDENTITY_SPEC.md §2.3-§2.12), deviating only for token
 * substitution. A second sweep runs the §1.4 forbidden-move battery over every
 * produced string (no emoji; no exclamation EXCEPT on the spec-sanctioned
 * milestone-celebration lines; no banned hype / corporate / slang words).
 */
import {
  romanCoachBrief,
  romanCheckInReceived,
  romanNewClient,
  romanStreak,
  romanWorkoutComplete,
  romanVoiceLog,
  romanGenericError,
  romanPayout,
} from '../copy';

// ── §2.3 Coach Brief ────────────────────────────────────────────────────────
describe('romanCoachBrief (§2.3)', () => {
  it('default — spec-exact with token substitution', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 6, mode: 'default' })).toBe(
      'Good morning, Marcus. Your brief is ready. 6 clients need attention today, and two check-ins arrived overnight.',
    );
  });
  it('celebration — record morning, one exclamation', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 0, mode: 'celebration' })).toBe(
      'Good morning, Marcus. Every client is on track this morning. I cannot recall a tidier brief!',
    );
  });
  it('error — brief not assembled', () => {
    expect(romanCoachBrief({ coachName: 'Marcus', clientCount: 6, mode: 'error' })).toBe(
      'Good morning, Marcus. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.',
    );
  });
});

// ── §2.4 Check-in received ────────────────────────────────────────────────────
describe('romanCheckInReceived (§2.4)', () => {
  it('default — spec-exact', () => {
    expect(romanCheckInReceived({ clientName: 'Dana', mode: 'default' })).toBe(
      'Dana has submitted a check-in. I have placed it at the top of your queue.',
    );
  });
  it('celebration — first-ever check-in, one exclamation', () => {
    expect(romanCheckInReceived({ clientName: 'Dana', mode: 'celebration' })).toBe(
      'Dana has submitted their first check-in. A good beginning — I would not keep them waiting!',
    );
  });
  it('error — attachments failed to load', () => {
    expect(romanCheckInReceived({ clientName: 'Dana', mode: 'error' })).toBe(
      'Dana has submitted a check-in, but I could not retrieve the attached photos. I am trying again now.',
    );
  });
});

// ── §2.5 New client onboarded ─────────────────────────────────────────────────
describe('romanNewClient (§2.5)', () => {
  it('default — spec-exact', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 4, mode: 'default' })).toBe(
      'Dana has joined your roster. Their file is prepared and waiting for you.',
    );
  });
  it('celebration — roster milestone, one exclamation', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 10, mode: 'celebration' })).toBe(
      'Dana has joined your roster — your 10th client. The practice is growing handsomely!',
    );
  });
  it('error — intake did not transfer cleanly', () => {
    expect(romanNewClient({ clientName: 'Dana', clientCount: 4, mode: 'error' })).toBe(
      'Dana has joined, but their intake details did not transfer cleanly. I will reconcile it and confirm.',
    );
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
  it('30-day celebration — one exclamation', () => {
    expect(romanStreak({ tier: 30, firstName: 'Sam', mode: 'celebration' })).toBe(
      'Thirty days, Sam. A month without a missed day. This is the kind of record I am glad to keep!',
    );
  });
  it('error — count failed to compute', () => {
    expect(romanStreak({ tier: 7, firstName: 'Sam', mode: 'error' })).toBe(
      'Your streak is intact, Sam — I am simply slow to tally it this morning. The number will be along shortly.',
    );
  });
});

// ── §2.8 Workout completed ────────────────────────────────────────────────────
describe('romanWorkoutComplete (§2.8)', () => {
  it('default — spec-exact', () => {
    expect(romanWorkoutComplete({ mode: 'default' })).toBe(
      'Workout complete. Recorded. That is one more behind you.',
    );
  });
  it('celebration — personal best with lift name, one exclamation', () => {
    expect(romanWorkoutComplete({ mode: 'celebration', liftName: 'deadlift' })).toBe(
      'Workout complete — and a personal best on deadlift, no less. Noted with admiration!',
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
  it('default — spec-exact readback (e.g. "315 for 5")', () => {
    expect(romanVoiceLog({ weight: 315, reps: 5, mode: 'default' })).toBe(
      '315 pounds, 5 reps. Recorded.',
    );
  });
  it('celebration — voice PR, one exclamation', () => {
    expect(romanVoiceLog({ weight: 315, reps: 5, mode: 'celebration' })).toBe(
      '315 pounds, 5 reps. Recorded — and a new best. Noted!',
    );
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
describe('romanPayout (§2.12)', () => {
  it('default — spec-exact with all three tokens', () => {
    expect(
      romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'default' }),
    ).toBe(
      'Your payout of $240.00 is on its way to the account ending 4242. Funds typically settle within 2 business days.',
    );
  });
  it('celebration — record payout, one exclamation', () => {
    expect(
      romanPayout({ amount: '$1,200.00', bankLast4: '4242', settleDays: 2, mode: 'celebration' }),
    ).toBe(
      "Your payout of $1,200.00 is on its way to the account ending 4242 — your largest yet. A fine month's work!",
    );
  });
  it('error — bank declined the transfer', () => {
    expect(
      romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'error' }),
    ).toBe(
      'I was unable to send your payout of $240.00 just now — the bank declined the transfer instruction. Nothing is lost; I will retry and confirm once it is moving.',
    );
  });
});

// ── §1.4 forbidden-move sweep over every produced string ──────────────────────
const ALL_STRINGS: Array<{ label: string; value: string; celebration: boolean }> = [
  { label: '§2.3 default', value: romanCoachBrief({ coachName: 'M', clientCount: 6, mode: 'default' }), celebration: false },
  { label: '§2.3 celebration', value: romanCoachBrief({ coachName: 'M', clientCount: 0, mode: 'celebration' }), celebration: true },
  { label: '§2.3 error', value: romanCoachBrief({ coachName: 'M', clientCount: 6, mode: 'error' }), celebration: false },
  { label: '§2.4 default', value: romanCheckInReceived({ clientName: 'D', mode: 'default' }), celebration: false },
  { label: '§2.4 celebration', value: romanCheckInReceived({ clientName: 'D', mode: 'celebration' }), celebration: true },
  { label: '§2.4 error', value: romanCheckInReceived({ clientName: 'D', mode: 'error' }), celebration: false },
  { label: '§2.5 default', value: romanNewClient({ clientName: 'D', clientCount: 4, mode: 'default' }), celebration: false },
  { label: '§2.5 celebration', value: romanNewClient({ clientName: 'D', clientCount: 10, mode: 'celebration' }), celebration: true },
  { label: '§2.5 error', value: romanNewClient({ clientName: 'D', clientCount: 4, mode: 'error' }), celebration: false },
  { label: '§2.7 3-day', value: romanStreak({ tier: 3, firstName: 'S', mode: 'default' }), celebration: false },
  { label: '§2.7 7-day', value: romanStreak({ tier: 7, firstName: 'S', mode: 'celebration' }), celebration: false },
  { label: '§2.7 30-day', value: romanStreak({ tier: 30, firstName: 'S', mode: 'celebration' }), celebration: true },
  { label: '§2.7 error', value: romanStreak({ tier: 7, firstName: 'S', mode: 'error' }), celebration: false },
  { label: '§2.8 default', value: romanWorkoutComplete({ mode: 'default' }), celebration: false },
  { label: '§2.8 celebration', value: romanWorkoutComplete({ mode: 'celebration', liftName: 'squat' }), celebration: true },
  { label: '§2.8 error', value: romanWorkoutComplete({ mode: 'error' }), celebration: false },
  { label: '§2.9 default', value: romanVoiceLog({ weight: 315, reps: 5, mode: 'default' }), celebration: false },
  { label: '§2.9 celebration', value: romanVoiceLog({ weight: 315, reps: 5, mode: 'celebration' }), celebration: true },
  { label: '§2.9 error', value: romanVoiceLog({ weight: 0, reps: 0, mode: 'error' }), celebration: false },
  { label: '§2.10 default', value: romanGenericError({ mode: 'default' }), celebration: false },
  { label: '§2.10 error', value: romanGenericError({ mode: 'error' }), celebration: false },
  { label: '§2.12 default', value: romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'default' }), celebration: false },
  { label: '§2.12 celebration', value: romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'celebration' }), celebration: true },
  { label: '§2.12 error', value: romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'error' }), celebration: false },
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

  it.each(ALL_STRINGS)('"$label" obeys the exclamation rule', ({ value, celebration }) => {
    const count = (value.match(/!/g) ?? []).length;
    if (celebration) {
      // The one rationed exclamation may live on a milestone-celebration line.
      expect(count).toBeLessThanOrEqual(1);
    } else {
      // Default/error lines never carry an exclamation.
      expect(count).toBe(0);
    }
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
