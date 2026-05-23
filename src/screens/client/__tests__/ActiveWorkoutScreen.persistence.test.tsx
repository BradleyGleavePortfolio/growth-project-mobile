// Unit tests for the ActiveWorkout persistence + AppState behaviours
// added for Hunter #2 P1-5 and P1-6 + the R15 user-scope follow-up.
//
// We test two layers:
//   1. The pure helpers in src/storage/activeWorkoutSession.ts —
//      load/save/clear/isSessionStale, with AsyncStorage mocked.
//      This is where the staleness rule, version-discard logic, and
//      per-user keying live, so it's the right place to assert them
//      directly. Cross-user isolation is asserted here.
//   2. The screen's wiring — we don't render the screen (it pulls in
//      reanimated, expo-sqlite, and a whole navigator), but we do
//      verify at the source level that the screen subscribes to
//      AppState, persists on mutation, clears on finish/cancel, and
//      gates every storage call on the resolved userId. A
//      source-pattern check is the same approach used by sibling
//      tests in this directory (see CoachGuidelinesScreen.test.ts).

import * as fs from 'fs';
import * as path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACTIVE_WORKOUT_SESSION_KEY_PREFIX,
  ACTIVE_WORKOUT_STALE_MS,
  ACTIVE_WORKOUT_SESSION_VERSION,
  LEGACY_ACTIVE_WORKOUT_SESSION_KEY,
  activeWorkoutSessionKey,
  clearActiveWorkoutSession,
  isSessionStale,
  loadActiveWorkoutSession,
  saveActiveWorkoutSession,
  type PersistedActiveWorkoutSession,
} from '../../../storage/activeWorkoutSession';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'ActiveWorkoutScreen.tsx'),
  'utf8',
);

const NOW = 1_700_000_000_000;
const USER_A = 'user_aaaa-1111';
const USER_B = 'user_bbbb-2222';

const baseSession = (
  overrides: Partial<PersistedActiveWorkoutSession> = {},
): Omit<PersistedActiveWorkoutSession, 'version' | 'updatedAtMs'> => ({
  startedAtMs: NOW - 5 * 60_000, // 5 minutes in
  routineName: 'Push Day',
  exercisesJson: '[]',
  assignmentId: 'asg_1',
  idempotencyKey: 'asg_1:abc',
  sessionExercises: [
    {
      exerciseId: 'ex_1',
      exerciseName: 'Bench Press',
      sets: [
        { reps: 8, weight: 135, completed: true },
        { reps: 8, weight: 135, completed: false },
      ],
    },
  ],
  ...overrides,
});

