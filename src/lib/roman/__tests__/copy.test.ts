/**
 * roman/copy — P4 spec-string + voice-contract tests.
 *
 * Two contracts are pinned here:
 *   1. EXACT spec strings — romanFirstPayment (§2.6, all three variants) and
 *      romanPRDetected reproduce the locked identity-spec copy
 *      character-for-character, with tokens interpolated.
 *   2. Voice contract (§1.1-§1.4) — no emoji, no banned hype/slang words, and
 *      the exclamation budget is honoured: ONLY the §2.6 celebration variant
 *      carries an exclamation (the one rationed milestone instrument); the
 *      default/error variants and the PR line are exclamation-free.
 */
import { romanFirstPayment, romanPRDetected } from '../copy';

const COACH = 'Marcus';
const AMOUNT = '$240.00';
const CLIENT = 'Dana';

describe('romanFirstPayment — §2.6 exact spec strings', () => {
  it('default variant matches the spec verbatim', () => {
    expect(
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'default' }),
    ).toBe(
      'Marcus, your first payment has arrived: $240.00 from Dana. This is the part where the work becomes a living. Well earned.',
    );
  });

  it('celebration variant matches the spec verbatim (carries the one exclamation)', () => {
    expect(
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'celebration' }),
    ).toBe(
      'Marcus — your first payment has arrived. $240.00, from Dana. I have seen a great many first payments, and they never stop meaning something. Congratulations!',
    );
  });

  it('error variant matches the spec verbatim (carries the self-deprecating quip)', () => {
    expect(
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'error' }),
    ).toBe(
      'Marcus, your first payment from Dana has cleared — $240.00. My own records lagged a moment behind the good news. It is reconciled now.',
    );
  });

  it('defaults to the default variant for an unknown mode', () => {
    expect(
      // @ts-expect-error — exercising the runtime default branch deliberately.
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'unknown' }),
    ).toContain('This is the part where the work becomes a living.');
  });
});

describe('romanPRDetected — §2.8 / §5 anti-pattern #6 register', () => {
  it('renders the PR commentary with the lift name and weight', () => {
    expect(romanPRDetected({ liftName: 'Back Squat', weight: 315 })).toBe(
      'A personal best on Back Squat — 315 pounds. Noted with admiration.',
    );
  });

  it('preserves a fractional microloading plate', () => {
    expect(romanPRDetected({ liftName: 'Overhead Press', weight: 102.5 })).toBe(
      'A personal best on Overhead Press — 102.5 pounds. Noted with admiration.',
    );
  });
});

describe('voice contract (§1.1-§1.4)', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const BANNED = [
    'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer',
    'crushing it', "let's go", 'beast mode', 'grind', 'slay', 'no cap',
    'synergy', 'leverage', 'circle back', 'bandwidth',
  ];

  const all = [
    romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'default' }),
    romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'celebration' }),
    romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'error' }),
    romanPRDetected({ liftName: 'Back Squat', weight: 315 }),
  ];

  it('contains no emoji in any P4 string', () => {
    all.forEach((s) => expect(s).not.toMatch(EMOJI));
  });

  it('contains no banned hype / corporate / slang words', () => {
    all.forEach((s) => {
      const lower = s.toLowerCase();
      BANNED.forEach((w) => expect(lower).not.toContain(w));
    });
  });

  it('spends exactly ONE exclamation, and only on the §2.6 celebration variant', () => {
    const celebration = romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'celebration' });
    const others = [
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'default' }),
      romanFirstPayment({ coachName: COACH, amount: AMOUNT, clientName: CLIENT, mode: 'error' }),
      romanPRDetected({ liftName: 'Back Squat', weight: 315 }),
    ];
    // Celebration carries exactly one exclamation.
    expect((celebration.match(/!/g) ?? []).length).toBe(1);
    // No other P4 string spends one.
    others.forEach((s) => expect(s).not.toContain('!'));
  });
});
