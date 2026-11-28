/**
 * SETTINGS-SIGNOUT-M (SWEEP-FINAL-ACCOUNT-DAY B1): the client's phone settings ('gp_client_settings': units, water goal,
 * the alert switches, haptics; hooks/useSettings) belong to the person signed in. Sign-out removes them and starts the
 * profile seed again, so the next person on the phone is never shown or alerted by the first person's settings, and her
 * own profile's water goal is read in the same app session. Every sign-out does this, the API client's own sign-out after
 * a refused session renewal included (OPERATOR RULING 7237346197, option A).
 *
 * Real pieces: authActions.signOut, hooks/useSettings, ui/haptics/haptics.service, utils/notifications, AsyncStorage
 * (the jest stand-in keeps what is written). Stand-ins: the network (profileApi.get answers each client's own
 * profile), secure storage, the signed-in user cache (who is signed in), the stores sign-out also clears, expo-haptics.
 * Names are fictional.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { signOut, SIGN_OUT_KEYS } from '../authActions';
import { DEFAULT_SETTINGS, useSettings, type ClientSettings } from '../../hooks/useSettings';
import { HapticService } from '../../ui/haptics/haptics.service';
import { scheduleFastingAlert } from '../../utils/notifications';
import { profileApi } from '../api';
import { holdSessionFence, sessionGeneration } from '../sessionFence';

const mockWho = { id: 'client-a' };

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
// The shared jest.setup stand-in plus the trigger types scheduleFastingAlert reads.
jest.mock('expo-notifications', () => ({
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'mock-notif-id'),
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn() },
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: mockWho.id })),
  readUserCache: jest.fn(async () => ({ id: mockWho.id })),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
}));
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  secureStorage: { getString: () => undefined },
}));
// fastingDb pulls in expo-sqlite, which does not load under Jest.
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

/** Each client's own profile on the server: her water goal. */
const profileGoal: Record<string, number> = { 'client-a': 120, 'client-b': 64 };

/** Client A's choices on the phone: every setting away from its default (her 120 oz goal among them). */
const A_CHOICES: ClientSettings = {
  unit: 'kg',
  mealsPerDay: 6,
  waterGoalOz: 120,
  calorieDisplay: 'gross',
  dailyCheckin: false,
  mealReminders: false,
  fastingAlerts: false,
  weeklySummary: false,
  hapticsEnabled: false,
};

function profileAnswers() {
  jest.mocked(profileApi.get).mockImplementation((async () => ({ data: { water_goal_oz: profileGoal[mockWho.id] } })) as never);
}

/**
 * The API client's own sign-out after the sign-in service refused to renew the session (services/api.ts
 * handleRefreshFailure, for example after a password reset on another phone): it holds the session fence for the whole
 * sign-out and passes it as opts.sessionFence.
 */
async function signOutAfterRefusedRenewal() {
  const hold = holdSessionFence(sessionGeneration(), 'signout');
  if (!hold) throw new Error('expected the session fence');
  try {
    await signOut(undefined, { sessionFence: hold.pass });
  } finally {
    hold.release(true);
  }
}

/** Client A uses the phone, makes every choice (the Haptics switch through updateSetting, as Settings does), signs out. */
async function clientAUsesThePhoneThenSignsOut(signOutNow: () => Promise<void> = () => signOut()) {
  const a = await renderHook(() => useSettings());
  await waitFor(() => expect(a.result.current.loaded).toBe(true));
  await act(async () => {
    await a.result.current.saveSettings({ ...A_CHOICES, hapticsEnabled: true });
  });
  await act(async () => {
    a.result.current.updateSetting('hapticsEnabled', false);
  });
  await waitFor(() => expect(a.result.current.settings).toEqual(A_CHOICES));
  a.unmount();
  await signOutNow();
}

async function clientBOpensTheApp() {
  mockWho.id = 'client-b';
  const b = await renderHook(() => useSettings());
  await waitFor(() => expect(b.result.current.loaded).toBe(true));
  return b;
}

