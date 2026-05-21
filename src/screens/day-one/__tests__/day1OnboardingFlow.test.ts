/**
 * Day-1 onboarding flow — structural / contract guarantees.
 *
 * The render-based interaction tests live alongside this file (see
 * day1OnboardingScreens.test.tsx and day1OnboardingRouting.test.tsx). This
 * file keeps a tight set of static contracts that are cheaper to assert
 * at the source level than to drive through a render: navigator wiring,
 * persistence-module shape, the i18n bundle keys, and the no-`any` /
 * no-`@ts-ignore` quality bar.
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
const RESUME = read('screens/day-one/resume.ts');
const STRINGS = JSON.parse(read('screens/day-one/i18n/en.json'));

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
      expect(NAV).toMatch(new RegExp(`Stack\\.Screen[\\s\\S]*?name=["']${name}["']`));
    }
  });

  it('disables back-gesture so users cannot swipe-out mid-flow', () => {
    expect(NAV).toMatch(/gestureEnabled:\s*false/);
  });

  it('jumps initial route to a saved resume step', () => {
    expect(NAV).toMatch(/readResumeState/);
    expect(NAV).toMatch(/initialRouteName=\{initialRoute\}/);
  });
});

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

  it('captures and persists the device IANA timezone with the check-in time', () => {
    expect(API).toMatch(/getDeviceTimezone/);
    expect(API).toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
    expect(API).toMatch(/daily_checkin_timezone/);
  });
});

describe('Day-1 resume / offline module', () => {
  it('exports the resume + offline-queue surface', () => {
    expect(RESUME).toMatch(/readResumeState/);
    expect(RESUME).toMatch(/writeResumeState/);
    expect(RESUME).toMatch(/clearResumeState/);
    expect(RESUME).toMatch(/enqueuePending/);
    expect(RESUME).toMatch(/flushPendingSync/);
  });

  it('keys the AsyncStorage record under a versioned key', () => {
    expect(RESUME).toMatch(/day_one_onboarding_state_v1/);
  });
});

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
    expect(STRINGS.coachPairing.errors.notRecognized).toMatch(/[Dd]ouble-check/);
    expect(STRINGS.coachPairing.errors.expired).toMatch(/expired/);
    expect(STRINGS.coachPairing.errors.maxUses).toMatch(/used/);
    expect(STRINGS.coachPairing.errors.network).toMatch(/connection/);
  });

  it('has a structured "couldn\'t save your progress" message + Continue offline (Rule 9)', () => {
    expect(STRINGS.common.saveFailed.title).toMatch(/Couldn't save/);
    expect(STRINGS.common.saveFailed.cta).toBe('Retry');
    expect(STRINGS.common.saveLater).toMatch(/offline/);
  });

  it('has bullets array for the notification value-prop screen', () => {
    expect(Array.isArray(STRINGS.notifications.bullets)).toBe(true);
    expect(STRINGS.notifications.bullets.length).toBeGreaterThanOrEqual(3);
  });

  it('honors the quiet-luxury doctrine: no em-dashes in UI copy', () => {
    const flat = JSON.stringify(STRINGS);
    expect(flat).not.toMatch(/—/);
  });
});

describe('Quality bar — no any, no @ts-ignore in Day-1 sources', () => {
  const allSrc = [WELCOME, PAIR, GOALS, NOTIF, CHECKIN, READY, HEADER, API, NAV, RESUME];
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
  it('contains no incomplete-work markers', () => {
    // Word boundaries around the three forbidden tokens — see doctrine §2.
    const forbidden = new RegExp(`\\b(?:${['TO', 'DO'].join('')}|${['FIX', 'ME'].join('')}|${['X', 'XX'].join('')})\\b`);
    for (const src of allSrc) {
      expect(src).not.toMatch(forbidden);
    }
  });
});

describe('StepHeader contract', () => {
  it('advertises a 6-step total (one per Day-1 screen)', () => {
    expect(HEADER).toMatch(/DAY_ONE_TOTAL_STEPS\s*=\s*6/);
  });

  it('renders visible N/6 step text alongside the bar', () => {
    expect(HEADER).toMatch(/day-one-step-text/);
    expect(HEADER).toMatch(/DAY_ONE_TOTAL_STEPS/);
  });

  it('respects Reduce Motion (snaps to the target progress)', () => {
    expect(HEADER).toMatch(/if \(reduceMotion\)/);
    expect(HEADER).toMatch(/progress\.setValue\(target\)/);
  });
});
