/**
 * LS-908R2 B-R2-1, class-first (STORE-B2, KT-13): every key the notification settings screens write to phone storage
 * is gone before signOut() emits 'logout', on every way an account leaves the phone (Sign out, account deletion and
 * a session that ended, which call signOut() with no id), so the next account sees no earlier consent from any cache.
 * The table is checked against the screens' source, so a new storage writer there must be added to it.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render } from '@testing-library/react-native';
import NotificationPreferencesScreen from '../NotificationPreferencesScreen';
import { signOut } from '../../../services/authActions';
import { authEvents } from '../../../utils/authEvents';
import { NOTIF_CATEGORY_PREFS_KEY } from '../../../storage/notificationCategoryPrefs';

jest.mock('../../../services/api', () => ({
  notificationsApi: {
    getPreferences: jest.fn(async () => {
      throw new Error('Network Error');
    }),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0 } })) },
}));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'person-B', role: 'student' }),
  readUserCache: async () => ({ id: 'person-A', role: 'student' }),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ renewal: { state: 'none' } }),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock('../../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));

const SRC = path.resolve(__dirname, '../../..');
const WRITERS = [
  'screens/settings/NotificationPreferencesScreen.tsx',
  'screens/notifications/NotificationPreferencesScreen.tsx',
  'screens/settings/planRenewalOffers.ts',
  'screens/settings/usePlanRenewalGate.ts',
];
/** Every storage key those files write, and where it goes on sign-out. */
const KEYS: Array<{ key: string; writer: string; holds: string }> = [
  {
    key: NOTIF_CATEGORY_PREFS_KEY,
    writer: 'screens/settings/NotificationPreferencesScreen.tsx',
    holds: 'category switches, the plan renewal offers yes among them',
  },
];
const EXITS: Array<{ exit: string; run: () => Promise<void> }> = [
  { exit: 'Sign out (You, Settings)', run: () => signOut('person-A') },
  { exit: 'account deletion, or a session that ended (signOut with no id)', run: () => signOut() },
];

it('the table lists every storage write in the notification settings screens', () => {
  const written = WRITERS.flatMap((file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    return [...source.matchAll(/(?:AsyncStorage|Storage)\.(?:setItem|set|setString|multiSet)\(\s*([^,)]+)/g)].map(
      (m) => ({ file, arg: m[1].trim() }),
    );
  });
  expect(written).toEqual([{ file: KEYS[0].writer, arg: 'STORAGE_KEY' }]);
  const category = fs.readFileSync(path.join(SRC, KEYS[0].writer), 'utf8');
  expect(category).toContain('const STORAGE_KEY = NOTIF_CATEGORY_PREFS_KEY;');
  expect(category).not.toMatch(/\b(?:prefsStorage|cacheStorage|secureStorage|SecureStore)\b/);
});

describe.each(KEYS)('$key ($holds)', ({ key }) => {
  it.each(EXITS)('is gone before logout on: $exit', async ({ run }) => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(key, JSON.stringify({ plan_renewal: true, coach_direct: false }));
    let atLogout: Promise<string | null> | undefined;
    const onLogout = () => {
      atLogout = AsyncStorage.getItem(key);
    };
    authEvents.on('logout', onLogout);
    try {
      await run();
    } finally {
      authEvents.off('logout', onLogout);
    }
    expect(atLogout).toBeDefined();
    expect(await atLogout).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });
});

it('account switch: the next account, offline, sees none of the earlier switches', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(NOTIF_CATEGORY_PREFS_KEY, JSON.stringify({ plan_renewal: true, coach_direct: false }));
  await signOut('person-A');
  const screen = await render(
    <NotificationPreferencesScreen navigation={{ goBack: jest.fn() } as never} role={() => 'student'} />,
  );
  expect((await screen.findByLabelText('Coach Messages')).props.value).toBe(true);
  expect(screen.queryByLabelText('Plan renewal offers')).toBeNull();
  expect(await AsyncStorage.getItem(NOTIF_CATEGORY_PREFS_KEY)).toBeNull();
});
