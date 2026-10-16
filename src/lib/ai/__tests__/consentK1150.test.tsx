/**
 * CONSENT-K1 (agent 150): the owner's K1 rulings on the consent screens, one table.
 * Owner (10-15, verbatim): "k1-14 - hide until they have a coach" / "k1-12-13 - keep both" / "k1-5 - approved".
 * K1-14: Settings shows the Coach sharing row only while the server says the client has a coach (GET /consent/me).
 * K1-12 / K1-13: "Before you join a coach" and the device line stay as approved.
 * K1-5: a client with no coach reads "Your plan and your logs stay as they are." in the delete-all confirmation.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SettingsScreen from '../../../screens/client/SettingsScreen';
import RomanConversationsScreen from '../../../screens/settings/RomanConversationsScreen';
import { ROMAN_CHATS_COPY } from '../../../screens/settings/romanChatsCopy';
import { consentScreenCopy } from '../../consultation/copy';
import { clearUserCache, setUserCache } from '../../userCache';
import { authEpoch } from '../../../services/accountBinding';
import type { CurrentUser } from '../../../hooks/useCurrentUser';
import type { RomanChatsApi } from '../../../api/romanChatsApi';

const mockGet = jest.fn();
let mockUser: CurrentUser = { id: 'client-1', email: 'a@example.invalid' };
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  profileApi: { update: jest.fn(async () => ({})) },
  notificationsApi: { updatePreferences: jest.fn(async () => ({})), getPreferences: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { roman_crisis_alert: false } }) }));
jest.mock('../../../screens/day-one/answers', () => ({ readDayOneAnswers: jest.fn(async () => null) }));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn(), refreshProfile: jest.fn(), prepareSignOutConfirm: jest.fn(async () => null) }));
jest.mock('../../../hooks/useBiometricGate', () => ({
  isBiometricSupportedOnDevice: jest.fn(async () => false), getBiometricOptIn: jest.fn(async () => false), setBiometricOptIn: jest.fn(async () => {}),
}));
jest.mock('../../../screens/client/settings/ClientTutorialSetting', () => () => null);
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
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

async function settings() {
  const view = await render(<SettingsScreen navigation={navigation} />);
  await settle();
  const privacy = () => within(view.getByTestId('settings-section-privacy'));
  return { view, privacy, row: () => view.queryByTestId('settings-coach-sharing') };
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
  view.unmount();
}

const NO_COACH_BODY =
  'This permanently deletes every conversation you have had with Roman, from every day. It cannot be undone. Your plan and your logs stay as they are.';

const ROWS: { row: string; check: () => Promise<void> }[] = [
  {
    row: 'K1-14: a client with no coach (server 400) sees no Coach sharing row; the rest of Privacy and data stays',
    check: async () => {
      server('none');
      const { privacy, row } = await settings();
      expect(row()).toBeNull();
      for (const label of ['Trust & Privacy', 'Blocked users', 'My data']) expect(privacy().getByText(label)).toBeTruthy();
      expect(privacy().queryByText('Coach sharing')).toBeNull();
    },
  },
  {
    row: 'K1-14: a client with a coach sees the row, and it opens Coach sharing',
    check: async () => {
      mockUser = { ...mockUser, coach_id: 'coach-1' };
      server('yes');
      const { view, row } = await settings();
      expect(row()).toBeTruthy();
      await fireEvent.press(view.getByLabelText('Coach sharing'));
      expect(navigation.navigate).toHaveBeenLastCalledWith('CoachSharing');
    },
  },
  {
    row: 'K1-14: the server decides, not the cached coach link',
    check: async () => {
      mockUser = { ...mockUser, coach_id: 'coach-stale' };
      server('none');
      expect((await settings()).row()).toBeNull();
      mockUser = { id: 'client-1', email: 'a@example.invalid' };
      server('yes');
      expect((await settings()).row()).toBeTruthy();
    },
  },
  {
    row: 'K1-14: joining a coach shows it on the next read (the join updates the account), leaving hides it on the next open',
    check: async () => {
      server('none');
      const { view, row } = await settings();
      expect(row()).toBeNull();
      server('yes');
      mockUser = { ...mockUser, coach_id: 'coach-1' };
      await view.rerender(<SettingsScreen navigation={navigation} />);
      await settle();
      expect(row()).toBeTruthy();
      view.unmount();
      server('none');
      expect((await settings()).row()).toBeNull();
    },
  },
  {
    row: 'K1-14: a failed read shows no row and no error; the read is the caller\u2019s own (GET /consent/me, no ids sent)',
    check: async () => {
      server('down');
      const { view, row } = await settings();
      expect(row()).toBeNull();
      expect(view.queryByText(/could not load/i)).toBeNull();
      expect(mockGet).toHaveBeenCalledWith('/consent/me');
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
    mockUser = { id: 'client-1', email: 'a@example.invalid' };
    await clearUserCache();
  });

  it.each(ROWS)('$row', async ({ check }) => {
    await check();
  });
});
