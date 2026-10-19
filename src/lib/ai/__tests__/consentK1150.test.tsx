/**
 * CONSENT-K1 (agent 150): the owner's K1 rulings on the consent screens, one table.
 * Owner (10-15, verbatim): "k1-14 - hide until they have a coach" / "k1-12-13 - keep both" / "k1-5 - approved".
 * K1-14: Settings shows the Coach sharing row only while the server says the client has a coach (GET /consent/me), read
 *   each time Settings comes into view; the same mounted Settings follows a link gained, a link lost and a network recovery.
 * K1-12 / K1-13: "Before you join a coach" and the device line stay as approved.
 * K1-5: a client with no coach reads "Your plan and your logs stay as they are." in the delete-all confirmation.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import SettingsScreen from '../../../screens/client/SettingsScreen';
import RomanConversationsScreen from '../../../screens/settings/RomanConversationsScreen';
import { ROMAN_CHATS_COPY } from '../../../screens/settings/romanChatsCopy';
import { consentScreenCopy } from '../../consultation/copy';
import { clearUserCache, patchUserCache, setUserCache } from '../../userCache';
import { authEvents } from '../../../utils/authEvents';
import { notificationsApi } from '../../../services/api';
import { authEpoch } from '../../../services/accountBinding';
import type { CurrentUser } from '../../../hooks/useCurrentUser';
import type { RomanChatsApi } from '../../../api/romanChatsApi';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  profileApi: { update: jest.fn(async () => ({})) },
  notificationsApi: { updatePreferences: jest.fn(async () => ({})), getPreferences: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { roman_crisis_alert: false } }) }));
jest.mock('../../../screens/day-one/answers', () => ({ readDayOneAnswers: jest.fn(async () => null) }));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn(), refreshProfile: jest.fn(), prepareSignOutConfirm: jest.fn(async () => null) }));
jest.mock('../../../hooks/useBiometricGate', () => ({
  isBiometricSupportedOnDevice: jest.fn(async () => false), getBiometricOptIn: jest.fn(async () => false), setBiometricOptIn: jest.fn(async () => {}),
}));
jest.mock('../../../screens/client/settings/ClientTutorialSetting', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), successTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const SRC = path.join(__dirname, '..', '..', '..');
const source = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as unknown as NavigationProp<ParamListBase>;

/** GET /consent/me as the backend answers it: the caller's primary coach, or 400 when there is none. */
const server = (coach: 'yes' | 'none' | 'down') =>
  mockGet.mockImplementation(async () => {
    if (coach === 'yes') return { data: { coach_id: 'coach-1', consents: [], owner_access: false } };
    throw coach === 'none' ? { response: { status: 400 } } : new Error('offline');
  });

/** Lets the server read finish (a macrotask, after every pending promise). */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const CLIENT: CurrentUser = { id: 'client-1', email: 'a@example.invalid', role: 'student' };
const COACHED: CurrentUser = { ...CLIENT, coach_id: 'coach-1' };

// The client app's shape: Settings sits on the You tab's stack and stays mounted while the client visits another tab
// or opens a screen over it (ClientNavigator More stack).
const Tabs = createBottomTabNavigator();
const More = createNativeStackNavigator();
const nav = createNavigationContainerRef<ParamListBase>();
const Plain = () => null;
const YouTab = () => (
  <More.Navigator screenOptions={{ headerShown: false }}>
    <More.Screen name="MoreHome" component={Plain} />
    <More.Screen name="Settings" component={SettingsScreen} />
    <More.Screen name="AddCoachCode" component={Plain} />
    <More.Screen name="CoachSharing" component={Plain} />
  </More.Navigator>
);
const go = async (name: string, params?: object) => {
  await act(async () => { nav.navigate(name, params); });
  await settle();
};

/** Opens Settings for `user` and waits for the server read; `reads` counts GET /consent/me so far. */
async function settings(user: CurrentUser) {
  await setUserCache(user);
  const view = await render(
    <NavigationContainer ref={nav}>
      <Tabs.Navigator screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="You" component={YouTab} />
        <Tabs.Screen name="Food" component={Plain} />
      </Tabs.Navigator>
    </NavigationContainer>,
  );
  await go('You', { screen: 'Settings' });
  const reads = async (n: number) => {
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(n));
    await settle();
  };
  await reads(1);
  const privacy = () => within(view.getByTestId('settings-section-privacy'));
  return { view, privacy, reads, row: () => view.queryByTestId('settings-coach-sharing') };
}

/** Opens the delete-all confirmation of Your conversations with Roman for `user` and checks its body. */
async function expectDeleteAllBody(user: CurrentUser | null, body: string) {
  if (user) await setUserCache(user);
  else await clearUserCache();
  const api: Record<keyof RomanChatsApi, jest.Mock> = {
    list: jest.fn(async () => ({ ok: true, value: { sessions: [{ id: 'c1', surface: 'client', dayKey: '2026-10-02', messageCount: 2, startedAt: '2026-10-02T08:00:00.000Z', lastActivityAt: '2026-10-02T08:00:00.000Z' }], nextCursor: null } })),
    deleteOne: jest.fn(), deleteAll: jest.fn(), readMessages: jest.fn(),
  };
  const view = await render(
    <RomanConversationsScreen navigation={navigation} api={api} sessionUserId={() => user?.id ?? 'client-1'}
      captureBinding={async () => ({ subject: `sub:${user?.id ?? 'client-1'}`, epoch: authEpoch() })} />,
  );
  await fireEvent.press(await view.findByTestId('roman-chats-delete-all'));
  expect(within(view.getByTestId('roman-chats-confirm-all')).getByText(body)).toBeTruthy();
  await view.unmount();
}