describe('activeWorkoutSession helpers', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('activeWorkoutSessionKey composes the per-user key', () => {
    expect(activeWorkoutSessionKey(USER_A)).toBe(
      `${ACTIVE_WORKOUT_SESSION_KEY_PREFIX}${USER_A}`,
    );
  });

  it('saveActiveWorkoutSession writes a versioned, timestamped payload at the per-user key', async () => {
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    const raw = await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as PersistedActiveWorkoutSession;
    expect(parsed.version).toBe(ACTIVE_WORKOUT_SESSION_VERSION);
    expect(parsed.updatedAtMs).toBe(NOW);
    expect(parsed.routineName).toBe('Push Day');
    expect(parsed.sessionExercises).toHaveLength(1);
  });

  it('saveActiveWorkoutSession refuses an empty userId so the global-key R15 leak cannot regress', async () => {
    await expect(saveActiveWorkoutSession('', baseSession(), NOW)).rejects.toThrow(
      /userId required/i,
    );
  });

  it('loadActiveWorkoutSession returns null when nothing is stored', async () => {
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result).toBeNull();
  });

  it('loadActiveWorkoutSession returns null when userId is empty', async () => {
    // Even if a legacy key exists, no userId means we can't safely
    // attribute the session — return null instead of leaking.
    await AsyncStorage.setItem(
      LEGACY_ACTIVE_WORKOUT_SESSION_KEY,
      JSON.stringify({
        ...baseSession(),
        version: ACTIVE_WORKOUT_SESSION_VERSION,
        updatedAtMs: NOW,
      }),
    );
    const result = await loadActiveWorkoutSession('', NOW);
    expect(result).toBeNull();
  });

  it('loadActiveWorkoutSession returns a fresh session as non-stale', async () => {
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result).not.toBeNull();
    expect(result!.isStale).toBe(false);
    expect(result!.session.routineName).toBe('Push Day');
  });

  it('loadActiveWorkoutSession flags sessions older than 12h as stale', async () => {
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    const future = NOW + ACTIVE_WORKOUT_STALE_MS + 1000;
    const result = await loadActiveWorkoutSession(USER_A, future);
    expect(result).not.toBeNull();
    expect(result!.isStale).toBe(true);
  });

  it('isSessionStale boundary: exactly STALE_MS is not yet stale', () => {
    expect(
      isSessionStale({ updatedAtMs: NOW - ACTIVE_WORKOUT_STALE_MS }, NOW),
    ).toBe(false);
    expect(
      isSessionStale({ updatedAtMs: NOW - ACTIVE_WORKOUT_STALE_MS - 1 }, NOW),
    ).toBe(true);
  });

  it('loadActiveWorkoutSession discards payloads with a wrong version', async () => {
    await AsyncStorage.setItem(
      activeWorkoutSessionKey(USER_A),
      JSON.stringify({
        ...baseSession(),
        version: 999,
        updatedAtMs: NOW,
      }),
    );
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result).toBeNull();
    // Bad payloads are cleared so they don't keep crashing the load.
    const raw = await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A));
    expect(raw).toBeNull();
  });

  it('loadActiveWorkoutSession discards corrupt JSON', async () => {
    await AsyncStorage.setItem(activeWorkoutSessionKey(USER_A), '{ not json');
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result).toBeNull();
    const raw = await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A));
    expect(raw).toBeNull();
  });

  it('clearActiveWorkoutSession removes the stored entry for that user only', async () => {
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    await saveActiveWorkoutSession(USER_B, baseSession({ routineName: 'Pull Day' }), NOW);
    await clearActiveWorkoutSession(USER_A);
    expect(await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A))).toBeNull();
    // User B's session is untouched.
    expect(await AsyncStorage.getItem(activeWorkoutSessionKey(USER_B))).toBeTruthy();
  });

  it('clearActiveWorkoutSession does not throw when nothing is stored', async () => {
    await expect(clearActiveWorkoutSession(USER_A)).resolves.toBeUndefined();
  });

  it('clearActiveWorkoutSession no-ops on empty userId', async () => {
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    await clearActiveWorkoutSession('');
    expect(await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A))).toBeTruthy();
  });

  it('save/load round-trips the assignment idempotency key', async () => {
    await saveActiveWorkoutSession(
      USER_A,
      baseSession({ idempotencyKey: 'asg_42:xyz' }),
      NOW,
    );
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result!.session.idempotencyKey).toBe('asg_42:xyz');
  });

  it('cross-user isolation: user B never sees user A`s session', async () => {
    // R15: a second user on the same device must NOT see the first
    // user's in-progress session. Without per-user keying the resume
    // prompt would surface User A's working set state to User B.
    await saveActiveWorkoutSession(USER_A, baseSession(), NOW);
    const resultB = await loadActiveWorkoutSession(USER_B, NOW);
    expect(resultB).toBeNull();
    // And User A is still able to load their own session.
    const resultA = await loadActiveWorkoutSession(USER_A, NOW);
    expect(resultA).not.toBeNull();
  });

  it('migrates a legacy global session into the per-user namespace on first load', async () => {
    // An in-flight workout that started before this patch shipped
    // lives under the legacy global key. The first load after the
    // upgrade must move it into the per-user namespace and remove
    // the legacy entry so it doesn't leak to a future signed-in user.
    await AsyncStorage.setItem(
      LEGACY_ACTIVE_WORKOUT_SESSION_KEY,
      JSON.stringify({
        ...baseSession(),
        version: ACTIVE_WORKOUT_SESSION_VERSION,
        updatedAtMs: NOW,
      }),
    );
    const result = await loadActiveWorkoutSession(USER_A, NOW);
    expect(result).not.toBeNull();
    expect(result!.session.routineName).toBe('Push Day');
    // Legacy key is gone.
    expect(
      await AsyncStorage.getItem(LEGACY_ACTIVE_WORKOUT_SESSION_KEY),
    ).toBeNull();
    // New per-user key has the payload.
    expect(
      await AsyncStorage.getItem(activeWorkoutSessionKey(USER_A)),
    ).toBeTruthy();
  });

  it('legacy migration is idempotent across reloads', async () => {
    await AsyncStorage.setItem(
      LEGACY_ACTIVE_WORKOUT_SESSION_KEY,
      JSON.stringify({
        ...baseSession(),
        version: ACTIVE_WORKOUT_SESSION_VERSION,
        updatedAtMs: NOW,
      }),
    );
    await loadActiveWorkoutSession(USER_A, NOW);
    const second = await loadActiveWorkoutSession(USER_A, NOW);
    expect(second).not.toBeNull();
    expect(second!.session.routineName).toBe('Push Day');
  });
});

