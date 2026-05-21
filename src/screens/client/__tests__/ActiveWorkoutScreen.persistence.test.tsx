// Unit tests for the ActiveWorkout persistence + AppState behaviours
// added for Hunter #2 P1-5 and P1-6.
//
// We test two layers:
//   1. The pure helpers in src/storage/activeWorkoutSession.ts —
//      load/save/clear/isSessionStale, with AsyncStorage mocked.
//      This is where the staleness rule and version-discard logic
//      live, so it's the right place to assert them directly.
//   2. The screen's wiring — we don't render the screen (it pulls in
//      reanimated, expo-sqlite, and a whole navigator), but we do
//      verify at the source level that the screen subscribes to
//      AppState, persists on mutation, and clears on finish/cancel.
//      A source-pattern check is the same approach used by sibling
//      tests in this directory (see CoachGuidelinesScreen.test.ts).

import * as fs from 'fs';
import * as path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACTIVE_WORKOUT_SESSION_KEY,
  ACTIVE_WORKOUT_STALE_MS,
  ACTIVE_WORKOUT_SESSION_VERSION,
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

  it('saveActiveWorkoutSession writes a versioned, timestamped payload', async () => {
    await saveActiveWorkoutSession(baseSession(), NOW);
    const raw = await AsyncStorage.getItem(ACTIVE_WORKOUT_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as PersistedActiveWorkoutSession;
    expect(parsed.version).toBe(ACTIVE_WORKOUT_SESSION_VERSION);
    expect(parsed.updatedAtMs).toBe(NOW);
    expect(parsed.routineName).toBe('Push Day');
    expect(parsed.sessionExercises).toHaveLength(1);
  });

  it('loadActiveWorkoutSession returns null when nothing is stored', async () => {
    const result = await loadActiveWorkoutSession(NOW);
    expect(result).toBeNull();
  });

  it('loadActiveWorkoutSession returns a fresh session as non-stale', async () => {
    await saveActiveWorkoutSession(baseSession(), NOW);
    const result = await loadActiveWorkoutSession(NOW);
    expect(result).not.toBeNull();
    expect(result!.isStale).toBe(false);
    expect(result!.session.routineName).toBe('Push Day');
  });

  it('loadActiveWorkoutSession flags sessions older than 12h as stale', async () => {
    await saveActiveWorkoutSession(baseSession(), NOW);
    const future = NOW + ACTIVE_WORKOUT_STALE_MS + 1000;
    const result = await loadActiveWorkoutSession(future);
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
      ACTIVE_WORKOUT_SESSION_KEY,
      JSON.stringify({
        ...baseSession(),
        version: 999,
        updatedAtMs: NOW,
      }),
    );
    const result = await loadActiveWorkoutSession(NOW);
    expect(result).toBeNull();
    // Bad payloads are cleared so they don't keep crashing the load.
    const raw = await AsyncStorage.getItem(ACTIVE_WORKOUT_SESSION_KEY);
    expect(raw).toBeNull();
  });

  it('loadActiveWorkoutSession discards corrupt JSON', async () => {
    await AsyncStorage.setItem(ACTIVE_WORKOUT_SESSION_KEY, '{ not json');
    const result = await loadActiveWorkoutSession(NOW);
    expect(result).toBeNull();
    const raw = await AsyncStorage.getItem(ACTIVE_WORKOUT_SESSION_KEY);
    expect(raw).toBeNull();
  });

  it('clearActiveWorkoutSession removes the stored entry', async () => {
    await saveActiveWorkoutSession(baseSession(), NOW);
    await clearActiveWorkoutSession();
    const raw = await AsyncStorage.getItem(ACTIVE_WORKOUT_SESSION_KEY);
    expect(raw).toBeNull();
  });

  it('clearActiveWorkoutSession does not throw when nothing is stored', async () => {
    await expect(clearActiveWorkoutSession()).resolves.toBeUndefined();
  });

  it('save/load round-trips the assignment idempotency key', async () => {
    await saveActiveWorkoutSession(
      baseSession({ idempotencyKey: 'asg_42:xyz' }),
      NOW,
    );
    const result = await loadActiveWorkoutSession(NOW);
    expect(result!.session.idempotencyKey).toBe('asg_42:xyz');
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
    expect(SCREEN_SRC).toMatch(/saveActiveWorkoutSession\(\{/);
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
});
