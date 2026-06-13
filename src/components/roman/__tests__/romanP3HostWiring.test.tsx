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
 * (`streakMilestoneTier`, `selectPendingCheckInClaim`) and component renders of the
 * copy. CoachBriefScreen renders cleanly and has a full render+assertion suite
 * in screens/coach/__tests__/CoachBriefScreenRoman.test.tsx.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';

// §2.8 behaviour test (Fix #5): drive the REAL extracted one-shot hook through
// a focus/blur lifecycle. useFocusEffect is replaced with a controllable focus
// manager that stores the latest effect and lets the test trigger focus (run
// the effect, capturing its cleanup) and blur (run the cleanup). This is the
// genuine react-navigation contract (cleanup runs on blur), so the test fails
// if Fix #4's blur cleanup is reverted.
const focusController: {
  effect: null | (() => undefined | (() => void));
  cleanup: null | (() => void);
} = { effect: null, cleanup: null };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      focusController.effect = cb;
    },
  };
});

import RomanCheckInNotice from '../RomanCheckInNotice';
import RomanStreakCard from '../RomanStreakCard';
import RomanWorkoutCompleteCard from '../RomanWorkoutCompleteCard';
import RomanPayoutNotice from '../RomanPayoutNotice';
import { streakMilestoneTier } from '../../../screens/client/ProgressScreen';
import { selectPendingCheckInClaim, selectNewlyOnboardedClient } from '../../../screens/coach/CoachBriefScreen';
import { useJustCompletedOneShot } from '../../../screens/client/WorkoutScreen';
import { romanCheckInClaim, romanStreak, romanPayout } from '../../../lib/roman/copy';
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
    // P1-B-02: the §2.7 card is now additionally gated behind the
    // backend-authority flag romanStreakBackendLive (the streak tier is a
    // client-side recompute, not an authoritative backend milestone), so the
    // card stays hidden until the backend exposes a real milestone event.
    expect(PROGRESS).toMatch(
      /featureFlags\.romanChat && featureFlags\.romanStreakBackendLive && streakTier !== null/,
    );
    expect(PROGRESS).toContain('testID="roman-streak-card"');
    expect(PROGRESS).toContain('Follow-up (roman-streak-backend)');
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
    expect(EARNINGS).toMatch(/featureFlags\.romanChat &&\s*data\.lastPayoutAmountCents != null &&\s*formatDate\(data\.lastPayoutAt\)/);
    expect(EARNINGS).toContain('testID="roman-payout-card"');
  });

  it('§2.4 RomanCheckInNotice + §2.5 RomanNewClientNotice → CoachBriefScreen', () => {
    expect(BRIEF).toContain("import RomanCheckInNotice from '../../components/roman/RomanCheckInNotice'");
    expect(BRIEF).toContain("import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice'");
    // P1-BF-01: the §2.4 check-in notice is now additionally gated behind the
    // backend-authority flag romanCheckInBackendLive (the host derives the
    // notice from a mobile-only Wave 11 scaffold that backend `main` does not
    // return), so the surface stays hidden until the authoritative field ships.
    expect(BRIEF).toMatch(
      /featureFlags\.romanChat && featureFlags\.romanCheckInBackendLive && checkInClient/,
    );
    expect(BRIEF).toMatch(/featureFlags\.romanChat && newClient/);
  });

  it('§2.3 RomanBriefCard stays wired, behind romanChat with a non-Roman fallback', () => {
    expect(BRIEF).toContain("import RomanBriefCard from '../../components/roman/RomanBriefCard'");
    expect(BRIEF).toContain('testID="roman-brief-card"');
    // P1-G-01: the brief card is gated behind featureFlags.romanChat with a
    // non-Roman fallback header rendered when the flag is OFF, so a build with
    // coachBrief=true and romanChat=false never mounts Roman.
    expect(BRIEF).toMatch(/featureFlags\.romanChat \?/);
    expect(BRIEF).toContain('CoachBriefHeaderFallback');
    expect(BRIEF).toContain('testID="coach-brief-header-fallback"');
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

// ── §2.4 check-in: pending check_in_consistency claim TRUE; overdue FALSE ────
describe('§2.4 selectPendingCheckInClaim — only a REAL pending claim qualifies', () => {
  it('TRUE: a client with a pending check_in_consistency claim is selected', () => {
    const c = card({ clientDisplayName: 'Dana', latestVerifiedProgress: vp({ signoffStatus: 'pending' }) });
    expect(selectPendingCheckInClaim([c])).toBe(c);
  });

  it('FALSE: a check_in_overdue todo is NOT a pending claim (the R4 bug)', () => {
    const overdue = card({
      clientDisplayName: 'Overdue Olive',
      todos: [{ id: 't1', kind: 'check_in_overdue', label: 'Check-in overdue' }],
    });
    expect(selectPendingCheckInClaim([overdue])).toBeUndefined();
  });

  it('FALSE: an already-approved claim is no longer "submitted, awaiting review"', () => {
    const approved = card({ latestVerifiedProgress: vp({ signoffStatus: 'coach_approved' }) });
    expect(selectPendingCheckInClaim([approved])).toBeUndefined();
  });

  it('FALSE: a pending claim of another kind is not a check-in-consistency claim', () => {
    const otherKind = card({ latestVerifiedProgress: vp({ kind: 'net_worth_milestone', signoffStatus: 'pending' }) });
    expect(selectPendingCheckInClaim([otherKind])).toBeUndefined();
  });

  it('the §2.4 default copy renders the pending-claim line for the selected client', () => {
    const { getByText } = render(<RomanCheckInNotice clientName="Dana" mode="default" />);
    expect(getByText('Dana has a check-in consistency claim awaiting your sign-off.')).toBeTruthy();
    // The copy asserts only a pending claim — never a form arrival, queue
    // reorder, or overdue/missing framing the host signal cannot prove.
    expect(romanCheckInClaim({ clientName: 'Dana', mode: 'default' })).not.toMatch(/overdue|missing|chase|queue|placed it/i);
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

// Harness that exercises the REAL useJustCompletedOneShot hook through a
// focus/blur lifecycle via the controllable useFocusEffect mock above.
//
// P1-C-01: the hook now takes a durable completion id + a user key and latches
// consumed ids in AsyncStorage, so its focus path is ASYNC (it reads the latch
// before deciding to show the card). The harness focus() is therefore async
// and flushes the AsyncStorage microtasks before the assertion reads the flag.
import AsyncStorage from '@react-native-async-storage/async-storage';

async function flush() {
  // Let the AsyncStorage get/set promise chain settle and the resulting state
  // update commit.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderOneShotHarness({
  justCompletedId,
  userKey = 'user-1',
}: {
  justCompletedId: string | undefined;
  userKey?: string | undefined;
}) {
  const clearParam = jest.fn();
  let id = justCompletedId;
  let key = userKey;
  focusController.effect = null;
  focusController.cleanup = null;
  const rendered = renderHook(() => useJustCompletedOneShot(id, key, clearParam));
  return {
    clearParam,
    setParam(nextId: string | undefined, nextKey: string | undefined = key) {
      id = nextId;
      key = nextKey;
      act(() => rendered.rerender(undefined));
    },
    async focus() {
      // react-navigation runs the focus effect on focus and stores its cleanup.
      const cleanup = focusController.effect ? focusController.effect() : undefined;
      focusController.cleanup = typeof cleanup === 'function' ? cleanup : null;
      // Flush the async latch read/write so the flag reflects the decision.
      await flush();
    },
    blur() {
      // On blur react-navigation invokes the cleanup returned by the effect.
      if (focusController.cleanup) focusController.cleanup();
      focusController.cleanup = null;
    },
    lastShow() {
      return rendered.result.current;
    },
  };
}

// ── §2.8 workout-complete: one-shot just-completed signal, not historical ─────
describe('§2.8 workout-complete renders from a real just-completed event only', () => {
  beforeEach(async () => {
    // P1-C-01: the one-shot now latches consumed completion ids in
    // AsyncStorage. Clear it between tests so a latch written by one test does
    // not suppress the card in the next.
    await AsyncStorage.clear();
  });

  it('the host derives visibility from the one-shot justCompleted signal, NOT a historical session', () => {
    // TRUE-condition wiring: render gated on showWorkoutComplete (= justCompleted).
    expect(WORKOUT).toContain('const showWorkoutComplete = justCompleted;');
    expect(WORKOUT).toMatch(/featureFlags\.romanChat && showWorkoutComplete/);
    // FALSE-condition removed: the old "any recent completed session" wiring is gone.
    expect(WORKOUT).not.toContain('const mostRecentCompleted = recentSessions.find((s) => s.completed)');
    expect(WORKOUT).not.toMatch(/featureFlags\.romanChat && mostRecentCompleted/);
  });

  it('BEHAVIOUR: the card shows for exactly one focus session and not on a later refocus', async () => {
    // Drive the REAL extracted one-shot hook (useJustCompletedOneShot) through
    // a focus/blur lifecycle. useFocusEffect is mocked to a controllable focus
    // manager so we can simulate: completion-focus -> blur -> refocus (no new
    // completion id). This test FAILS if the blur cleanup is reverted (the
    // flag would stay true and the card would re-render on refocus).
    const harness = renderOneShotHarness({ justCompletedId: 'workout-101' });
    // First focus after a genuine completion: card shows.
    await harness.focus();
    expect(harness.lastShow()).toBe(true);
    // The param was consumed (cleared) on focus so it cannot re-fire.
    expect(harness.clearParam).toHaveBeenCalledTimes(1);
    // Blur, then refocus WITHOUT a new completion id: card must NOT show.
    act(() => harness.blur());
    harness.setParam(undefined);
    await harness.focus();
    expect(harness.lastShow()).toBe(false);
  });

  it('BEHAVIOUR: a genuine new completion (new id) on a later focus shows the card again', async () => {
    const harness = renderOneShotHarness({ justCompletedId: 'workout-101' });
    await harness.focus();
    expect(harness.lastShow()).toBe(true);
    act(() => harness.blur());
    // A NEW finish-workout save sets a DIFFERENT id before refocus.
    harness.setParam('workout-202');
    await harness.focus();
    expect(harness.lastShow()).toBe(true);
  });

  it('BEHAVIOUR: re-delivering the SAME id (e.g. a remount) does NOT re-fire the card (P1-C-01)', async () => {
    // The durable AsyncStorage latch is the point of P1-C-01: once an id has
    // been acknowledged, the same id arriving again — a remount, a
    // back-then-forward, or a param surviving a process reload — must not show
    // the card a second time.
    const first = renderOneShotHarness({ justCompletedId: 'workout-101' });
    await first.focus();
    expect(first.lastShow()).toBe(true);
    act(() => first.blur());
    // A fresh mount (new hook instance) is handed the SAME id again.
    const second = renderOneShotHarness({ justCompletedId: 'workout-101' });
    await second.focus();
    expect(second.lastShow()).toBe(false);
  });

  it('BEHAVIOUR: a latch for one user does not suppress the SAME id for another user', async () => {
    const userA = renderOneShotHarness({ justCompletedId: 'workout-101', userKey: 'user-A' });
    await userA.focus();
    expect(userA.lastShow()).toBe(true);
    act(() => userA.blur());
    // A different account on the same device with the same workout id: the
    // latch is scoped per user, so this still fires.
    const userB = renderOneShotHarness({ justCompletedId: 'workout-101', userKey: 'user-B' });
    await userB.focus();
    expect(userB.lastShow()).toBe(true);
  });

  it('the finish-workout path sets the durable completion id on a successful save', () => {
    // ActiveWorkoutScreen navigates with the durable server id (P1-C-01), not a
    // transient boolean; when no usable id exists it navigates without the
    // signal rather than fabricate one.
    expect(ACTIVE).toMatch(/justCompletedId: serverId/);
    expect(ACTIVE).not.toContain('{ justCompleted: true }');
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

  it('TRUE: with no bankLast4, the past-tense copy states amount + send date, no account token', () => {
    const { getByText, queryByText } = render(
      <RomanPayoutNotice amount="$240.00" sentOn="June 9" mode="default" testID="payout" />,
    );
    expect(
      getByText('Your last payout of $240.00 was sent on June 9.'),
    ).toBeTruthy();
    expect(queryByText(/account ending/)).toBeNull();
  });

  it('FALSE: a placeholder em-dash token never appears in the rendered line', () => {
    const line = romanPayout({ amount: '$240.00', sentOn: 'June 9', mode: 'default' });
    expect(line).not.toContain('\u2014\u2014\u2014\u2014');
    expect(line).not.toContain('ending undefined');
  });

  it('the payout copy is past tense (historical lastPayoutAt), never in-transit', () => {
    const line = romanPayout({ amount: '$240.00', sentOn: 'June 9', mode: 'default' });
    expect(line).toContain('was sent on June 9');
    expect(line).not.toMatch(/on its way|settle within|in transit/i);
  });

  it('when a REAL last-four is supplied, the account clause is restored', () => {
    expect(romanPayout({ amount: '$240.00', bankLast4: '4242', sentOn: 'June 9', mode: 'default' })).toContain(
      'account ending 4242',
    );
  });
});
