/**
 * CRISIS-APP-COPY (owner op 1, 2026-10-15): wherever the app states the Roman
 * safety-reply exception, the approved crisis sentence follows it, exactly
 * while the server's FEATURE_ROMAN_CRISIS_ALERT is on (GET /me/feature-flags
 * roman_crisis_alert) and never while it is off. FIX725: only a client with a
 * coach reads it (never a coach account or a client with no coach), and a
 * failed flag read is off even after an earlier true.
 *
 * LIST is every place in this repo (search-backed, see the CRISISAPP-M PR):
 * the Trust Center "Who can see your data" Roman bullet and the intro of Your
 * conversations with Roman. Each place is walked for every account and every
 * switch state through the real useFeatureFlags (server map -> hook -> helper
 * -> screen). The sentence shows only for a client with a coach while the
 * switch is on; every other row reads exactly today's text.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEpoch } from '../../services/accountBinding';
import { featureFlagsKeys } from '../../hooks/useFeatureFlags';
import type { CurrentUser } from '../../hooks/useCurrentUser';
import { ROMAN_CHATS_COPY } from '../../screens/settings/romanChatsCopy';
import { ROMAN_CRISIS_TOLD_SENTENCE, ROMAN_SAFETY_EXCEPTION, withCrisisSentence } from '../romanCrisisSentence';

jest.mock('../../services/sentry', () => ({ captureErrorWithoutPii: jest.fn(), captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../theme/ThemeProvider', () => {
  const CanonicalColors = jest.requireActual('../../constants/colors').default;
  const { lightTokens } = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colors: CanonicalColors, semanticColors: lightTokens }) };
});
jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.reject(new Error('offline'))) },
}));
jest.mock('../../services/dataExportApi', () => ({ dataExportApi: { requestExport: jest.fn() } }));
jest.mock('../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
let mockUser: CurrentUser | null = null;
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockGetFlags = jest.fn();
jest.mock('../../api/featureFlagsApi', () => ({ featureFlagsApi: { getFeatureFlags: () => mockGetFlags() } }));

const TrustCenterScreen = require('../../screens/TrustCenterScreen').default;
const RomanConversationsScreen = require('../../screens/settings/RomanConversationsScreen').default;

const EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const TOLD =
  'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';
const count = (text: string, part: string) => text.split(part).length - 1;
const flags = (on: boolean) => ({ flags: { roman_crisis_alert: on }, evaluated_at: '2026-10-15T00:00:00.000Z' });

const ACCOUNTS: [label: string, user: CurrentUser, coached: boolean][] = [
  ['client with a coach', { id: 'client-1', email: 'client@example.test', role: 'student', coach_id: 'coach-1' }, true],
  ['client with no coach', { id: 'client-2', email: 'solo@example.test', role: 'student' }, false],
  ['coach account', { id: 'coach-1', email: 'coach@example.test', role: 'coach' }, false],
];
type Switch = 'on' | 'off' | 'failed read';
const SWITCHES: Switch[] = ['on', 'off', 'failed read'];

const nav = { goBack: jest.fn(), navigate: jest.fn() };
/** Renders the real screen and returns a reader for the place's current text. */
type Mount = (wrapper: React.ComponentType<{ children: React.ReactNode }>, user: CurrentUser) => Promise<() => string>;
const ROMAN_BULLET = /^(Not your coach —|Your Roman conversations are kept until you delete them or your account)/;
const LIST: [place: string, mount: Mount, today: (coached: boolean) => string][] = [
  [
    'Trust Center, Who can see your data',
    async (wrapper, user) => {
      const screen = await render(<TrustCenterScreen navigation={nav} />, { wrapper });
      const read = () => String(screen.getByText(ROMAN_BULLET).props.children);
      // A coached client's line waits for the coach link read (it fails here, so the account's coach_id decides).
      if (user.coach_id) await waitFor(() => expect(read()).toMatch(/^Not your coach —/));
      return read;
    },
    (coached) =>
      coached
        ? `Not your coach — your Roman conversations, which are kept until you delete them or your account. ${EXCEPTION}`
        : 'Your Roman conversations are kept until you delete them or your account',
  ],
  [
    'Your conversations with Roman, intro',
    async (wrapper, user) => {
      const api = {
        list: jest.fn(async () => ({ ok: true, value: { sessions: [], nextCursor: null } })),
        deleteOne: jest.fn(),
        deleteAll: jest.fn(),
        readMessages: jest.fn(),
      };
      const screen = await render(
        <RomanConversationsScreen
          navigation={nav}
          api={api}
          sessionUserId={() => user.id}
          captureBinding={async () => ({ subject: `sub:${user.id}`, epoch: authEpoch() })}
        />,
        { wrapper },
      );
      await waitFor(() => expect(screen.getByTestId('roman-chats-empty')).toBeTruthy());
      return () => String(screen.getByTestId('roman-chats-intro').props.children);
    },
    // Main states the exception here for every account (m#723 K1 removes it for a coach and a client with no coach).
    () => ROMAN_CHATS_COPY.intro,
  ],
];
const ROWS = LIST.flatMap(([place, mount, today]) =>
  ACCOUNTS.flatMap(([account, user, coached]) =>
    SWITCHES.map((sw) => [place, account, sw, mount, user, today(coached), coached] as const),
  ),
);

