/**
 * Day-1 onboarding flow — static contract guarantees.
 *
 * The Lean-onboarding test file in this repo took the static-grep approach
 * instead of mounting React Native components (mounting forces in
 * reanimated/navigation native modules under Jest, which the worklets init
 * does not love). We follow the same pattern: read the source as text and
 * assert the structural contracts that decide whether the flow:
 *
 *   - renders the right screens in the right order
 *   - persists each step to the backend on advance
 *   - degrades gracefully when something fails
 *   - has the a11y / i18n / motion guarantees the spec calls for
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
}

const NAV = read('navigation/Day1OnboardingNavigator.tsx');
const WELCOME = read('screens/day-one/WelcomeScreen.tsx');
const PAIR = read('screens/day-one/CoachPairingScreen.tsx');
const GOALS = read('screens/day-one/GoalsScreen.tsx');
const NOTIF = read('screens/day-one/NotificationsScreen.tsx');
const CHECKIN = read('screens/day-one/CheckInTimeScreen.tsx');
const READY = read('screens/day-one/ReadyScreen.tsx');
const HEADER = read('screens/day-one/StepHeader.tsx');
const API = read('screens/day-one/api.ts');
const STRINGS = JSON.parse(read('screens/day-one/i18n/en.json'));

// ─── Navigator wiring ────────────────────────────────────────────────────────

describe('Day1OnboardingNavigator', () => {
  it('declares all six screens in the param list', () => {
    const block = NAV.match(/Day1OnboardingParamList\s*=\s*\{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/Welcome:\s*undefined/);
    expect(body).toMatch(/CoachPairing:.*prefillCode/);
    expect(body).toMatch(/Goals:\s*undefined/);
    expect(body).toMatch(/Notifications:\s*undefined/);
    expect(body).toMatch(/CheckInTime:\s*undefined/);
    expect(body).toMatch(/Ready:\s*undefined/);
  });

  it('registers all six screens as Stack.Screen entries', () => {
    for (const name of ['Welcome', 'CoachPairing', 'Goals', 'Notifications', 'CheckInTime', 'Ready']) {
      expect(NAV).toMatch(new RegExp(`Stack\\.Screen\\s+name=["']${name}["']`));
    }
  });

  it('disables back-gesture so users cannot swipe-out mid-flow', () => {
    expect(NAV).toMatch(/gestureEnabled:\s*false/);
  });
});

// ─── Screen-by-screen render guarantees ─────────────────────────────────────

describe('Welcome screen', () => {
  it('greets the user by first name when the profile cache resolves', () => {
    expect(WELCOME).toMatch(/welcome\.greetingWithName/);
    expect(WELCOME).toMatch(/welcome\.greetingFallback/);
    expect(WELCOME).toMatch(/useCurrentUser\(\)/);
  });

  it('navigates to CoachPairing on CTA tap', () => {
    expect(WELCOME).toMatch(/navigation\.navigate\(['"]CoachPairing['"]\)/);
  });

  it('respects Reduce Motion (snaps animation to final state)', () => {
    expect(WELCOME).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
  });

  it('marks the wordmark with an a11y label so VoiceOver reads "TGP logo"', () => {
    expect(WELCOME).toMatch(/welcome\.logoA11y/);
    expect(WELCOME).toMatch(/accessibilityLabel=\{t\(['"]welcome\.logoA11y['"]\)\}/);
  });
});

describe('CoachPairing screen', () => {
  it('prefills the input from route.params.prefillCode', () => {
    expect(PAIR).toMatch(/route\.params\?\.prefillCode/);
  });

  it('hides the skip button when arriving via deep link', () => {
    expect(PAIR).toMatch(/fromDeepLink\s*=\s*!!prefillCode/);
    expect(PAIR).toMatch(/!fromDeepLink\s*\?/);
  });

  it('posts to the backend before advancing', () => {
    expect(PAIR).toMatch(/await\s+pairWithCoach\(/);
    expect(PAIR).toMatch(/navigation\.navigate\(['"]Goals['"]\)/);
  });

  it('maps invite errors to structured copy (Rule 9 — no raw axios strings)', () => {
    // All four invite error kinds the api module classifies must have a copy mapping
    expect(PAIR).toMatch(/invite_expired/);
    expect(PAIR).toMatch(/invite_max_uses/);
    expect(PAIR).toMatch(/coachPairing\.errors\.notRecognized/);
    expect(PAIR).toMatch(/coachPairing\.errors\.network/);
  });

  it('rejects too-short codes inline without hitting the backend', () => {
    expect(PAIR).toMatch(/trimmed\.length\s*<\s*4/);
    expect(PAIR).toMatch(/coachPairing\.errors\.tooShort/);
  });

  it('stashes the code via writePendingInviteCode so a retry can pick it up', () => {
    expect(PAIR).toMatch(/writePendingInviteCode\(trimmed\)/);
  });
});

describe('Goals screen', () => {
  it('renders all six goal categories the spec calls out', () => {
    for (const k of ['fitness', 'business', 'personal_growth', 'relationships', 'mental_health', 'custom']) {
      expect(GOALS).toMatch(new RegExp(`['"]${k}['"]`));
    }
  });

  it('supports multi-select via a Set toggle', () => {
    expect(GOALS).toMatch(/new Set\(\)/);
    expect(GOALS).toMatch(/\.has\(k\)/);
  });

  it('persists chosen goals via saveGoals before advancing', () => {
    expect(GOALS).toMatch(/await\s+saveGoals\(chosen\)/);
    expect(GOALS).toMatch(/navigation\.navigate\(['"]Notifications['"]\)/);
  });

  it('renders a structured retry banner instead of an Alert on network failure', () => {
    expect(GOALS).toMatch(/setRetryError\(true\)/);
    expect(GOALS).toMatch(/common\.saveFailed\.title/);
    expect(GOALS).not.toMatch(/Alert\.alert/);
  });

  it('exposes a Skip option (the spec carves goals out as skip-eligible)', () => {
    expect(GOALS).toMatch(/handleSkip/);
    expect(GOALS).toMatch(/goals\.skip/);
  });
});

describe('Notifications screen', () => {
  it('requests permission via registerForPushNotifications', () => {
    expect(NOTIF).toMatch(/registerForPushNotifications\(\)/);
  });

  it('does NOT block onboarding when permission is denied', () => {
    // Both "denied" and "skipped" must still navigate to CheckInTime
    expect(NOTIF).toMatch(/navigate\(['"]CheckInTime['"]\)/);
    expect(NOTIF).toMatch(/handleContinueAfterDeny/);
  });

  it('records the permission outcome on the backend (granted/denied/skipped)', () => {
    // Outcomes are persisted via a recordOutcome() wrapper that calls
    // saveNotifPermission(state). Assert each call site emits the
    // matching state literal.
    expect(NOTIF).toMatch(/saveNotifPermission/);
    expect(NOTIF).toMatch(/recordOutcome\(['"]granted['"]\)/);
    expect(NOTIF).toMatch(/recordOutcome\(['"]denied['"]\)/);
    expect(NOTIF).toMatch(/recordOutcome\(['"]skipped['"]\)/);
  });

  it('shows a polite "you can enable later" notice when denied', () => {
    expect(NOTIF).toMatch(/notifications\.deniedNotice/);
  });
});

describe('CheckInTime screen', () => {
  it('defaults to 9:00 AM local', () => {
    expect(CHECKIN).toMatch(/DEFAULT_HOUR_24\s*=\s*9/);
  });

  it('saves the time via saveCheckInTime before advancing', () => {
    expect(CHECKIN).toMatch(/await\s+saveCheckInTime\(\{\s*hour:\s*h24,\s*minute\s*\}\)/);
    expect(CHECKIN).toMatch(/navigation\.navigate\(['"]Ready['"]\)/);
  });

  it('skip path is allowed (spec carve-out)', () => {
    expect(CHECKIN).toMatch(/handleSkip/);
  });

  it('renders a retry banner on save failure (no Alert)', () => {
    expect(CHECKIN).toMatch(/setRetryError\(true\)/);
    expect(CHECKIN).not.toMatch(/Alert\.alert/);
  });
});

describe('Ready screen', () => {
  it('owns the terminal completeDayOne call + authEvents emit', () => {
    expect(READY).toMatch(/await\s+completeDayOne\(\)/);
    expect(READY).toMatch(/authEvents\.emit\(\)/);
  });

  it('respects Reduce Motion (snaps the fade animation to its final state)', () => {
    expect(READY).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(READY).toMatch(/opacity\.setValue\(1\)/);
  });

  it('honors the quiet-luxury doctrine: no celebration chrome', () => {
    // The repo-wide doctrine spec (src/__tests__/quietLuxuryDoctrine.test.ts)
    // already enforces no confetti / no trophy chrome across src/screens.
    // We add a smaller targeted assertion here: no spring / sequence /
    // particle-burst animation primitives that would only ever exist for
    // a celebration moment. (Strip comments before scanning so the header
    // explainer doesn't trip the match.)
    const stripped = READY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(stripped).not.toMatch(/Animated\.spring|Animated\.sequence|Animated\.stagger/);
  });

  it('greets by first name when available', () => {
    expect(READY).toMatch(/ready\.title/);
    expect(READY).toMatch(/ready\.titleFallback/);
  });

  it('shows a retry banner if the final POST fails (no Alert)', () => {
    expect(READY).toMatch(/setRetryError\(true\)/);
    expect(READY).not.toMatch(/Alert\.alert/);
  });
});

// ─── Step header / progress bar ─────────────────────────────────────────────

describe('StepHeader', () => {
  it('honors the 5-step total the progress bar advertises', () => {
    expect(HEADER).toMatch(/DAY_ONE_TOTAL_STEPS\s*=\s*5/);
  });

  it('announces position via accessibilityLabel', () => {
    expect(HEADER).toMatch(/common\.progressLabel/);
  });

  it('snaps animation when Reduce Motion is enabled', () => {
    expect(HEADER).toMatch(/if \(reduceMotion\)/);
    expect(HEADER).toMatch(/progress\.setValue\(target\)/);
  });
});

// ─── Persistence layer (retry/backoff + structured errors) ──────────────────

describe('Day-1 API persistence module', () => {
  it('classifies invite errors into structured kinds', () => {
    expect(API).toMatch(/invite_expired/);
    expect(API).toMatch(/invite_max_uses/);
    expect(API).toMatch(/invite_invalid/);
    expect(API).toMatch(/network/);
    expect(API).toMatch(/server/);
  });

  it('uses exponential backoff with jitter for transient failures', () => {
    expect(API).toMatch(/withRetry/);
    expect(API).toMatch(/400\s*\*\s*2\s*\*\*\s*i/);
    expect(API).toMatch(/Math\.random\(\)\s*\*\s*200/);
  });

  it('never retries 4xx (the user has to act, not the network)', () => {
    expect(API).toMatch(/status\s*>=\s*400 && status\s*<\s*500/);
  });

  it('persists each step immediately on advance (Rule 6 — no kicking the can)', () => {
    expect(API).toMatch(/saveGoals/);
    expect(API).toMatch(/saveNotifPermission/);
    expect(API).toMatch(/saveCheckInTime/);
    expect(API).toMatch(/completeDayOne/);
    expect(API).toMatch(/pairWithCoach/);
  });
});

// ─── i18n contract ───────────────────────────────────────────────────────────

describe('Day-1 i18n bundle', () => {
  it('has copy for every screen the navigator declares', () => {
    expect(STRINGS.welcome.cta).toBeTruthy();
    expect(STRINGS.coachPairing.title).toBeTruthy();
    expect(STRINGS.goals.title).toBeTruthy();
    expect(STRINGS.notifications.title).toBeTruthy();
    expect(STRINGS.checkInTime.title).toBeTruthy();
    expect(STRINGS.ready.cta).toBeTruthy();
  });

  it('has structured invite error copy (no raw status codes)', () => {
    expect(STRINGS.coachPairing.errors.notRecognized).toMatch(/double-check/);
    expect(STRINGS.coachPairing.errors.expired).toMatch(/expired/);
    expect(STRINGS.coachPairing.errors.maxUses).toMatch(/used/);
    expect(STRINGS.coachPairing.errors.network).toMatch(/connection/);
  });

  it('has a structured "couldn\'t save your progress — retry" message (Rule 9)', () => {
    expect(STRINGS.common.saveFailed.title).toMatch(/Couldn't save/);
    expect(STRINGS.common.saveFailed.cta).toBe('Retry');
  });

  it('has bullets array for the notification value-prop screen', () => {
    expect(Array.isArray(STRINGS.notifications.bullets)).toBe(true);
    expect(STRINGS.notifications.bullets.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── A11y contract — every CTA has an accessibilityLabel ────────────────────

describe('Accessibility labels are present on every CTA', () => {
  const screens = { WELCOME, PAIR, GOALS, NOTIF, CHECKIN, READY };
  for (const [name, src] of Object.entries(screens)) {
    it(`${name} has at least one accessibilityRole="button" with accessibilityLabel`, () => {
      const buttonMatches = src.match(/accessibilityRole="button"/g) ?? [];
      const labelMatches = src.match(/accessibilityLabel=/g) ?? [];
      expect(buttonMatches.length).toBeGreaterThan(0);
      // Every screen has at least as many labels as it has button roles —
      // we don't try to pair them 1:1 across the parser, but the count
      // floor catches a CTA that ships with no a11y label.
      expect(labelMatches.length).toBeGreaterThanOrEqual(buttonMatches.length);
    });
  }
});

// ─── No raw `any` / no @ts-ignore in any Day-1 file ─────────────────────────

describe('Quality bar — no any, no @ts-ignore in Day-1 sources', () => {
  const allSrc = [WELCOME, PAIR, GOALS, NOTIF, CHECKIN, READY, HEADER, API, NAV];
  it('contains no `: any` annotations', () => {
    for (const src of allSrc) {
      expect(src).not.toMatch(/:\s*any[\s,;)\]]/);
    }
  });
  it('contains no @ts-ignore directives', () => {
    for (const src of allSrc) {
      expect(src).not.toMatch(/@ts-ignore/);
    }
  });
});

// ─── Back navigation is wired on every step except Welcome ──────────────────

describe('Back navigation is wired on every step except Welcome', () => {
  it('Welcome has no back button (it is the cover)', () => {
    expect(WELCOME).toMatch(/<StepHeader step=\{0\}/);
  });
  it.each([
    ['CoachPairing', PAIR],
    ['Goals', GOALS],
    ['Notifications', NOTIF],
    ['CheckInTime', CHECKIN],
  ])('%s passes navigation.goBack to StepHeader', (_name, src) => {
    expect(src).toMatch(/onBack=\{\(\)\s*=>\s*navigation\.goBack\(\)\}/);
  });
});
