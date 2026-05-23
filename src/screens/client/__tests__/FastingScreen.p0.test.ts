/**
 * P0 guardrail tests for FastingScreen.
 *
 * These are source-level assertions — same pattern as
 * `CoachGuidelinesScreen.test.ts`. A behavioural mount-and-fire test was
 * considered but the file pulls in expo-haptics, SVG, ActivityIndicator,
 * a 1Hz timer and a server-talking `loadAll` cascade; mocking the whole
 * tree to assert on `disabled={true}` cycles is more brittle than checking
 * that the actual fix tokens stayed in the source.
 *
 * Audited regressions covered:
 *   P0-3a — Start/End buttons disable across the in-flight network round-
 *           trip so a double-tap can't create two fasts or end the same
 *           fast twice. We assert a `submitting` state exists, both buttons
 *           consume it via `disabled={submitting}`, and `handleStart` /
 *           `doEndFast` flip it via setSubmitting(true) before the await.
 *
 *   P0-3b — `scheduleFastingAlert`'s returned id is persisted to
 *           AsyncStorage under FASTING_NOTIF_ID_KEY, and `doEndFast`
 *           reads it back and calls `cancelScheduledNotificationAsync`
 *           plus removeItem. This prevents the "Fast Complete" push from
 *           firing hours after the user manually ended the fast.
 *
 *   P0-4  — Streak math uses `bucketDateLocal` instead of UTC
 *           toISOString().split('T')[0], so AU/HI users don't see the
 *           streak reset every night.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'FastingScreen.tsx'),
  'utf8',
);

describe('FastingScreen — P0-3 double-start + notification cancel', () => {
  it('declares a submitting state', () => {
    expect(SRC).toMatch(/const \[submitting, setSubmitting\] = useState\(false\)/);
  });

  it('disables Start while submitting', () => {
    expect(SRC).toMatch(/disabled=\{submitting\}/);
    // And both buttons should opacity-dim via btnDisabled style on submit.
    expect(SRC).toMatch(/styles\.btnDisabled/);
    expect(SRC).toMatch(/btnDisabled: \{\s*opacity:/);
  });

  it('flips submitting=true before awaiting fastingApi.start', () => {
    const handleStart = extractFunctionBody(SRC, 'handleStart');
    expect(handleStart).toMatch(/setSubmitting\(true\)/);
    // Lock must precede the haptic so a queued double-tap can't slip in
    // during the haptic await.
    const lockIdx = handleStart.indexOf('setSubmitting(true)');
    const hapticIdx = handleStart.indexOf('Haptics.impactAsync');
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(hapticIdx).toBeGreaterThan(lockIdx);
  });

  it('early-returns from handleStart when already submitting', () => {
    const handleStart = extractFunctionBody(SRC, 'handleStart');
    expect(handleStart).toMatch(/submitting\)\s*return/);
  });

  it('persists the scheduled notification id under a user-scoped key', () => {
    // R15: every persisted key is `${kind}:${userId}`. A shared device must
    // not let user A's scheduled "Fast Complete" id leak to user B.
    expect(SRC).toMatch(/fastingNotifIdKey/);
    expect(SRC).toMatch(/fasting:scheduled_notification_id:\$\{userId\}/);
    expect(SRC).toMatch(/AsyncStorage\.setItem\(fastingNotifIdKey\(currentUser\.id\)/);
  });

  it('doEndFast cancels and removes the persisted notification id (user-scoped)', () => {
    const doEndFast = extractFunctionBody(SRC, 'doEndFast');
    expect(doEndFast).toMatch(/fastingNotifIdKey\(currentUser\.id\)/);
    expect(doEndFast).toMatch(/AsyncStorage\.getItem\(key\)/);
    expect(doEndFast).toMatch(/Notifications\.cancelScheduledNotificationAsync/);
    expect(doEndFast).toMatch(/AsyncStorage\.removeItem\(key\)/);
    expect(doEndFast).toMatch(/setSubmitting\(true\)/);
  });
});

describe('FastingScreen — P0-4 streak uses local timezone', () => {
  it('imports the bucketDateLocal helper', () => {
    expect(SRC).toMatch(/import \{ bucketDateLocal \} from '\.\.\/\.\.\/utils\/date'/);
  });

  it('uses bucketDateLocal in the streak loop, not toISOString().split', () => {
    // The streak loop must NOT call toISOString().split('T')[0] anymore —
    // that was the UTC-vs-local bug that reset the streak for AU/HI users.
    expect(SRC).not.toMatch(/toISOString\(\)\.split\('T'\)\[0\]/);
    expect(SRC).toMatch(/bucketDateLocal\(/);
  });
});

/**
 * Cheap brace-balancing extractor — good enough to isolate a top-level
 * function body for keyword presence checks without pulling in a parser.
 * Returns the substring from the function declaration to the matching close
 * brace.
 */
function extractFunctionBody(src: string, name: string): string {
  const pattern = new RegExp(`const ${name} = async \\(`);
  const match = pattern.exec(src);
  if (!match) {
    throw new Error(`could not locate ${name} in FastingScreen.tsx`);
  }
  const openBraceIdx = src.indexOf('{', match.index);
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(match.index, i + 1);
      }
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}