// The profile seed is once per app session (module memory), so the cases share one session, in order, as on a phone:
// each starts after the last person signed out.
beforeEach(async () => {
  mockWho.id = 'client-a';
  profileAnswers();
  await signOut();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('SETTINGS-SIGNOUT-M: SIGN_OUT_KEYS lists the client settings key', () => {
  expect(SIGN_OUT_KEYS).toContain('gp_client_settings');
});

it('SETTINGS-SIGNOUT-M: a profile read for client A that answers after she signed out writes nothing for client B', async () => {
  let answerA: (v: unknown) => void = () => undefined;
  jest.mocked(profileApi.get).mockImplementationOnce((() => new Promise((resolve) => { answerA = resolve; })) as never);
  const a = await renderHook(() => useSettings());
  await waitFor(() => expect(profileApi.get).toHaveBeenCalledTimes(1));
  a.unmount();
  await signOut();
  // A's answer lands late, after the sign-out removed the key.
  await act(async () => {
    answerA({ data: { water_goal_oz: 120 } });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(await AsyncStorage.getItem('gp_client_settings')).toBeNull();
  const b = await clientBOpensTheApp();
  await waitFor(() => expect(b.result.current.settings.waterGoalOz).toBe(64));
});

it('SWEEP-FINAL-ACCOUNT-DAY B1: after one client signs out, the next client on the phone sees her own water goal and units, not the first client\'s', async () => {
  await clientAUsesThePhoneThenSignsOut();
  const b = await clientBOpensTheApp();
  await new Promise((r) => setTimeout(r, 50));
  expect(b.result.current.settings.unit).toBe('lbs');
  expect(b.result.current.settings.waterGoalOz).toBe(64);
});

it('SETTINGS-SIGNOUT-M: none of client A\'s settings reaches client B after sign-out (every field, table-driven)', async () => {
  await clientAUsesThePhoneThenSignsOut();
  expect(await AsyncStorage.getItem('gp_client_settings')).toBeNull();
  const b = await clientBOpensTheApp();
  await waitFor(() => expect(b.result.current.settings.waterGoalOz).toBe(64));
  const expected: ClientSettings = { ...DEFAULT_SETTINGS, waterGoalOz: 64 };
  for (const key of Object.keys(A_CHOICES) as Array<keyof ClientSettings>) {
    expect({ key, value: b.result.current.settings[key] }).toEqual({ key, value: expected[key] });
  }
  // What B's phone keeps for her: her own goal, nothing of A's.
  expect(JSON.parse((await AsyncStorage.getItem('gp_client_settings')) ?? '{}')).toEqual(expected);
});

it('SETTINGS-SIGNOUT-M: the sign-out after a refused session renewal (opts.sessionFence) also removes client A\'s settings (ruling 7237346197)', async () => {
  await clientAUsesThePhoneThenSignsOut(signOutAfterRefusedRenewal);
  expect(await AsyncStorage.getItem('gp_client_settings')).toBeNull();
  const b = await clientBOpensTheApp();
  await waitFor(() => expect(b.result.current.settings.waterGoalOz).toBe(64));
  expect(b.result.current.settings).toEqual({ ...DEFAULT_SETTINGS, waterGoalOz: 64 });
  await HapticService.selection();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
});

it('SETTINGS-SIGNOUT-M: client A\'s switches do not decide client B\'s alerts and haptics (fasting alert, haptics)', async () => {
  await clientAUsesThePhoneThenSignsOut();
  await clientBOpensTheApp();
  // A turned haptics off; B (or a coach, who never mounts useSettings) has the default, on.
  await HapticService.selection();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  // A turned Fasting alerts off; B's fast still gets its end alert.
  await expect(scheduleFastingAlert(new Date(Date.now() + 60 * 60 * 1000))).resolves.toBe('mock-notif-id');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

it('SETTINGS-SIGNOUT-M: a goal client B saved on the phone keeps winning over her profile while she stays signed in', async () => {
  await clientAUsesThePhoneThenSignsOut();
  const b = await clientBOpensTheApp();
  await waitFor(() => expect(b.result.current.settings.waterGoalOz).toBe(64));
  await act(async () => {
    b.result.current.updateSetting('waterGoalOz', 80);
  });
  b.unmount();
  const reads = jest.mocked(profileApi.get).mock.calls.length;
  // B opens the Food tab again: her phone goal, no new profile read.
  const again = await renderHook(() => useSettings());
  await waitFor(() => expect(again.result.current.settings.waterGoalOz).toBe(80));
  expect(jest.mocked(profileApi.get).mock.calls.length).toBe(reads);
});