describe('ActiveWorkoutScreen wiring (source-level)', () => {
  it('imports AppState from react-native', () => {
    expect(SCREEN_SRC).toMatch(/AppState,\s*\n\s*AppStateStatus,/);
  });

  it('imports the persistence helpers', () => {
    expect(SCREEN_SRC).toMatch(/loadActiveWorkoutSession/);
    expect(SCREEN_SRC).toMatch(/saveActiveWorkoutSession/);
    expect(SCREEN_SRC).toMatch(/clearActiveWorkoutSession/);
  });

  it('imports useCurrentUser to obtain the userId for the per-user storage key', () => {
    expect(SCREEN_SRC).toMatch(/from '\.\.\/\.\.\/hooks\/useCurrentUser'/);
    expect(SCREEN_SRC).toMatch(/useCurrentUser\(\)/);
  });

  it('passes the userId into every storage call', () => {
    // Belt-and-braces: every call to a persistence helper inside the
    // screen body must thread userId through as the first argument.
    expect(SCREEN_SRC).toMatch(/loadActiveWorkoutSession\(userId\)/);
    expect(SCREEN_SRC).toMatch(/saveActiveWorkoutSession\(userId,/);
    expect(SCREEN_SRC).toMatch(/clearActiveWorkoutSession\(userId\)/);
  });

  it('gates the persistence effect on a non-empty userId', () => {
    // Without this guard the debounced save effect would fire with
    // an empty userId during the brief window before useCurrentUser
    // resolves, and would have thrown from the storage helper.
    expect(SCREEN_SRC).toMatch(/!hydrated \|\| finishingRef\.current \|\| !userId/);
  });

  it('gates the restore-on-mount effect on userId so it re-runs once useCurrentUser resolves', () => {
    expect(SCREEN_SRC).toMatch(/if \(!userId\) return;/);
    // The effect's dep array includes userId so it re-runs when
    // useCurrentUser resolves on cold start.
    expect(SCREEN_SRC).toMatch(/}, \[userId\]\);/);
  });

  it('uses a wallclock anchor for the elapsed timer', () => {
    expect(SCREEN_SRC).toMatch(/sessionStartMsRef/);
    expect(SCREEN_SRC).toMatch(/Date\.now\(\) - sessionStartMsRef\.current/);
  });

  it('subscribes to AppState changes and recomputes on active', () => {
    expect(SCREEN_SRC).toMatch(/AppState\.addEventListener\('change'/);
    expect(SCREEN_SRC).toMatch(/next === 'active'/);
    expect(SCREEN_SRC).toMatch(/recomputeElapsed\(\)/);
  });

  it('pauses the timer interval on background/inactive', () => {
    expect(SCREEN_SRC).toMatch(/next === 'background' \|\| next === 'inactive'/);
    expect(SCREEN_SRC).toMatch(/stopTimerInterval\(\)/);
  });

  it('debounces persistence writes', () => {
    expect(SCREEN_SRC).toMatch(/PERSIST_DEBOUNCE_MS\s*=\s*500/);
    // The screen builds the payload locally, populates the pending-payload
    // ref, then arms the debounce timer that calls saveActiveWorkoutSession.
    expect(SCREEN_SRC).toMatch(/saveActiveWorkoutSession\(userId, payload\)/);
  });

  it('gates persistence on a hydrated flag so the load wins the mount race', () => {
    expect(SCREEN_SRC).toMatch(/const \[hydrated, setHydrated\] = useState\(false\)/);
    expect(SCREEN_SRC).toMatch(/if \(!hydrated/);
  });

  it('clears the persisted session on Finish and Cancel', () => {
    // Both paths must clear, and both must guard against the
    // debounced effect re-writing the session after the clear.
    const clearCalls = SCREEN_SRC.match(/clearActiveWorkoutSession\(/g) ?? [];
    // restore "Start Fresh" = 1, finish = 1, cancel = 1
    expect(clearCalls.length).toBeGreaterThanOrEqual(3);
    expect(SCREEN_SRC).toMatch(/finishingRef\.current = true/);
  });

  it('renders a Resume vs Start Fresh prompt with stale phrasing for old sessions', () => {
    expect(SCREEN_SRC).toMatch(/Resume earlier workout\?/);
    expect(SCREEN_SRC).toMatch(/Resume workout\?/);
    expect(SCREEN_SRC).toMatch(/Start Fresh/);
    expect(SCREEN_SRC).toMatch(/Resume/);
  });

  // ───── Audit follow-up coverage ──────────────────────────────────────────

  it('exposes a flushPendingPersist helper and calls it from the AppState background branch', () => {
    // Helper must exist, must use the latest payload ref, and must be
    // invoked from the same AppState branch that stops the interval.
    expect(SCREEN_SRC).toMatch(/const flushPendingPersist = useCallback/);
    expect(SCREEN_SRC).toMatch(/pendingPersistPayloadRef\.current/);
    // The background branch invokes the flush before stopping the tick.
    const bgBranch = SCREEN_SRC.match(
      /next === 'background' \|\| next === 'inactive'\)\s*\{[\s\S]*?\}/,
    );
    expect(bgBranch).not.toBeNull();
    expect(bgBranch![0]).toMatch(/flushPendingPersist\(\)/);
    expect(bgBranch![0]).toMatch(/stopTimerInterval\(\)/);
  });

  it('captures the latest payload synchronously so a flush between debounce-arm and fire still writes it', () => {
    // The persistence effect must populate pendingPersistPayloadRef
    // BEFORE setTimeout is armed. We assert ordering by source line.
    const populate = SCREEN_SRC.indexOf('pendingPersistPayloadRef.current = payload');
    const arm = SCREEN_SRC.indexOf('persistDebounceRef.current = setTimeout');
    expect(populate).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(-1);
    expect(populate).toBeLessThan(arm);
  });

  it('detects wallclock rollback on AppState active and re-anchors', () => {
    // The active branch must contain a guard like
    //   if (Date.now() < sessionStartMsRef.current) { ...re-anchor... }
    // using the last known elapsed value.
    expect(SCREEN_SRC).toMatch(/Date\.now\(\) < sessionStartMsRef\.current/);
    expect(SCREEN_SRC).toMatch(
      /sessionStartMsRef\.current = Date\.now\(\) - lastKnownElapsedMsRef\.current/,
    );
  });

  it('keeps lastKnownElapsedMsRef in sync with the displayed timer', () => {
    // recomputeElapsed must update both the displayed seconds AND the
    // millisecond ref so re-anchor math has a real value to subtract.
    expect(SCREEN_SRC).toMatch(/lastKnownElapsedMsRef\.current = elapsedMs/);
  });

  it('guards the Resume prompt with promptShownRef under StrictMode dev double-invoke', () => {
    expect(SCREEN_SRC).toMatch(/const promptShownRef = useRef\(false\)/);
    // The guard must early-return before any state mutation in the mount
    // effect (i.e. before setSessionExercises / setHydrated). The userId
    // gate sits above it; the guard itself must still run before
    // setHydrated.
    const guard = SCREEN_SRC.indexOf('if (promptShownRef.current) return');
    const setHydrated = SCREEN_SRC.indexOf('setHydrated(true)');
    expect(guard).toBeGreaterThan(-1);
    expect(setHydrated).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(setHydrated);
  });

  it('Cancel handler awaits the clear and nulls the pending payload before goBack', () => {
    // The Cancel onPress must:
    //   - be async
    //   - set finishingRef.current = true synchronously
    //   - null pendingPersistPayloadRef.current
    //   - await clearActiveWorkoutSession(userId)
    //   - navigation.goBack() last
    const cancelBlock = SCREEN_SRC.match(
      /text: 'Cancel',\s*style: 'destructive',[\s\S]*?onPress: async \(\) => \{[\s\S]*?navigation\.goBack\(\);\s*\}/,
    );
    expect(cancelBlock).not.toBeNull();
    const body = cancelBlock![0];
    expect(body).toMatch(/finishingRef\.current = true/);
    expect(body).toMatch(/pendingPersistPayloadRef\.current = null/);
    expect(body).toMatch(/await clearActiveWorkoutSession\(userId\)/);
  });
});

// ───── Behavioral simulation: clock rollback re-anchor ────────────────────
//
// The source-level checks above prove the wiring exists in the screen.
// To prove the *math* is right we exercise the rollback path directly
// against a pure JS replica of the relevant refs + the recompute step.
// Anything more elaborate would require mounting the screen, which the
// existing tests intentionally avoid.

describe('clock rollback re-anchor (math, isolated)', () => {
  // Replica of the screen's AppState 'active' branch math. Kept in this
  // test file because the screen mixes refs + setState; pulling the
  // pure math into a tested helper would be a behavior-equivalent
  // refactor.
  function reanchorOnActive(state: {
    sessionStartMs: number;
    lastKnownElapsedMs: number;
    now: number;
  }): { sessionStartMs: number; elapsedMs: number } {
    let { sessionStartMs } = state;
    if (state.now < sessionStartMs) {
      sessionStartMs = state.now - state.lastKnownElapsedMs;
    }
    const elapsedMs = Math.max(0, state.now - sessionStartMs);
    return { sessionStartMs, elapsedMs };
  }

  it('forward time advances elapsed normally', () => {
    const r = reanchorOnActive({
      sessionStartMs: 1_000,
      lastKnownElapsedMs: 5_000,
      now: 10_000,
    });
    expect(r.sessionStartMs).toBe(1_000); // unchanged
    expect(r.elapsedMs).toBe(9_000); // 10000 - 1000
  });

  it('exact-equal now does not re-anchor', () => {
    const r = reanchorOnActive({
      sessionStartMs: 1_000,
      lastKnownElapsedMs: 0,
      now: 1_000,
    });
    expect(r.sessionStartMs).toBe(1_000);
    expect(r.elapsedMs).toBe(0);
  });

  it('rollback by 10 minutes preserves displayed elapsed via re-anchor', () => {
    // User backgrounded at elapsed=300_000ms (5min), then NTP rolled
    // the clock back 10min. On resume, naive math would yield
    // Math.max(0, now - anchor) = 0 and the timer would freeze for
    // 10min. Re-anchoring keeps it at 5min and resumes ticking from
    // there.
    const r = reanchorOnActive({
      sessionStartMs: 1_000_000,
      lastKnownElapsedMs: 300_000,
      now: 700_000, // before the original anchor → rollback
    });
    expect(r.sessionStartMs).toBe(700_000 - 300_000);
    expect(r.elapsedMs).toBe(300_000);
  });

  it('rollback to exactly the original anchor still re-anchors and preserves elapsed', () => {
    const r = reanchorOnActive({
      sessionStartMs: 1_000_000,
      lastKnownElapsedMs: 60_000,
      now: 999_999, // 1ms before anchor — still rollback
    });
    expect(r.sessionStartMs).toBe(999_999 - 60_000);
    expect(r.elapsedMs).toBe(60_000);
  });
});
