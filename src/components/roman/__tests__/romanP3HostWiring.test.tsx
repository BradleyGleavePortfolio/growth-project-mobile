/**
 * romanP3HostWiring — host-surface wiring + TRUE-signal behaviour for the P3
 * components.
 *
 * History: the R3 audit's P1-CODE-01 finding was that the seven P3 surface
 * components existed but were orphaned (imported by nothing, rendered nowhere).
 * The R4 audit then found that five mounted surfaces were wired to
 * semantically INVALID host data (an overdue todo rendered as a submitted
 * check-in, an invented new-client heuristic, a >= streak bucket on
 * non-milestone days, a placeholder bank last-four, and a historical session
 * rendered as a just-completed event). The R5 fixer rewired each to a truthful
 * signal.
 *
 * This suite therefore has two layers:
 *   1. ORPHAN GUARD (kept from R3): static source checks that each component is
 *      still imported by its production host and gated behind
 *      `featureFlags.romanChat`. These guarantee the components do not become
 *      orphaned again.
 *   2. TRUE-SIGNAL BEHAVIOUR (R5): for each fixed surface, real render/behaviour
 *      tests asserting the TRUE-signal condition produces the event and the
 *      FALSE condition (overdue todo, established quiet client, day 8/31 streak,
 *      missing bankLast4 wording, a mere historical completed session) does NOT.
 *
 * The chart/sqlite/navigator-heavy screens (ProgressScreen, WorkoutScreen,
 * CoachEarningsScreen) are impractical to fully render in a unit test, so their
 * decision logic is exercised through exported pure selectors
 * (`streakMilestoneTier`, `selectCheckInClient`) and component renders of the
 * copy. CoachBriefScreen renders cleanly and has a full render+assertion suite
 * in screens/coach/__tests__/CoachBriefScreenRoman.test.tsx.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

import RomanCheckInNotice from '../RomanCheckInNotice';
import RomanStreakCard from '../RomanStreakCard';
import RomanWorkoutCompleteCard from '../RomanWorkoutCompleteCard';
import RomanPayoutNotice from '../RomanPayoutNotice';
import { streakMilestoneTier } from '../../../screens/client/ProgressScreen';
import { selectCheckInClient, selectNewlyOnboardedClient } from '../../../screens/coach/CoachBriefScreen';
import { romanCheckInReceived, romanStreak, romanPayout } from '../../../lib/roman/copy';
import type { CoachBriefClientCard, VerifiedProgressItem } from '../../../types/wave11';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readSrc(...rel: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...rel), 'utf8');
}

const PROGRESS = readSrc('screens', 'client', 'ProgressScreen.tsx');
const WORKOUT = readSrc('screens', 'client', 'WorkoutScreen.tsx');
const ACTIVE = readSrc('screens', 'client', 'ActiveWorkoutScreen.tsx');
const EARNINGS = readSrc('screens', 'coach', 'payments', 'CoachEarningsScreen.tsx');
const BRIEF = readSrc('screens', 'coach', 'CoachBriefScreen.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — ORPHAN GUARD (the components stay imported + flag-gated in hosts)
// ─────────────────────────────────────────────────────────────────────────────

describe('orphan guard — every P3 surface stays imported into its host, flag-gated', () => {
  it('§2.7 RomanStreakCard → ProgressScreen', () => {
    expect(PROGRESS).toContain("import RomanStreakCard from '../../components/roman/RomanStreakCard'");
    expect(PROGRESS).toContain("import type { RomanStreakTier }");
    expect(PROGRESS).toMatch(/featureFlags\.romanChat && streakTier !== null/);
    expect(PROGRESS).toContain('testID="roman-streak-card"');
  });

  it('§2.8 RomanWorkoutCompleteCard → WorkoutScreen', () => {
    expect(WORKOUT).toContain("import RomanWorkoutCompleteCard from '../../components/roman/RomanWorkoutCompleteCard'");
    expect(WORKOUT).toContain('<RomanWorkoutCompleteCard mode="default" testID="roman-workout-card" />');
  });

  it('§2.10 RomanErrorBanner → WorkoutScreen error state (kept visible flag-off)', () => {
    expect(WORKOUT).toContain("import RomanErrorBanner from '../../components/roman/RomanErrorBanner'");
    expect(WORKOUT).toMatch(/featureFlags\.romanChat \?\s*\(\s*<RomanErrorBanner mode="error" surface="screen"/);
    expect(WORKOUT).toContain('Could not load workout data.');
  });

  it('§2.9 RomanVoiceLogReadback → ActiveWorkoutScreen', () => {
    expect(ACTIVE).toContain("import RomanVoiceLogReadback from '../../components/roman/RomanVoiceLogReadback'");
    expect(ACTIVE).toMatch(/featureFlags\.romanChat && lastCompletedSet/);
    expect(ACTIVE).toContain('weight={lastCompletedSet.weight}');
    expect(ACTIVE).toContain('reps={lastCompletedSet.reps}');
  });

  it('§2.12 RomanPayoutNotice → CoachEarningsScreen', () => {
    expect(EARNINGS).toContain("import RomanPayoutNotice from '../../../components/roman/RomanPayoutNotice'");
    expect(EARNINGS).toMatch(/featureFlags\.romanChat &&\s*data\.lastPayoutAt &&\s*data\.lastPayoutAmountCents != null/);
    expect(EARNINGS).toContain('testID="roman-payout-card"');
  });

  it('§2.4 RomanCheckInNotice + §2.5 RomanNewClientNotice → CoachBriefScreen', () => {
    expect(BRIEF).toContain("import RomanCheckInNotice from '../../components/roman/RomanCheckInNotice'");
    expect(BRIEF).toContain("import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice'");
    expect(BRIEF).toMatch(/featureFlags\.romanChat && checkInClient/);
    expect(BRIEF).toMatch(/featureFlags\.romanChat && newClient/);
  });

  it('§2.3 RomanBriefCard stays wired', () => {
    expect(BRIEF).toContain("import RomanBriefCard from '../../components/roman/RomanBriefCard'");
    expect(BRIEF).toContain('testID="roman-brief-card"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — TRUE-SIGNAL BEHAVIOUR
// ─────────────────────────────────────────────────────────────────────────────

// Helpers to build real-shaped CoachBriefClientCards.
function vp(over: Partial<VerifiedProgressItem>): VerifiedProgressItem {
  return {
    id: 'vp1',
    kind: 'check_in_consistency',
    label: 'Weekly check-in',
    submittedAt: '2026-06-09T07:00:00.000Z',
    submittedBy: { id: 'u1', kind: 'client', displayName: 'Dana' },
    signoffStatus: 'pending',
    ...over,
  };
}
function card(over: Partial<CoachBriefClientCard>): CoachBriefClientCard {
  return {
    clientId: 'c1',
    clientDisplayName: 'Dana',
    aiSummary: 'summary',
    aiFlags: [],
    todos: [],
    ...over,
  };
}

// ── §2.4 check-in: pending check_in_consistency submission TRUE; overdue FALSE ─
describe('§2.4 selectCheckInClient — only a REAL submitted check-in qualifies', () => {
  it('TRUE: a client with a pending check_in_consistency submission is selected', () => {
    const c = card({ clientDisplayName: 'Dana', latestVerifiedProgress: vp({ signoffStatus: 'pending' }) });
    expect(selectCheckInClient([c])).toBe(c);
  });

  it('FALSE: a check_in_overdue todo is NOT a submitted check-in (the R4 bug)', () => {
    const overdue = card({
      clientDisplayName: 'Overdue Olive',
      todos: [{ id: 't1', kind: 'check_in_overdue', label: 'Check-in overdue' }],
    });
    expect(selectCheckInClient([overdue])).toBeUndefined();
  });

  it('FALSE: an already-approved check-in is no longer "submitted, awaiting review"', () => {
    const approved = card({ latestVerifiedProgress: vp({ signoffStatus: 'coach_approved' }) });
    expect(selectCheckInClient([approved])).toBeUndefined();
  });

  it('FALSE: a pending submission of another kind is not a check-in', () => {
    const otherKind = card({ latestVerifiedProgress: vp({ kind: 'net_worth_milestone', signoffStatus: 'pending' }) });
    expect(selectCheckInClient([otherKind])).toBeUndefined();
  });

  it('the §2.4 default copy renders the submitted-check-in line for the selected client', () => {
    const { getByText } = render(<RomanCheckInNotice clientName="Dana" mode="default" />);
    expect(getByText('Dana has submitted a check-in. I have placed it at the top of your queue.')).toBeTruthy();
    // The copy asserts submission — never an overdue/missing framing.
    expect(romanCheckInReceived({ clientName: 'Dana', mode: 'default' })).not.toMatch(/overdue|missing|chase/i);
  });
});

// ── §2.5 new client: no truthful signal ⇒ surface gated OFF (renders null) ────
describe('§2.5 new-client notice is gated OFF until a real onboarding signal exists', () => {
  it('FALSE: selectNewlyOnboardedClient returns undefined for every roster (no invented event)', () => {
    expect(selectNewlyOnboardedClient(undefined)).toBeUndefined();
    expect(selectNewlyOnboardedClient([])).toBeUndefined();
    // A single quiet client — the exact R4-flagged heuristic input — must NOT
    // be treated as a new onboarding event.
    const quietSingle = card({ todos: [], aiFlags: [] });
    expect(selectNewlyOnboardedClient([quietSingle])).toBeUndefined();
  });

  it('the R4-flagged shape heuristic is removed from the host', () => {
    expect(BRIEF).not.toContain('clientList[0].todos.length === 0');
    expect(BRIEF).not.toContain('clientList[0].aiFlags.length === 0');
  });

  it('component + host wiring remain compiled and flag-gated (no re-orphaning)', () => {
    expect(BRIEF).toContain("import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice'");
    expect(BRIEF).toMatch(/featureFlags\.romanChat && newClient/);
    expect(BRIEF).toContain('clientName={newClient.clientDisplayName}');
  });
});

// ── §2.7 streak: milestone fires on EXACT day only ───────────────────────────
describe('§2.7 streakMilestoneTier — milestone copy on exact days only', () => {
  it('TRUE: exact milestone days return their tier', () => {
    expect(streakMilestoneTier(3)).toBe(3);
    expect(streakMilestoneTier(7)).toBe(7);
    expect(streakMilestoneTier(30)).toBe(30);
  });

  it('FALSE: non-milestone days return null (no card, no bucketed copy)', () => {
    for (const day of [0, 1, 2, 4, 6, 8, 15, 29, 31, 45, 100]) {
      expect(streakMilestoneTier(day)).toBeNull();
    }
  });

  it('day 8 does NOT render the "Seven days" line (the R4 bug)', () => {
    expect(streakMilestoneTier(8)).toBeNull();
    // And the 7-day copy itself is reserved for the exact-7 tier.
    expect(romanStreak({ tier: 7, firstName: 'Sam', mode: 'celebration' })).toContain('Seven days unbroken');
  });

  it('day 31 does NOT render the "Thirty days" line; the one exclamation stays on day 30', () => {
    expect(streakMilestoneTier(31)).toBeNull();
    const thirty = romanStreak({ tier: 30, firstName: 'Sam', mode: 'celebration' });
    expect(thirty).toContain('Thirty days');
    expect((thirty.match(/!/g) ?? []).length).toBe(1);
  });

  it('the exact-day tiers render the spec lines', () => {
    const { getByText } = render(<RomanStreakCard tier={3} firstName="Sam" mode="default" />);
    expect(getByText('Three days running. A streak is just consistency that has been counting. Keep it.')).toBeTruthy();
  });
});

// ── §2.8 workout-complete: one-shot just-completed signal, not historical ─────
describe('§2.8 workout-complete renders from a real just-completed event only', () => {
  it('the host derives visibility from the one-shot justCompleted signal, NOT a historical session', () => {
    // TRUE-condition wiring: render gated on showWorkoutComplete (= justCompleted).
    expect(WORKOUT).toContain('const showWorkoutComplete = justCompleted;');
    expect(WORKOUT).toMatch(/featureFlags\.romanChat && showWorkoutComplete/);
    // FALSE-condition removed: the old "any recent completed session" wiring is gone.
    expect(WORKOUT).not.toContain('const mostRecentCompleted = recentSessions.find((s) => s.completed)');
    expect(WORKOUT).not.toMatch(/featureFlags\.romanChat && mostRecentCompleted/);
  });

  it('the one-shot param is consumed once then cleared (no re-fire on refocus/refresh)', () => {
    expect(WORKOUT).toContain('if (route.params?.justCompleted)');
    expect(WORKOUT).toContain('setJustCompleted(true)');
    expect(WORKOUT).toContain('navigation.setParams({ justCompleted: undefined })');
  });

  it('the finish-workout path sets the signal on a successful save', () => {
    expect(ACTIVE).toContain("navigation.navigate('WorkoutMain', { justCompleted: true })");
  });

  it('the §2.8 default line renders without fabricating a PR celebration', () => {
    const { getByText } = render(<RomanWorkoutCompleteCard mode="default" />);
    expect(getByText('Workout complete. Recorded. That is one more behind you.')).toBeTruthy();
  });
});

// ── §2.12 payout: no placeholder bank last-four token ─────────────────────────
describe('§2.12 payout omits the destination-account clause when last-four is unavailable', () => {
  it('the host no longer ships a placeholder bank-last-four token', () => {
    expect(EARNINGS).not.toContain('PAYOUT_BANK_LAST4_UNKNOWN');
    expect(EARNINGS).not.toContain('bankLast4={');
  });

  it('TRUE: with no bankLast4, the copy states amount + settle window, no account token', () => {
    const { getByText, queryByText } = render(
      <RomanPayoutNotice amount="$240.00" settleDays={2} mode="default" testID="payout" />,
    );
    expect(
      getByText('Your payout of $240.00 is on its way. Funds typically settle within 2 business days.'),
    ).toBeTruthy();
    expect(queryByText(/account ending/)).toBeNull();
  });

  it('FALSE: a placeholder em-dash token never appears in the rendered line', () => {
    const line = romanPayout({ amount: '$240.00', settleDays: 2, mode: 'default' });
    expect(line).not.toContain('\u2014\u2014\u2014\u2014');
    expect(line).not.toContain('ending undefined');
  });

  it('when a REAL last-four is supplied, the account clause is restored', () => {
    expect(romanPayout({ amount: '$240.00', bankLast4: '4242', settleDays: 2, mode: 'default' })).toContain(
      'account ending 4242',
    );
  });
});
