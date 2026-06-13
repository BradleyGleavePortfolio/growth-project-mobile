/**
 * Roman P3 surface component tests (§2.3-§2.12, minus §2.6 which the P4 builder
 * owns). For every surface this asserts:
 *   1. FACE+VOICE — a RomanAvatar (testID ending "-avatar") is in the tree.
 *   2. The avatar expression is correct: `smile` (knowing slight smile, §3.8)
 *      ONLY on celebration; `neutral` otherwise.
 *   3. The rendered copy is the spec-exact line for the chosen mode/tokens.
 *
 * RomanAvatar renders its bundled face as an <Image> with accessibilityLabel
 * "Roman" (neutral) or "Roman, pleased" (smile crop), so the expression is
 * asserted via that label — the same contract the existing
 * romanFaceAndConfirm suite relies on.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import RomanBriefCard from '../RomanBriefCard';
import RomanCheckInNotice from '../RomanCheckInNotice';
import RomanNewClientNotice from '../RomanNewClientNotice';
import RomanStreakCard from '../RomanStreakCard';
import RomanWorkoutCompleteCard from '../RomanWorkoutCompleteCard';
import RomanVoiceLogReadback from '../RomanVoiceLogReadback';
import RomanErrorBanner from '../RomanErrorBanner';
import RomanPayoutNotice from '../RomanPayoutNotice';

const NEUTRAL = 'Roman';
const PLEASED = 'Roman, pleased';

// ── §2.3 Coach Brief ──────────────────────────────────────────────────────────
describe('RomanBriefCard (§2.3)', () => {
  it('default — neutral face + spec copy, FACE+VOICE present', () => {
    const { getByTestId, getByText } = render(
      <RomanBriefCard coachName="Marcus" clientCount={6} mode="default" />,
    );
    const avatar = getByTestId('roman-brief-avatar');
    expect(avatar.props.accessibilityLabel).toBe(NEUTRAL);
    expect(
      getByText(
        'Good morning, Marcus. Your brief is ready. 6 clients need attention today.',
      ),
    ).toBeTruthy();
  });
  it('celebration — slight smile face on a record morning', () => {
    const { getByTestId, getByText } = render(
      <RomanBriefCard coachName="Marcus" clientCount={0} mode="celebration" />,
    );
    expect(getByTestId('roman-brief-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(
      getByText('Good morning, Marcus. Every client is on track this morning. I cannot recall a tidier brief.'),
    ).toBeTruthy();
  });
  it('error — neutral face + error copy', () => {
    const { getByTestId, getByText } = render(
      <RomanBriefCard coachName="Marcus" clientCount={6} mode="error" />,
    );
    expect(getByTestId('roman-brief-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(
      getByText('Good morning, Marcus. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.'),
    ).toBeTruthy();
  });
});

// ── §2.4 Check-in received ────────────────────────────────────────────────────
describe('RomanCheckInNotice (§2.4)', () => {
  it('default — neutral + truthful pending-claim copy + avatar present (operator rule: avatar INCLUDED)', () => {
    const { getByTestId, getByText } = render(
      <RomanCheckInNotice clientName="Dana" mode="default" />,
    );
    expect(getByTestId('roman-checkin-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Dana has a check-in consistency claim awaiting your sign-off.')).toBeTruthy();
  });
  it('celebration — slight smile on the first such claim', () => {
    const { getByTestId, getByText } = render(
      <RomanCheckInNotice clientName="Dana" mode="celebration" />,
    );
    expect(getByTestId('roman-checkin-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Dana has a first check-in consistency claim awaiting your sign-off. A good beginning.')).toBeTruthy();
  });
  it('error — neutral + claim-proof-failure copy', () => {
    const { getByTestId, getByText } = render(
      <RomanCheckInNotice clientName="Dana" mode="error" />,
    );
    expect(getByTestId('roman-checkin-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Dana has a check-in consistency claim awaiting your sign-off, but I could not retrieve its proof. I am trying again now.')).toBeTruthy();
  });
});

// ── §2.5 New client onboarded ─────────────────────────────────────────────────
describe('RomanNewClientNotice (§2.5)', () => {
  it('default — neutral + copy + avatar present', () => {
    const { getByTestId, getByText } = render(
      <RomanNewClientNotice clientName="Dana" clientCount={4} mode="default" />,
    );
    expect(getByTestId('roman-newclient-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Dana has joined your roster. Their file is prepared and waiting for you.')).toBeTruthy();
  });
  it('celebration — slight smile on a roster milestone', () => {
    const { getByTestId, getByText } = render(
      <RomanNewClientNotice clientName="Dana" clientCount={10} mode="celebration" />,
    );
    expect(getByTestId('roman-newclient-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Dana has joined your roster — your 10th client. The practice is growing handsomely.')).toBeTruthy();
  });
});

// ── §2.7 Streak milestone ─────────────────────────────────────────────────────
describe('RomanStreakCard (§2.7)', () => {
  it('3-day default — NEUTRAL face (§3.8: no smile below 7-day)', () => {
    const { getByTestId, getByText } = render(
      <RomanStreakCard tier={3} firstName="Sam" mode="default" />,
    );
    expect(getByTestId('roman-streak-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Three days running. A streak is just consistency that has been counting. Keep it.')).toBeTruthy();
  });
  it('7-day celebration — SLIGHT SMILE face (§3.8)', () => {
    const { getByTestId, getByText } = render(
      <RomanStreakCard tier={7} firstName="Sam" mode="celebration" />,
    );
    expect(getByTestId('roman-streak-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Seven days unbroken, Sam. A full week is no small thing. Onward.')).toBeTruthy();
  });
  it('30-day celebration — SLIGHT SMILE + the one exclamation', () => {
    const { getByTestId, getByText } = render(
      <RomanStreakCard tier={30} firstName="Sam" mode="celebration" />,
    );
    expect(getByTestId('roman-streak-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Thirty days, Sam. A month without a missed day. This is the kind of record I am glad to keep!')).toBeTruthy();
  });
});

// ── §2.8 Workout completed ────────────────────────────────────────────────────
describe('RomanWorkoutCompleteCard (§2.8)', () => {
  it('default — neutral + copy', () => {
    const { getByTestId, getByText } = render(<RomanWorkoutCompleteCard mode="default" />);
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Workout complete. Recorded. That is one more behind you.')).toBeTruthy();
  });
  it('celebration — SLIGHT SMILE on a PR with lift name', () => {
    const { getByTestId, getByText } = render(
      <RomanWorkoutCompleteCard mode="celebration" liftName="deadlift" />,
    );
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Workout complete — and a personal best on deadlift, no less. Noted with admiration.')).toBeTruthy();
  });
  it('error — neutral + save-failure copy', () => {
    const { getByTestId, getByText } = render(<RomanWorkoutCompleteCard mode="error" />);
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Your workout is finished, but I have not yet been able to save it. Do not close the app — I am writing it down now.')).toBeTruthy();
  });
  it('celebration with a valid lift name — SMILE + PR copy (coherent)', () => {
    const { getByTestId, getByText } = render(
      <RomanWorkoutCompleteCard mode="celebration" liftName="Squat" />,
    );
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('Workout complete — and a personal best on Squat, no less. Noted with admiration.')).toBeTruthy();
  });
  it('celebration with a blank lift name — NEUTRAL + default copy (no mismatch)', () => {
    const { getByTestId, getByText } = render(
      <RomanWorkoutCompleteCard mode="celebration" liftName="" />,
    );
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Workout complete. Recorded. That is one more behind you.')).toBeTruthy();
  });
  it('celebration with an undefined lift name — NEUTRAL + default copy (no mismatch)', () => {
    const { getByTestId, getByText } = render(
      <RomanWorkoutCompleteCard mode="celebration" liftName={undefined} />,
    );
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Workout complete. Recorded. That is one more behind you.')).toBeTruthy();
  });
  it('celebration with a whitespace-only lift name — NEUTRAL + default copy', () => {
    const { getByTestId, getByText } = render(
      <RomanWorkoutCompleteCard mode="celebration" liftName="   " />,
    );
    expect(getByTestId('roman-workout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('Workout complete. Recorded. That is one more behind you.')).toBeTruthy();
  });
});

// ── P1-UX-01: dynamic copy announced to assistive tech (live regions) ─────────
describe('Roman P3 dynamic-copy live regions (P1-UX-01)', () => {
  it('RomanBriefCard copy is a polite live region', () => {
    const { getByText } = render(
      <RomanBriefCard coachName="Marcus" clientCount={6} mode="default" />,
    );
    expect(
      getByText(
        'Good morning, Marcus. Your brief is ready. 6 clients need attention today.',
      ).props.accessibilityLiveRegion,
    ).toBe('polite');
  });
  it('RomanCheckInNotice copy is a polite live region', () => {
    const { getByText } = render(<RomanCheckInNotice clientName="Dana" mode="default" />);
    expect(
      getByText('Dana has a check-in consistency claim awaiting your sign-off.').props
        .accessibilityLiveRegion,
    ).toBe('polite');
  });
  it('RomanNewClientNotice copy is a polite live region', () => {
    const { getByText } = render(
      <RomanNewClientNotice clientName="Dana" clientCount={4} mode="default" />,
    );
    expect(
      getByText('Dana has joined your roster. Their file is prepared and waiting for you.').props
        .accessibilityLiveRegion,
    ).toBe('polite');
  });
  it('RomanPayoutNotice copy is a polite live region', () => {
    const { getByText } = render(
      <RomanPayoutNotice amount="$240.00" bankLast4="4242" sentOn="June 9" mode="default" />,
    );
    expect(
      getByText(
        'Your last payout of $240.00 was sent on June 9 to the account ending 4242.',
      ).props.accessibilityLiveRegion,
    ).toBe('polite');
  });
  it('RomanStreakCard copy is a polite live region', () => {
    const { getByText } = render(<RomanStreakCard tier={3} firstName="Sam" mode="default" />);
    expect(
      getByText('Three days running. A streak is just consistency that has been counting. Keep it.')
        .props.accessibilityLiveRegion,
    ).toBe('polite');
  });
  it('RomanVoiceLogReadback copy is a polite live region (highest priority)', () => {
    const { getByText } = render(<RomanVoiceLogReadback weight={315} reps={5} mode="default" />);
    expect(getByText('315 pounds, 5 reps.').props.accessibilityLiveRegion).toBe('polite');
  });
  it('RomanWorkoutCompleteCard copy is a polite live region', () => {
    const { getByText } = render(<RomanWorkoutCompleteCard mode="default" />);
    expect(
      getByText('Workout complete. Recorded. That is one more behind you.').props
        .accessibilityLiveRegion,
    ).toBe('polite');
  });
});

// ── §2.9 Voice-log confirmation ───────────────────────────────────────────────
describe('RomanVoiceLogReadback (§2.9)', () => {
  it('default — small neutral avatar + literal readback', () => {
    const { getByTestId, getByText } = render(
      <RomanVoiceLogReadback weight={315} reps={5} mode="default" />,
    );
    const avatar = getByTestId('roman-voicelog-avatar');
    expect(avatar.props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('315 pounds, 5 reps.')).toBeTruthy();
    expect(getByText('315 pounds, 5 reps.').props.children).not.toMatch(/recorded|saved|logged|stored/i);
  });
  it('celebration — slight smile on a voice PR', () => {
    const { getByTestId, getByText } = render(
      <RomanVoiceLogReadback weight={315} reps={5} mode="celebration" />,
    );
    expect(getByTestId('roman-voicelog-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(getByText('315 pounds, 5 reps — and a new best. Noted.')).toBeTruthy();
    expect(
      getByText('315 pounds, 5 reps — and a new best. Noted.').props.children,
    ).not.toMatch(/recorded|saved|logged|stored/i);
  });
  it('error — neutral + parse-failure copy', () => {
    const { getByTestId, getByText } = render(
      <RomanVoiceLogReadback weight={0} reps={0} mode="error" />,
    );
    expect(getByTestId('roman-voicelog-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(getByText('I did not catch that cleanly. Tell me the weight and the reps once more, and I will record it.')).toBeTruthy();
  });
});

// ── §2.10 Generic error (both apps) ───────────────────────────────────────────
describe('RomanErrorBanner (§2.10)', () => {
  it('toast (default) — NO mascot in toasts (spec §4), transient copy present', () => {
    const { queryByTestId, getByText } = render(<RomanErrorBanner mode="default" />);
    // Identity spec §4 "Error toast / banner": Roman speaks, but no mascot in
    // toasts. The avatar must be absent on the default (toast) surface; only
    // the voice copy renders.
    expect(queryByTestId('roman-error-avatar')).toBeNull();
    expect(getByText('That request did not complete. I will try again.')).toBeTruthy();
  });
  it('toast (error) — NO mascot in toasts (spec §4), hard-failure copy present', () => {
    const { queryByTestId, getByText } = render(<RomanErrorBanner mode="error" />);
    expect(queryByTestId('roman-error-avatar')).toBeNull();
    expect(
      getByText('That request did not complete, and my attempts to retry have not succeeded either. I have logged the matter. Please try again in a few minutes.'),
    ).toBeTruthy();
  });
  it('full error SCREEN — DOES show the avatar (spec §4 exception)', () => {
    const { getByTestId, getByText } = render(
      <RomanErrorBanner mode="error" surface="screen" />,
    );
    expect(getByTestId('roman-error-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(
      getByText('That request did not complete, and my attempts to retry have not succeeded either. I have logged the matter. Please try again in a few minutes.'),
    ).toBeTruthy();
  });
});

// ── §2.12 Coach payout ────────────────────────────────────────────────────────
describe('RomanPayoutNotice (§2.12)', () => {
  it('default — neutral + copy + avatar present', () => {
    const { getByTestId, getByText } = render(
      <RomanPayoutNotice amount="$240.00" bankLast4="4242" sentOn="June 9" mode="default" />,
    );
    expect(getByTestId('roman-payout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(
      getByText('Your last payout of $240.00 was sent on June 9 to the account ending 4242.'),
    ).toBeTruthy();
  });
  it('celebration — slight smile on a record payout', () => {
    const { getByTestId, getByText } = render(
      <RomanPayoutNotice amount="$1,200.00" bankLast4="4242" sentOn="June 9" mode="celebration" />,
    );
    expect(getByTestId('roman-payout-avatar').props.accessibilityLabel).toBe(PLEASED);
    expect(
      getByText("Your last payout of $1,200.00 was sent on June 9 to the account ending 4242 — your largest yet. A fine month's work."),
    ).toBeTruthy();
  });
  it('error — neutral + decline copy', () => {
    const { getByTestId, getByText } = render(
      <RomanPayoutNotice amount="$240.00" bankLast4="4242" sentOn="June 9" mode="error" />,
    );
    expect(getByTestId('roman-payout-avatar').props.accessibilityLabel).toBe(NEUTRAL);
    expect(
      getByText('I was unable to send your payout of $240.00 just now — the bank declined the transfer instruction. Nothing is lost; I will retry and confirm once it is moving.'),
    ).toBeTruthy();
  });
});
