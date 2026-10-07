/**
 * Enforces the rules from docs/QUIET_LUXURY_DOCTRINE.md by scanning the
 * shipped surface of the app. If any of these assertions fail, do NOT add
 * the offending file to an allowlist — fix the file. The doctrine is the
 * point.
 *
 * Scope: src/screens, src/components. Tests, types, and the legacy onboarding
 * step files are excluded (the long-flow onboarding is no longer reachable;
 * sweeping it is out of scope for Wave 5b).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  path.join(ROOT, 'screens'),
  path.join(ROOT, 'components'),
];

// Files explicitly allowed to slip through individual rules. Keep this list
// short and motivated; do not pad it.
const ALLOWLIST_HEAVY_WEIGHT: Set<string> = new Set();

// Phase 7C introduces opt-in leaderboard screens. These files intentionally
// contain the word "Leaderboard" as part of their feature identity.
// They are doctrine-compliant (no emoji, no trophy/podium chrome, no raw
// health or financial data surfaced). The allowlist is scoped to the
// Leaderboard-reference check only — all other doctrine rules still apply.
// Phase 7C introduces opt-in leaderboard screens. v3-1 extends the same
// opt-in cohort-local concept to community challenges (default OFF, opt-in,
// no trophy/podium chrome, no raw health/financial data). Doctrine-compliant
// by all other rules.
const ALLOWLIST_LEADERBOARD_REFERENCE: Set<string> = new Set([
  path.join(ROOT, 'screens', 'client', 'LeaderboardScreen.tsx'),
  path.join(ROOT, 'screens', 'client', 'LeaderboardSettingsScreen.tsx'),
  path.join(ROOT, 'screens', 'community', 'CommunityChallengeDetailScreen.tsx'),
  path.join(ROOT, 'screens', 'community', '__tests__', 'CommunityChallengeDetailScreen.test.tsx'),
  // Owner 10-06: the opt-in roster leaderboard opens from the Community tab.
  path.join(ROOT, 'screens', 'community', 'CommunityTabScreen.tsx'),
  path.join(ROOT, 'screens', 'community', 'communityNavTypes.ts'),
  path.join(ROOT, 'screens', 'community', '__tests__', 'communityLeaderboardEntry.test.tsx'),
]);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      // Skip the legacy long-form onboarding files — out of scope for Wave 5b.
      if (/onboarding\/OnboardingStep\d+\.tsx$/.test(full)) continue;
      if (/onboarding\/OnboardingResults\.tsx$/.test(full)) continue;
      out.push(full);
    }
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap(walk);

// Strip line and block comments before scanning so an explanatory note in a
// header comment doesn't trip the assertion.
function stripComments(src: string): string {
  // Block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

describe('Quiet-luxury doctrine (docs/QUIET_LUXURY_DOCTRINE.md)', () => {
  it('does not use fontWeight 700 or 800 in shipped screens or components', () => {
    const offenders: string[] = [];
    const re = /fontWeight\s*:\s*['"](?:700|800)['"]/;
    for (const file of FILES) {
      if (ALLOWLIST_HEAVY_WEIGHT.has(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain "Coming Soon" / "In Development" / "Planned" placeholder copy', () => {
    const offenders: string[] = [];
    const re = /coming\s+soon|["'`](?:in development)["'`]/i;
    for (const file of FILES) {
      if (/\/__tests__\/|\.(?:test|spec)\./.test(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain TODO / FIXME / XXX comments', () => {
    const offenders: string[] = [];
    const re = /\b(?:TODO|FIXME|XXX)\b/;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain trophy / confetti / first-win celebration chrome', () => {
    const offenders: string[] = [];
    // Allow incidental references inside the doctrine module name itself.
    const re = /(FirstWinCelebration|TrophyArtifact|TrophyShareScreen|confetti)/i;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not use Ionicons name="flame" anywhere in shipped surface', () => {
    const offenders: string[] = [];
    const re = /Ionicons[\s\S]*?name\s*=\s*["'`]flame(?:-[a-z]+)?["'`]/;
    const reInline = /name\s*=\s*["'`]flame(?:-[a-z]+)?["'`]/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src) || reInline.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not use Ionicons name="trophy" anywhere in shipped surface', () => {
    const offenders: string[] = [];
    const re = /name\s*=\s*["'`]trophy(?:-[a-z]+)?["'`]/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not reference the legacy BadgeCabinet identifier', () => {
    const offenders: string[] = [];
    const re = /BadgeCabinet/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("does not include 'streak' as a discriminated-union member in db/notificationsDb.ts", () => {
    const file = path.join(ROOT, 'db', 'notificationsDb.ts');
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    // The forbidden form is the literal string 'streak' inside a union: e.g. | 'streak'
    const re = /['"]streak['"]/;
    expect(re.test(src)).toBe(false);
  });

  it('does not reference Leaderboard in shipped screens', () => {
    const offenders: string[] = [];
    const re = /Leaderboard/;
    for (const file of FILES) {
      // The doctrine test file itself is allowed to reference the term.
      if (file === __filename) continue;
      // Phase 7C leaderboard screens are intentionally named and use the term.
      // They are doctrine-compliant (no emoji, trophy, raw health data, or
      // monetary data surfaced). See src/screens/client/LEADERBOARD.md.
      if (ALLOWLIST_LEADERBOARD_REFERENCE.has(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not embed pictograph emoji in source', () => {
    const offenders: string[] = [];
    // Pictograph ranges only — bare typographic marks like ✓ (U+2713) and
    // arrows are allowed because they read as glyphs, not as emoji.
    // Misc Symbols & Pictographs / Emoticons / Transport / Supplemental.
    const re = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}]/u;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});

// Render the touched client surfaces: truthful text must not cut working actions.
import React from 'react'; import { act, render, fireEvent, waitFor } from '@testing-library/react-native'; import { Alert } from 'react-native';
const mockNavigate = jest.fn(), mockBack = jest.fn();
let mockUser: import('../hooks/useCurrentUser').CurrentUser = { id: 'client', email: 'client@example.test' };
let mockAssignments: Array<{ id: string; completed_at: null; workout_plan: { name: string } }> = [];
let mockRoutines: Array<{ id: string; name: string; exercises: []; is_template: boolean }> = [];
let mockSessions: Array<{ id: string; date: string; workout_name: string; exercises: [] }> = [];
let mockWeights: Array<{ id: string; date: string; weight_lbs: number }> = [];
let mockConsent = [true, false];
let mockOwnerAccess: boolean | string | undefined = false;
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../constants/colors').default, tokens: require('../theme/tokens').default, semanticColors: require('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack, getParent: () => ({ navigate: mockNavigate }) }),
  useRoute: () => ({ params: {} }), useFocusEffect: jest.fn(),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({ data: url.includes('consent') ? {
    coach_id: 'coach', owner_access: mockOwnerAccess, consents: [{ scope: 'fitness.workouts', granted: mockConsent[0] }, { scope: 'fitness.food_macros', granted: mockConsent[1] }],
  } : { id: 'coach', name: 'Coach Lee' } })) },
  workoutApi: {
    getRoutines: jest.fn(async () => ({ data: mockRoutines })),
    getAll: jest.fn(async (limit: number) => ({ data: limit === 5 ? mockSessions.slice(0, 5) : mockSessions })), getVolume: jest.fn(async () => ({ data: [] })),
    deleteWorkout: jest.fn(async () => ({})),
  },
  weightApi: { getHistory: jest.fn(async () => ({ data: { logs: mockWeights } })), log: jest.fn(async () => ({})) },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, refetch: jest.fn(async () => ({})) }),
}));
jest.mock('../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../screens/day-one/api', () => ({ saveNotifPermission: jest.fn(async () => ({})) }));
jest.mock('../services/pushNotifications', () => ({ registerForPushNotifications: jest.fn(async () => ({ granted: true })) }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../config/featureFlags', () => ({ featureFlags: {} }));
jest.mock('../components/FadeInView', () => ({ children }: { children: import('react').ReactNode }) => children);
jest.mock('../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../components/community/MilestoneCabinet', () => () => null);
jest.mock('../screens/client/progress/ProgressChartCard', () => () => null);
import WorkoutScreen from '../screens/client/WorkoutScreen'; import ProgressScreen from '../screens/client/ProgressScreen';
import ProfileScreen from '../screens/client/ProfileScreen'; import ReportScreen from '../screens/client/ReportScreen';
const press = async (s: Awaited<ReturnType<typeof render>>, label: string) => fireEvent.press(s.getByLabelText(label));
const focusProfile = () => jest.requireMock('@react-navigation/native').useFocusEffect.mock.calls.at(-1)?.[0]();
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 'client', email: 'client@example.test' };
  mockAssignments = []; mockRoutines = []; mockSessions = []; mockWeights = [];
  mockConsent = [true, false]; mockOwnerAccess = false;
});
describe('Truthful client copy and routes/actions parity', () => {
  it('puts Quick Workout, routines and history before both collapsed charts on day one', async () => {
    const s = await render(React.createElement(WorkoutScreen));
    await waitFor(() => expect(s.getByText('No routines yet')).toBeTruthy());
    expect(s.queryByText('From coach')).toBeNull();
    const tree = s.getAllByText(/Quick Workout|My Routines|Recent Workouts|Complete workouts to see volume data/).map((node) => node.props.children).join('|');
    expect(tree.indexOf('Quick Workout')).toBeLessThan(tree.indexOf('My Routines'));
    expect(tree.indexOf('Recent Workouts')).toBeLessThan(tree.indexOf('Complete workouts to see volume data'));
    await fireEvent.press(s.getByText('Quick Workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
    await fireEvent.press(s.getByText('Create a routine'));
    expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder');
    for (const [label, route] of [['Exercise library', 'ExerciseLibrary'], ['Coach guidelines', 'CoachGuidelines']]) {
      await press(s, label); expect(mockNavigate).toHaveBeenLastCalledWith(route);
    }
  });
  it('keeps assigned, routine, edit, delete, older history and refresh actions', async () => {
    mockUser.coach_id = 'coach';
    mockAssignments = [{ id: 'assigned', completed_at: null, workout_plan: { name: 'Strength' } }];
    mockRoutines = [{ id: 'routine', name: 'Full body', exercises: [], is_template: false }];
    mockSessions = [{ id: 'session', date: '2026-10-06', workout_name: 'Logged session', exercises: [] }];
    mockSessions.push(...Array.from({ length: 5 }, (_, i) => ({ id: `older-${i}`, date: '2026-10-05', workout_name: `Older ${i}`, exercises: [] as [] })));
    const s = await render(React.createElement(WorkoutScreen));
    await waitFor(() => expect(s.getByText('Full body')).toBeTruthy());
    await press(s, 'Open assigned workout: Strength');
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: 'assigned' } });
    await fireEvent.press(s.getByText('Full body'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineId: 'routine', routineName: 'Full body', exercises: '[]' });
    await press(s, 'Edit routine Full body'); expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder', { routineId: 'routine' });
    await press(s, 'Edit workout Logged session');
    expect(mockNavigate).toHaveBeenLastCalledWith('WorkoutHistoryEdit', { workout: JSON.stringify(mockSessions[0]) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await press(s, 'Delete workout Logged session'); expect(alert).toHaveBeenCalledWith('Delete this workout?', expect.any(String), expect.any(Array));
    await alert.mock.calls[0][2]?.find((button) => button.text === 'Delete')?.onPress?.();
    expect(require('../services/api').workoutApi.deleteWorkout).toHaveBeenCalledWith('session');
    alert.mockRestore();
    await press(s, 'Show older workouts'); await press(s, 'Show recent workouts only');
    expect(s.getByTestId('workout-scroll').props.refreshControl.props.onRefresh).toEqual(expect.any(Function));
  });
  it.each([['today gap', [0, 1, 3], '2'], ['today not logged', [1, 2, 3], '3'], ['look-back limit', Array.from({ length: 60 }, (_, i) => i), '60+']])(
    'names the weigh-in run and preserves share, Report, periods and weight logging: %s', async (_case, offsets, count) => {
      mockWeights = (offsets as number[]).map((offset) => {
        const d = new Date(); d.setDate(d.getDate() - offset);
        return { id: String(offset), date: require('../utils/date').bucketDateLocal(d), weight_lbs: 180 };
      });
      const s = await render(React.createElement(ProgressScreen));
      await waitFor(() => expect(s.getByText(`${count} days in a row with a weigh-in`)).toBeTruthy());
      if (count !== '2') {
        await press(s, `Share ${count} days in a row with a weigh-in`);
        expect(mockNavigate).toHaveBeenLastCalledWith('ShareCard', { milestone: { variant: 'streak', value: count, label: 'days in a row with a weigh-in' } });
      }
      await press(s, 'View progress report'); expect(mockNavigate).toHaveBeenLastCalledWith('Report');
      for (const period of ['7D', '30D', '90D', 'All']) await press(s, `Show ${period} period`);
      await press(s, 'Log weight');
      await fireEvent.changeText(s.getByLabelText('Enter weight in pounds'), '179');
      await fireEvent.changeText(s.getByLabelText('Enter optional notes'), 'Morning');
      await press(s, 'Save weight log entry');
      expect(require('../services/api').weightApi.log).toHaveBeenCalledWith(expect.objectContaining({ weight_lbs: 179, notes: 'Morning' }));
      await press(s, 'Log weight'); await press(s, 'Close log weight modal');
    },
  );
  it('keeps every Profile route and names only granted sharing scopes', async () => {
    const s = await render(React.createElement(ProfileScreen));
    expect(s.queryByText('Day 7 of 30.')).toBeNull();
    expect(s.queryByText(/Workouts.*(?:visible|shared)/)).toBeNull();
    for (const [label, route] of [['Settings', 'Settings'], ['My report', 'Report'], ['Widgets', 'Widgets'], ['Learn', 'Learn'], ['Edit personal info', 'EditProfile']]) {
      await press(s, label); expect(mockNavigate).toHaveBeenLastCalledWith(route);
    }
    for (const row of s.getAllByLabelText(/Tap to edit/)) {
      await fireEvent.press(row); expect(mockNavigate).toHaveBeenLastCalledWith('EditProfile');
    }
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(s.getByText('Sign Out'));
    const confirm = alert.mock.calls[0][2]?.find((button) => button.text === 'Sign Out');
    await confirm?.onPress?.();
    expect(require('../services/authActions').signOut).toHaveBeenCalled(); alert.mockRestore();
    mockUser = { ...mockUser, coach_id: 'coach' };
    await s.rerender(React.createElement(ProfileScreen));
    await act(async () => { focusProfile(); });
    await waitFor(() => expect(s.getByText('Workouts are shared with Coach Lee. Meals are not shared with Coach Lee.')).toBeTruthy());
    expect(s.queryByText(/only to you/)).toBeNull();
  });
  it.each([
    { grants: [true, true], copy: 'Workouts and meals are shared with Coach Lee.' },
    { grants: [false, false], copy: 'Workouts and meals are not shared with Coach Lee.' },
    { grants: [true, false], copy: 'Workouts are shared with Coach Lee. Meals are not shared with Coach Lee.' },
    { grants: [false, true], copy: 'Workouts are not shared with Coach Lee. Meals are shared with Coach Lee.' },
  ])('describes only assigned-coach sharing for grants $grants', async ({ grants, copy }) => {
    mockUser.coach_id = 'coach'; mockConsent = grants;
    const s = await render(React.createElement(ProfileScreen));
    await act(async () => { focusProfile(); });
    await waitFor(() => expect(s.getByText(copy)).toBeTruthy());
    expect(s.queryByText(/only to you/)).toBeNull();
  });
  it.each([true, false, undefined, 'false'])('never hides owner access or assumes it is absent (%s)', async (ownerAccess) => {
    mockUser.coach_id = 'coach'; mockConsent = [false, false]; mockOwnerAccess = ownerAccess;
    const s = await render(React.createElement(ProfileScreen));
    await act(async () => { focusProfile(); });
    await waitFor(() => expect(require('../services/api').default.get).toHaveBeenCalledWith('/consent/me?coach_id=coach'));
    if (ownerAccess === false) expect(s.getByText('Workouts and meals are not shared with Coach Lee.')).toBeTruthy();
    else {
      expect(s.queryByText(/visible only to you/)).toBeNull();
      if (ownerAccess === true) expect(s.getByText('Workouts and meals are visible to you and Coach Lee.')).toBeTruthy();
      else expect(s.queryByText(/Workouts.*(?:visible|shared)/)).toBeNull();
    }
  });
  it('refreshes sharing after Profile to Settings to Profile and suppresses stale reassurance during the read', async () => {
    mockUser.coach_id = 'coach'; mockConsent = [false, false];
    const s = await render(React.createElement(ProfileScreen));
    let blur: (() => void) | undefined;
    await act(async () => { blur = focusProfile(); });
    await waitFor(() => expect(s.getByText('Workouts and meals are not shared with Coach Lee.')).toBeTruthy());
    await press(s, 'Settings'); expect(mockNavigate).toHaveBeenLastCalledWith('Settings'); blur?.();
    mockConsent = [true, true];
    let releaseCoach: (() => void) | undefined;
    const pendingCoach = new Promise((resolve) => { releaseCoach = () => resolve({ data: { id: 'coach', name: 'Coach Lee' } }); });
    require('../services/api').default.get.mockImplementationOnce(() => pendingCoach);
    await act(async () => { focusProfile(); });
    expect(s.queryByText(/Workouts.*(?:visible|shared)/)).toBeNull();
    await act(async () => { releaseCoach?.(); });
    await waitFor(() => expect(s.getByText('Workouts and meals are shared with Coach Lee.')).toBeTruthy());
    expect(require('../services/api').default.get).toHaveBeenCalledTimes(4);
  });
  it('labels canned report advice as general and keeps Back', async () => {
    const s = await render(React.createElement(ReportScreen, { navigation: jest.requireMock('@react-navigation/native').useNavigation() }));
    expect(s.getByText('General guidance for General Fitness')).toBeTruthy();
    expect(s.queryByText('Consistency beats perfection. Keep showing up.')).toBeNull();
    await press(s, 'Back');
    expect(mockBack).toHaveBeenCalled();
  });
  it('names a failed weight chart and retains its explicit retry', async () => {
    require('../services/api').weightApi.getHistory.mockRejectedValueOnce(new Error('offline'));
    const s = await render(React.createElement(ProgressScreen));
    await waitFor(() => expect(s.getByText('The weight chart did not load. Pull down to try again.')).toBeTruthy());
    await fireEvent.press(s.getByTestId('progress-weight-chart-error-retry'));
  });
  it('schedules a fasting-window message, not a claim that a goal was reached', async () => {
    const notifications = require('expo-notifications'); notifications.SchedulableTriggerInputTypes = { DATE: 'date' };
    await require('../utils/notifications').scheduleFastingAlert(new Date(Date.now() + 3600000));
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ body: 'Fasting window ended.' }) }));
  });
  it.each([false, true])('uses the actual pairing state in Day-1 notifications (%s), retaining enable/skip', async (paired) => {
    if (paired) mockUser.coach_id = 'coach';
    const NotificationsScreen = require('../screens/day-one/NotificationsScreen').default;
    const s = await render(React.createElement(NotificationsScreen, { navigation: { navigate: mockNavigate, goBack: mockBack } }));
    expect(s.getByText(paired ? 'Stay close to your coach' : 'Reminders and messages')).toBeTruthy();
    await fireEvent.press(s.getByTestId('day-one-notifications-enable'));
    expect(require('../services/pushNotifications').registerForPushNotifications).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckInTime');
    await fireEvent.press(s.getByTestId('day-one-notifications-skip'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckInTime');
    const strings = require('../screens/day-one/i18n/en.json');
    const navigator = fs.readFileSync(path.join(ROOT, 'navigation/Day1OnboardingNavigator.tsx'), 'utf8');
    expect(strings.welcome.subtitle).toBe(`Setup takes ${(navigator.match(/<Stack.Screen/g) ?? []).length} short steps.`);
  });
});