describe('the crisis sentence follows the Roman safety-reply exception (CRISIS-APP-COPY, FIX725)', () => {
  it.each(ROWS)('%s, %s, switch %s', async (_place, _account, sw, mount, user, today, coached) => {
    mockUser = user;
    // 'failed read': the switch loaded true, then a refresh failed.
    mockGetFlags.mockReset().mockResolvedValueOnce(flags(sw !== 'off')).mockRejectedValue(new Error('offline'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const read = await mount(wrapper, user);
    const shown = (on: boolean) => (on && coached ? today.replace(EXCEPTION, `${EXCEPTION} ${TOLD}`) : today);

    await waitFor(() => expect(qc.getQueryState(featureFlagsKeys.all)?.status).toBe('success'));
    await waitFor(() => expect(read()).toBe(shown(sw !== 'off')));
    if (sw === 'failed read') {
      await act(async () => {
        await qc.refetchQueries({ queryKey: featureFlagsKeys.all });
      });
      expect(qc.getQueryState(featureFlagsKeys.all)?.status).toBe('error');
      await waitFor(() => expect(read()).toBe(today));
    }
    expect(count(read(), TOLD)).toBe(sw === 'on' && coached ? 1 : 0);
    expect(count(read(), EXCEPTION)).toBe(today.includes(EXCEPTION) ? 1 : 0);
    qc.clear();
  });

  it('the sentence is word for word the approved one; a text without the exception never gets it', () => {
    expect(ROMAN_CRISIS_TOLD_SENTENCE).toBe(TOLD);
    expect(ROMAN_SAFETY_EXCEPTION).toBe(EXCEPTION);
    const noCoach = 'Your Roman conversations are kept until you delete them or your account';
    expect(withCrisisSentence(noCoach, true)).toBe(noCoach);
  });

  it('the list is complete: outside tests only these files state the exception', () => {
    const root = path.resolve(__dirname, '../..');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? (d.name === '__tests__' ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)],
      );
    const files = walk(root)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('sees the message that prompted it'))
      .map((f) => path.relative(root, f).split(path.sep).join('/'))
      .sort();
    // romanCrisisSentence.ts holds the exception only to find it.
    expect(files).toEqual(['lib/romanCrisisSentence.ts', 'screens/settings/romanChatsCopy.ts', 'screens/trustCenterSharing.ts']);
  });

  it('only the two screens apply the sentence, both through the shared hook', () => {
    const root = path.resolve(__dirname, '../..');
    const uses = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    for (const f of ['screens/TrustCenterScreen.tsx', 'screens/settings/RomanConversationsScreen.tsx']) {
      expect(uses(f)).toMatch(/useRomanCrisisSentence\(\)/);
      expect(uses(f)).not.toMatch(/withCrisisSentence|roman_crisis_alert/);
    }
  });
});
