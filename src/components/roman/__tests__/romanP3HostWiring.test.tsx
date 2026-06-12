/**
 * romanP3HostWiring — host-surface wiring assertions for the P3 components.
 *
 * The R3 audit's P1-CODE-01 finding was that the seven P3 surface components
 * existed but were orphaned: imported by nothing, rendered nowhere. This suite
 * pins each one to a REAL production host screen, asserts it is gated behind
 * `featureFlags.romanChat` (the dedicated Roman flag, default OFF), and that it
 * is wired with real props (no demo data).
 *
 * Several host screens (ProgressScreen, WorkoutScreen, ActiveWorkoutScreen,
 * CoachEarningsScreen) pull in reanimated, expo-sqlite, charts, and full
 * navigators that are impractical to render in a unit test. Following the
 * established convention in this repo (see
 * screens/client/__tests__/ActiveWorkoutScreen.persistence.test.tsx, which
 * source-pattern-checks the screen wiring for the same reason), this suite
 * asserts the wiring at the source level. CoachBriefScreen — which renders
 * cleanly — additionally has a full render+assertion suite in
 * screens/coach/__tests__/CoachBriefScreenRoman.test.tsx.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readSrc(...rel: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...rel), 'utf8');
}

const PROGRESS = readSrc('screens', 'client', 'ProgressScreen.tsx');
const WORKOUT = readSrc('screens', 'client', 'WorkoutScreen.tsx');
const ACTIVE = readSrc('screens', 'client', 'ActiveWorkoutScreen.tsx');
const EARNINGS = readSrc('screens', 'coach', 'payments', 'CoachEarningsScreen.tsx');
const BRIEF = readSrc('screens', 'coach', 'CoachBriefScreen.tsx');

// ── §2.7 RomanStreakCard → ProgressScreen ────────────────────────────────────
describe('§2.7 RomanStreakCard is wired into ProgressScreen', () => {
  it('imports the component and the streak-tier type', () => {
    expect(PROGRESS).toContain("import RomanStreakCard from '../../components/roman/RomanStreakCard'");
    expect(PROGRESS).toContain("import type { RomanStreakTier }");
  });
  it('gates the render behind featureFlags.romanChat', () => {
    expect(PROGRESS).toMatch(/featureFlags\.romanChat && streakTier !== null/);
  });
  it('derives the tier from the real loggingStreak state (no demo data)', () => {
    expect(PROGRESS).toMatch(/loggingStreak >= 30 \? 30 : loggingStreak >= 7 \? 7 : loggingStreak >= 3 \? 3 : null/);
  });
  it('passes the real first name and selects celebration on the 7/30 tiers', () => {
    expect(PROGRESS).toContain('firstName={streakFirstName}');
    expect(PROGRESS).toContain("mode={streakTier === 3 ? 'default' : 'celebration'}");
    expect(PROGRESS).toContain('testID="roman-streak-card"');
  });
});

// ── §2.8 RomanWorkoutCompleteCard + §2.10 RomanErrorBanner → WorkoutScreen ────
describe('§2.8 RomanWorkoutCompleteCard is wired into WorkoutScreen', () => {
  it('imports the component', () => {
    expect(WORKOUT).toContain("import RomanWorkoutCompleteCard from '../../components/roman/RomanWorkoutCompleteCard'");
  });
  it('gates on featureFlags.romanChat AND a real most-recent completed session', () => {
    expect(WORKOUT).toMatch(/featureFlags\.romanChat && mostRecentCompleted/);
    expect(WORKOUT).toContain('const mostRecentCompleted = recentSessions.find((s) => s.completed)');
  });
  it('renders the default line (no fabricated PR celebration)', () => {
    expect(WORKOUT).toContain('<RomanWorkoutCompleteCard mode="default" testID="roman-workout-card" />');
  });
});

describe('§2.10 RomanErrorBanner is wired into WorkoutScreen error state', () => {
  it('imports the component', () => {
    expect(WORKOUT).toContain("import RomanErrorBanner from '../../components/roman/RomanErrorBanner'");
  });
  it('renders on the full error screen behind the Roman flag, error mode', () => {
    expect(WORKOUT).toMatch(/featureFlags\.romanChat \?\s*\(\s*<RomanErrorBanner mode="error" surface="screen"/);
  });
  it('keeps the failure visible even with the flag off (never swallowed)', () => {
    // The else-branch still renders the plain "Could not load workout data."
    expect(WORKOUT).toContain('Could not load workout data.');
  });
});

// ── §2.9 RomanVoiceLogReadback → ActiveWorkoutScreen ─────────────────────────
describe('§2.9 RomanVoiceLogReadback is wired into ActiveWorkoutScreen', () => {
  it('imports the component', () => {
    expect(ACTIVE).toContain("import RomanVoiceLogReadback from '../../components/roman/RomanVoiceLogReadback'");
  });
  it('gates on featureFlags.romanChat AND a real last-completed set', () => {
    expect(ACTIVE).toMatch(/featureFlags\.romanChat && lastCompletedSet/);
    expect(ACTIVE).toContain('const lastCompletedSet: SessionSet | null');
  });
  it('reads back the real logged weight and reps', () => {
    expect(ACTIVE).toContain('weight={lastCompletedSet.weight}');
    expect(ACTIVE).toContain('reps={lastCompletedSet.reps}');
    expect(ACTIVE).toContain('testID="roman-voicelog-card"');
  });
});

// ── §2.12 RomanPayoutNotice → CoachEarningsScreen ────────────────────────────
describe('§2.12 RomanPayoutNotice is wired into CoachEarningsScreen', () => {
  it('imports the component', () => {
    expect(EARNINGS).toContain("import RomanPayoutNotice from '../../../components/roman/RomanPayoutNotice'");
  });
  it('gates on featureFlags.romanChat AND a real last payout', () => {
    expect(EARNINGS).toMatch(/featureFlags\.romanChat &&\s*data\.lastPayoutAt &&\s*data\.lastPayoutAmountCents != null/);
  });
  it('passes the real payout amount and standard settle window', () => {
    expect(EARNINGS).toContain('amount={formatCurrencyCents(data.lastPayoutAmountCents, data.currency)}');
    expect(EARNINGS).toContain('settleDays={PAYOUT_SETTLE_DAYS}');
    expect(EARNINGS).toContain('testID="roman-payout-card"');
  });
});

// ── §2.4 RomanCheckInNotice + §2.5 RomanNewClientNotice → CoachBriefScreen ────
describe('§2.4 RomanCheckInNotice is wired into CoachBriefScreen', () => {
  it('imports the component', () => {
    expect(BRIEF).toContain("import RomanCheckInNotice from '../../components/roman/RomanCheckInNotice'");
  });
  it('derives the client from a real check_in_overdue todo and gates on the flag', () => {
    expect(BRIEF).toMatch(/featureFlags\.romanChat && checkInClient/);
    expect(BRIEF).toContain("c.todos.some((t) => t.kind === 'check_in_overdue')");
    expect(BRIEF).toContain('clientName={checkInClient.clientDisplayName}');
  });
});

describe('§2.5 RomanNewClientNotice is wired into CoachBriefScreen', () => {
  it('imports the component', () => {
    expect(BRIEF).toContain("import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice'");
  });
  it('uses real roster data and gates on the flag', () => {
    expect(BRIEF).toMatch(/featureFlags\.romanChat && newClient/);
    expect(BRIEF).toContain('clientName={newClient.clientDisplayName}');
    expect(BRIEF).toContain('clientCount={clientList.length}');
  });
});

// ── §2.3 RomanBriefCard (already wired pre-R3) stays wired ────────────────────
describe('§2.3 RomanBriefCard remains wired into CoachBriefScreen', () => {
  it('imports and renders the brief card with real props', () => {
    expect(BRIEF).toContain("import RomanBriefCard from '../../components/roman/RomanBriefCard'");
    expect(BRIEF).toContain('testID="roman-brief-card"');
  });
});