const NO_COACH_BODY =
  'This permanently deletes every conversation you have had with Roman, from every day. It cannot be undone. Your plan and your logs stay as they are.';

/** B1 (Sol, LS-K1C): blur and refocus the same mounted Settings; every focus reads once, nothing else polls. */
const FOCUS: { name: string; user: CurrentUser; first: 'yes' | 'none' | 'down'; shown: boolean; next: 'yes' | 'none'; after: boolean }[] = [
  { name: 'link lost on the server: the row goes on return', user: COACHED, first: 'yes', shown: true, next: 'none', after: false },
  { name: 'link gained outside the app: the row comes on return', user: CLIENT, first: 'none', shown: false, next: 'yes', after: true },
  { name: 'network recovery, no coach link cached: the row comes on return', user: CLIENT, first: 'down', shown: false, next: 'yes', after: true },
  { name: 'network recovery, coached: the row shows from the coach link, then follows the server', user: COACHED, first: 'down', shown: true, next: 'none', after: false },
];

const ROWS: { row: string; check: () => Promise<void> }[] = [
  {
    row: 'K1-14: a client with no coach (server 400) sees no Coach sharing row; the rest of Privacy and data stays',
    check: async () => {
      server('none');
      const { privacy, row } = await settings(CLIENT);
      expect(row()).toBeNull();
      for (const label of ['Trust & Privacy', 'Blocked users', 'My data']) expect(privacy().getByText(label)).toBeTruthy();
      expect(privacy().queryByText('Coach sharing')).toBeNull();
    },
  },
  {
    row: 'K1-14: a client with a coach sees the row, and it opens Coach sharing',
    check: async () => {
      server('yes');
      const { view, row } = await settings(COACHED);
      expect(row()).toBeTruthy();
      await fireEvent.press(view.getByLabelText('Coach sharing'));
      await waitFor(() => expect(nav.getCurrentRoute()?.name).toBe('CoachSharing'));
    },
  },
  {
    row: 'K1-14: the server decides over the cached coach link, both ways',
    check: async () => {
      server('none');
      const stale = await settings({ ...CLIENT, coach_id: 'coach-stale' });
      expect(stale.row()).toBeNull();
      await stale.view.unmount();
      mockGet.mockClear();
      server('yes');
      expect((await settings(CLIENT)).row()).toBeTruthy();
    },
  },
  ...FOCUS.map(({ name, user, first, shown, next, after }) => ({
    row: `K1-14 on return to the same Settings (another tab): ${name}`,
    check: async () => {
      server(first);
      const { reads, row } = await settings(user);
      expect(!!row()).toBe(shown);
      await go('Food');
      server(next);
      await go('You');
      await reads(2);
      expect(!!row()).toBe(after);
      expect(notificationsApi.getPreferences).toHaveBeenCalledTimes(1); // the same Settings, never remounted
    },
  })),
  {
    row: 'K1-14: joining with Add a coach code shows the row back on Settings',
    check: async () => {
      server('none');
      const { reads, row } = await settings(CLIENT);
      expect(row()).toBeNull();
      await go('AddCoachCode');
      server('yes');
      await act(async () => { await patchUserCache({ coach_id: 'coach-1' }); authEvents.emit('login'); });
      await act(async () => { nav.goBack(); });
      await reads(2);
      expect(row()).toBeTruthy();
    },
  },
  {
    row: 'K1-14: a failed read shows no row and no error; the read is the caller\u2019s own (GET /consent/me, no ids sent)',
    check: async () => {
      server('down');
      const { view, row } = await settings(CLIENT);
      expect(row()).toBeNull();
      expect(view.queryByText(/could not load/i)).toBeNull();
      expect(mockGet.mock.calls.every((c) => c.length === 1 && c[0] === '/consent/me')).toBe(true);
    },
  },
  {
    row: 'K1-5: a client with no coach reads the approved line in the delete-all confirmation',
    check: async () => {
      await expectDeleteAllBody({ id: 'client-1', email: 'a@example.invalid', role: 'student' }, NO_COACH_BODY);
      expect(ROMAN_CHATS_COPY.confirmAllBodyNoCoach).toBe(NO_COACH_BODY);
    },
  },
  {
    row: 'K1-5: a client with a coach, a coach account and an account not loaded yet read what they read before',
    check: async () => {
      await expectDeleteAllBody({ id: 'client-1', email: 'a@example.invalid', role: 'student', coach_id: 'coach-1' }, ROMAN_CHATS_COPY.confirmAllBody);
      await expectDeleteAllBody(
        { id: 'coach-1', email: 'c@example.invalid', role: 'coach' },
        'This permanently deletes every conversation you have had with Roman, from every day. It cannot be undone.',
      );
      await expectDeleteAllBody(null, ROMAN_CHATS_COPY.confirmAllBody);
    },
  },
  {
    row: 'K1-12: "Before you join a coach" stays as approved (W-CONSENT), on the coach-free consultation',
    check: async () => {
      expect(consentScreenCopy(true).romanTitle).toBe('Before you join a coach');
      expect(consentScreenCopy(true).romanLead).toBe(
        'Roman works with a coach, so he is not available until you join one. If you allow this now, Roman is ready on the day you join and you will not be asked again.',
      );
      expect(consentScreenCopy(false).romanTitle).toBeNull();
    },
  },
  {
    row: 'K1-13: the device line for a client with no coach stays as approved (FW-BODY U10)',
    check: async () => {
      expect(source('screens/client/wearables/ConnectProviderSheet.tsx')).toContain(
        "? 'so your activity, heart rate and sleep show there. If you join a coach, your coach can see this data too.'",
      );
    },
  },
];

describe('the owner K1 rulings on the consent screens (CONSENT-K1)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearUserCache();
  });

  it.each(ROWS)('$row', async ({ check }) => {
    await check();
  });
});
