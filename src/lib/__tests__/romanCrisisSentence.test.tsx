/**
 * CRISIS-APP-COPY (owner op 1, 2026-10-15): wherever the app states the Roman
 * safety-reply exception, the approved crisis sentence follows it, exactly
 * while the server's FEATURE_ROMAN_CRISIS_ALERT is on (GET /me/feature-flags
 * roman_crisis_alert) and never while it is off.
 *
 * LIST is every place in this repo (search-backed, see the CRISISAPP-M PR):
 * the Trust Center "Who can see your data" Roman bullet and the intro of Your
 * conversations with Roman. Each row renders the real screen with the flag off
 * and on. Off: the sentence is absent and the text is exactly today's. On: the
 * sentence is present exactly once, directly after the exception.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { authEpoch } from '../../services/accountBinding';
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
// A client with a coach: both places state the exception.
jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', email: 'client@example.test', role: 'student', coach_id: 'coach-1' }),
}));
let mockCrisisOn = false;
jest.mock('../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { roman_crisis_alert: mockCrisisOn } }) }));

const TrustCenterScreen = require('../../screens/TrustCenterScreen').default;
const RomanConversationsScreen = require('../../screens/settings/RomanConversationsScreen').default;

const EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const TOLD =
  'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';
const count = (text: string, part: string) => text.split(part).length - 1;

const nav = { goBack: jest.fn(), navigate: jest.fn() };
type Place = [label: string, read: () => Promise<string>, today: string];
const LIST: Place[] = [
  [
    'Trust Center, Who can see your data',
    async () => {
      const screen = await render(<TrustCenterScreen navigation={nav} />);
      return String((await screen.findByText(/^Not your coach —/)).props.children);
    },
    `Not your coach — your Roman conversations, which are kept until you delete them or your account. ${EXCEPTION}`,
  ],
  [
    'Your conversations with Roman, intro',
    async () => {
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
          sessionUserId={() => 'client-1'}
          captureBinding={async () => ({ subject: 'sub:client-1', epoch: authEpoch() })}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('roman-chats-empty')).toBeTruthy());
      return String(screen.getByTestId('roman-chats-intro').props.children);
    },
    ROMAN_CHATS_COPY.intro,
  ],
];
type Row = [label: string, on: boolean, read: () => Promise<string>, today: string];
const ROWS: Row[] = LIST.flatMap(([label, read, today]): Row[] => [
  [label, false, read, today],
  [label, true, read, today],
]);

describe('the crisis sentence follows the Roman safety-reply exception (CRISIS-APP-COPY)', () => {
  afterEach(() => {
    mockCrisisOn = false;
  });

  it.each(ROWS)('%s, roman_crisis_alert on: %s', async (_label, on, read, today) => {
    mockCrisisOn = on;
    const text = await read();
    expect(count(text, EXCEPTION)).toBe(1);
    expect(count(text, TOLD)).toBe(on ? 1 : 0);
    expect(text).toBe(on ? today.replace(EXCEPTION, `${EXCEPTION} ${TOLD}`) : today);
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
});
