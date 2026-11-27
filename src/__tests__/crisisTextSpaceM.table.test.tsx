/**
 * CRISIS-TEXT-SPACE-M (owner #200-S1 op 1, whose community text list names space chat first; operator rulings R1-R10,
 * w203dq 11-27): the space chat half of the crisis line. When the server's crisis check matched the poster's own space
 * chat text, her send answer (or the 422 of a text it refused for its words) carries `crisis_flag: true` at its top
 * level (backend b#1232, CONTRACT 6755386095), and she sees the approved 911 / 988 line at once, wherever she is in the
 * app; a marked refusal shows today's one "Please rephrase" alert with the line first, never a second alert.
 * Drives the real CommunitySpaceChatScreen, useSpaceChat, queue (spaceChatOutbox) and spaceChatApi with
 * communitySpaceChat and communityVoiceNotes on; only the wire (services/api), the device store, the user cache, the
 * logger, Sentry and analytics are stubbed, as CommunitySpaceChatScreen.test.tsx and crisisTextM.table.test.tsx do.
 * Every answer is copied key for key from the server (growth-project-backend main 27be6474):
 *   community-messages.service.ts send :491, its answer type :500, screenText('space_chat', ...) :511, the answer :572
 *   `{ ...sent, ...(alert ? { high_alert_reach } : {}), ...crisisField(screen) }` with sent = { message: view(created) }
 *   (view :189-218 with no `chat`: no sender, no parent); a resend with the same Idempotency-Key :527 / :537 -> replay
 *   :577-592, which spreads crisisField again (:592);
 *   community-safety.service.ts CONTENT_REJECTED :35-40, crisisField :76-77, screenText :268-283 (the 422 with the flag
 *   beside CONTENT_REJECTED :280), a photo refusal :291-300 (the flag beside PHOTO_NOT_ALLOWED / CAPTION_NOT_ALLOWED :298);
 *   error-details.ts :53 and :98-99 (the 422 envelope keeps crisis_flag only when it is true).
 * Ordinary gym words only ([R22]): the phone never reads the text; the flag comes only from the stubbed answer.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { authEvents } from '../utils/authEvents';

const mockDisk = new Map<string, string>();
jest.mock('../storage/mmkv', () => ({
  ...jest.requireActual('../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
// The user cache's in-memory mirror (lib/userCache readUserCacheSync): who is signed in now, for crisisLineOwner.
const mockCached: { current: { id: string } | null } = { current: { id: 'me-1' } };
jest.mock('../lib/userCache', () => ({ ...jest.requireActual('../lib/userCache'), readUserCacheSync: () => mockCached.current }));
jest.mock('../utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../lib/analytics', () => ({ ...jest.requireActual('../lib/analytics'), track: jest.fn(), capture: jest.fn() }));
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../config/featureFlags', () => ({ featureFlags: { communitySpaceChat: true, communityVoiceNotes: true } }));
const mockParams: { current: Record<string, unknown> } = { current: { cohortId: 'c-every' } };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: ['CommunityTab', 'CommunitySpaceChat'] }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label }: { label?: string }) => <Text accessibilityLabel={label ?? 'Open space list'}>list</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaView: ({ children, style }: { children?: unknown; style?: unknown }) => createElement(View, { style }, children),
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});
const mockNet = { isOnline: true };
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
jest.mock('../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-every', workspace_id: 'ws', name: 'Everyone', is_default: true, kind: 'default', member_count: 24, my_role: mockRole },
      { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole },
    ] },
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string; durationMs: number }) => <Text testID={p.testID}>{`player ${p.durationMs}`}</Text>;
});
jest.mock('../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn(async () => ({ deleted: true })) } }));
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../components/community/VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID} accessibilityLabel="Report or block">menu</Text>;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../screens/community/CommunitySpaceChatScreen').default;
const { spaceOutbox, startSpaceOutbox } = require('../components/community/space-chat/spaceChatOutbox');
const { signOutQueues } = require('../services/signOutQueues');
const { logger } = require('../utils/logger');
const sentry = require('../services/sentry');
const analytics = require('../lib/analytics');

/** The approved line (guideline 7's 911 and 988 sentences, owner 10-01 09:07): app text, pinned here on purpose. */
const LINE = 'If you are in danger, call 911. If you are struggling emotionally, call or text 988.';
/** The phone's own reason for a text refused for its words (communityErrors BY_CODE, REJECTED_WORDS.message). */
const REASON = 'This was not posted because it appears to contain abusive or explicit language. Your draft is kept so you can rephrase it.';
/** CONTENT_REJECTED.message (community-safety.service.ts:35-40): the server's own words, never shown by the space chat. */
const REFUSED = 'This message was not posted because it appears to contain abusive or explicit language. Please rephrase it.';
const NOW = '2026-11-27T12:00:00.000Z';
const WORDS = 'Leg day done, new squat best';
type Flag = Record<string, unknown>;
const FLAGGED: Flag = { crisis_flag: true };

const msg = (id: string, at: string, who: { id: string; name: string; is_coach?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-every', sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const COACH = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO = { id: 'u-2', name: 'jo b.' };
/** The send answer (:572): view(created) with no `chat` (:189-218: no sender, no parent), then crisisField. */
const answer = (body: string, flag: Flag = {}, extra: Record<string, unknown> = {}) => ({
  message: {
    id: 'm9', cohort_id: 'c-every', sender_user_id: 'me-1', body, kind: 'text', created_at: NOW, updated_at: NOW,
    edited: false, deleted: false, plan_context: null, parent_message_id: null, voice_note: null, ...extra,
  },
  ...flag,
});
/** The axios error for an HTTP answer: the 422 envelope (http-exception filter) with the allowlisted flag beside it. */
const httpError = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`Request failed with status code ${status}`), {
  isAxiosError: true, response: { status, headers: {}, data: { statusCode: status, timestamp: NOW, path: '/community/cohorts/c-every/messages', ...data } },
});
/** screenText :280: UnprocessableEntityException({ ...CONTENT_REJECTED, crisis_flag: true }) on a match, else CONTENT_REJECTED. */
const refused = (flag: Flag) => httpError(422, { code: 'community.content.rejected', message: REFUSED, error: 'content_rejected', ...flag });
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' }; // the answer was lost on the way

let page: unknown[] = [];
let readAnswer: unknown = { last_read_at: '2026-11-27T09:00:00.000Z', last_read_message_id: 'm1' };
type Post = (url: string, body: { body: string }) => Promise<unknown>;
/** What a text send answers (the other posts, read marks, answer ok). */
let onSend: Post = async (_u, b) => ({ data: answer(b.body) });
const sends = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'));
const keyOf = (i: number) => (sends()[i][2] as { headers: Record<string, string> }).headers['Idempotency-Key'];
let alert: jest.SpyInstance;
/** Every native alert the space chat raised, as its arguments. */
const alerts = () => alert.mock.calls;
const lineAlerts = () => alerts().filter((c) => String(c[1] ?? '').includes(LINE) || String(c[0] ?? '').includes(LINE));
const deferred = () => {
  let resolve: (v: unknown) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
};
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((res) => setTimeout(res, 0)); });
const setToken = (t: string) => (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', t);

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  setToken('tok-me-1');
  mockCached.current = { id: 'me-1' };
  mockNet.isOnline = true;
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-every' };
  page = [msg('m3', '2026-11-27T10:05:00.000Z', JO), msg('m1', '2026-11-27T08:00:00.000Z', COACH)];
  readAnswer = { last_read_at: '2026-11-27T09:00:00.000Z', last_read_message_id: 'm1' };
  onSend = async (_u, b) => ({ data: answer(b.body) });
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: readAnswer };
    if (url.endsWith('/members')) return { data: { members: [], next_cursor: null } };
    return { data: { messages: page, next_before: null } };
  });
  mockApi.post.mockReset().mockImplementation((url: string, body: { body: string }) =>
    (url.endsWith('/messages') ? onSend(url, body) : Promise.resolve({ data: { ok: true } })));
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
  (logger.log as jest.Mock).mockClear(); (logger.warn as jest.Mock).mockClear(); (logger.error as jest.Mock).mockClear();
  (sentry.captureError as jest.Mock).mockClear(); (analytics.track as jest.Mock).mockClear();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
let client: QueryClient;
afterEach(() => {
  alert.mockRestore();
  client?.clear();
});

type R = Awaited<ReturnType<typeof render>>;
const open = async (): Promise<R> => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await r.findByTestId('space-chat-row-m3');
  return r;
};
const reopen = async (): Promise<R> => {
  const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await r.findByTestId('space-chat-row-m3');
  return r;
};
const field = (r: R) => r.getByTestId('space-chat-composer-field');
const write = async (r: R, words: string) => {
  await fireEvent.changeText(field(r), words);
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
};
/** Press and hold a row, then Reply (iOS runs the sheet's action in the Modal's onDismiss; the jest Modal never calls it). */
const replyTo = async (r: R, id: string) => {
  await fireEvent(r.getByTestId(`space-chat-row-${id}`), 'longPress');
  let node = r.getByTestId('space-chat-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  const dismiss = node?.props.onDismiss as () => void;
  await fireEvent.press(r.getByTestId('space-chat-sheet-reply'));
  await act(async () => { dismiss?.(); });
};
/** The config of today's send (spaceChatApi.ts:109-114): the key header, the binding, the session, the signal; nothing else. */
const expectBaseSend = (i: number, url: string, body: Record<string, unknown>) => {
  const [u, b, cfg] = sends()[i] as [string, unknown, Record<string, unknown>];
  expect(u).toBe(url);
  expect(b).toEqual(body);
  expect(Object.keys(cfg).sort()).toEqual(['_sessionGeneration', 'accountBinding', 'headers', 'signal']);
  expect(Object.keys(cfg.headers as object)).toEqual(['Idempotency-Key']);
  expect(typeof keyOf(i)).toBe('string');
};
/** The hold of R5 (the queue's in-memory ids of refused rows whose one alert showed): absent before this job. */
const held = (localId: string): boolean => !!spaceOutbox.refusalShown?.(localId);

describe('CRISIS-TEXT-SPACE-M: the poster of a space chat text the crisis check marked sees the line at once', () => {
  it('C1 (L1): a marked answer: the message posts as today and one alert shows the line, no title, the system OK', async () => {
    onSend = async (_u, b) => ({ data: answer(b.body, FLAGGED) });
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toEqual(['', LINE]);
    expect(sends()).toHaveLength(1);
    expectBaseSend(0, '/community/cohorts/c-every/messages', { body: WORDS });
    await settle();
    expect(r.queryByText('Not sent')).toBeNull();
    expect(r.queryByText('Sending…')).toBeNull();
    expect(alerts()).toHaveLength(1);
    expect(sends()).toHaveLength(1);
  });

  it.each([
    ['no field', {}],
    ['false', { crisis_flag: false }],
    ['null', { crisis_flag: null }],
    ['"true"', { crisis_flag: 'true' }],
    ['1', { crisis_flag: 1 }],
  ])('C2 (U): an answer with %s: no alert, the same send', async (_l, flag) => {
    onSend = async (_u, b) => ({ data: answer(b.body, flag as Flag) });
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    expectBaseSend(0, '/community/cohorts/c-every/messages', { body: WORDS });
    expect(r.queryByText('Not sent')).toBeNull();
    expect(alerts()).toEqual([]);
  });

  it('C2 (U): crisis_flag only inside the message, never at the top level: no alert', async () => {
    onSend = async (_u, b) => ({ data: answer(b.body, {}, { crisis_flag: true }) });
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    expect(alerts()).toEqual([]);
  });

  it.each([
    ['a reply (parent_message_id)', 'client', 'c-every', 'm3'],
    ['the coach\'s own text', 'owner', 'c-every', null],
    ['a member\'s reply in a space only the coach posts in (Announcements)', 'client', 'c-ann', 'm1'],
  ])('C3 (L4): %s: posts as today, and one alert with the line', async (_l, role, cohortId, parentId) => {
    mockRole = role;
    mockParams.current = { cohortId };
    if (role === 'owner') {
      mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
      mockCached.current = { id: 'coach-1' };
      setToken('tok-coach-1');
    }
    const sender = role === 'owner' ? 'coach-1' : 'me-1';
    onSend = async (_u, b) => ({ data: answer(b.body, FLAGGED, { cohort_id: cohortId, sender_user_id: sender, parent_message_id: parentId }) });
    const r = await open();
    if (parentId) await replyTo(r, parentId);
    await write(r, 'Great session today');
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toEqual(['', LINE]);
    expectBaseSend(0, `/community/cohorts/${cohortId}/messages`, parentId
      ? { body: 'Great session today', parent_message_id: parentId } : { body: 'Great session today' });
    await settle();
    expect(alerts()).toHaveLength(1);
  });

  it('C4 (R1): a marked refusal, the box empty: the words come back and ONE alert: Please rephrase, the line, a blank line, today\'s reason', async () => {
    onSend = async () => { throw refused(FLAGGED); };
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(field(r).props.value).toBe(WORDS));
    await settle();
    expect(alerts()).toEqual([['Please rephrase', `${LINE}\n\n${REASON}`]]);
    expect(r.queryByText('Not sent')).toBeNull();
    expect(r.queryByLabelText('Try again')).toBeNull();
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '[]').not.toContain(WORDS));
    expect(sends()).toHaveLength(1);
  });

  it('C5 (U): a refusal without the mark: the words back with today\'s one alert; a newer draft: none until the box empties', async () => {
    onSend = async () => { throw refused({}); };
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(field(r).props.value).toBe(WORDS));
    await settle();
    expect(alerts()).toEqual([['Please rephrase', REASON]]);
    await fireEvent.changeText(field(r), '');
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    await write(r, 'Second try at the plan');
    await waitFor(() => expect(sends()).toHaveLength(2));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { later.reject(refused({})); });
    expect(await r.findByText(REASON)).toBeTruthy();
    expect(alerts()).toHaveLength(1);
    await fireEvent.changeText(field(r), '');
    await waitFor(() => expect(field(r).props.value).toBe('Second try at the plan'));
    expect(alerts()).toEqual([['Please rephrase', REASON], ['Please rephrase', REASON]]);
  });

  it('C6 (R2): a marked refusal with a newer draft in the box: the one alert at once; the row as today; no second alert when the words come back', async () => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { later.reject(refused(FLAGGED)); });
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toEqual(['Please rephrase', `${LINE}\n\n${REASON}`]);
    expect(await r.findByText(REASON)).toBeTruthy(); // the row's reason: today's words only
    expect(r.queryAllByText(/911|988/)).toHaveLength(0); // no line in the row
    expect(r.getByLabelText(`Dana Reyes, Not sent. ${WORDS}`)).toBeTruthy();
    expect(r.getByLabelText('Delete')).toBeTruthy();
    expect(r.queryByLabelText('Try again')).toBeNull();
    expect(field(r).props.value).toBe('A newer draft');
    await fireEvent.changeText(field(r), '');
    await waitFor(() => expect(field(r).props.value).toBe(WORDS));
    await settle();
    expect(alerts()).toHaveLength(1);
  });

  it.each([
    ['the space closed before the answer', 'answer'],
    ['the space closed before the answer', 'refusal'],
    ['written with no signal, sent on reconnect with no space chat open', 'answer'],
    ['written with no signal, sent on reconnect with no space chat open', 'refusal'],
  ])('C7 (L2, R3): %s: a marked %s shows its one alert at once; back in the space the words return with no second alert', async (how, kind) => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const offline = how.startsWith('written');
    mockNet.isOnline = !offline;
    const r = await open();
    await write(r, WORDS);
    if (offline) {
      expect(await r.findByText('Waiting to send')).toBeTruthy();
      expect(sends()).toHaveLength(0);
    } else await waitFor(() => expect(sends()).toHaveLength(1));
    await r.unmount();
    if (offline) {
      mockNet.isOnline = true;
      await act(async () => { (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: true, isInternetReachable: true }); });
      await waitFor(() => expect(sends()).toHaveLength(1));
    }
    await act(async () => { if (kind === 'answer') later.resolve({ data: answer(WORDS, FLAGGED) }); else later.reject(refused(FLAGGED)); });
    await settle();
    expect(alerts()).toEqual([kind === 'answer' ? ['', LINE] : ['Please rephrase', `${LINE}\n\n${REASON}`]]);
    const back = await reopen();
    if (kind === 'refusal') await waitFor(() => expect(field(back).props.value).toBe(WORDS));
    await settle();
    expect(alerts()).toHaveLength(1);
    expect(sends()).toHaveLength(1);
  });

  it('C8 (L3): the first answer lost, Try again sends the same key; the replay carries the mark: the line once, no third send', async () => {
    let first = true;
    onSend = async (_u, b) => {
      if (first) { first = false; throw NO_ANSWER; }
      return { data: answer(b.body, FLAGGED) }; // the replay (:527 -> :592) answers the first row with the field again
    };
    const r = await open();
    await write(r, WORDS);
    expect(await r.findByText('Not sent')).toBeTruthy();
    expect(alerts()).toEqual([]);
    await fireEvent.press(r.getByLabelText('Try again'));
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toEqual(['', LINE]);
    expect(sends()).toHaveLength(2);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(sends()[1][1]).toEqual({ body: WORDS });
    await settle();
    expect(sends()).toHaveLength(2);
    expect(alerts()).toHaveLength(1);
  });
});

describe('CRISIS-TEXT-SPACE-M: nobody else ever sees the line or the fact of a match', () => {
  const signOut = async () => { mockCached.current = null; await act(async () => { authEvents.emit('logout'); }); };
  const anotherAccount = async () => { await signOut(); setToken('tok-other-9'); mockCached.current = { id: 'other-9' }; };
  const cacheOnly = async () => { mockCached.current = { id: 'other-9' }; }; // the user cache names another account, no event

  it.each([
    ['a sign-out', 'answer', signOut], ['a sign-out', 'refusal', signOut],
    ['another account signed in', 'answer', anotherAccount], ['another account signed in', 'refusal', anotherAccount],
    ['the user cache naming another account', 'answer', cacheOnly], ['the user cache naming another account', 'refusal', cacheOnly],
  ])('C9 (X1): %s between the request and its marked %s: no line for anyone', async (_l, kind, between) => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await between();
    await act(async () => { if (kind === 'answer') later.resolve({ data: answer(WORDS, FLAGGED) }); else later.reject(refused(FLAGGED)); });
    await settle();
    expect(lineAlerts()).toEqual([]);
    // A sign-out or a new sign-in drops the text (the queue's reset): no alert of any kind. With only the cache moved the
    // box (still mounted as Dana) takes the words back with today's alert, as at base, and never the line.
    expect(alerts()).toEqual(between === cacheOnly && kind === 'refusal' ? [['Please rephrase', REASON]] : []);
    await r.unmount();
  });

  it('C9 (R8): the sign-out\'s one try sends her waiting text while she is still signed in: a marked answer shows her the line once, on her own phone', async () => {
    mockNet.isOnline = false;
    const r = await open();
    await write(r, WORDS);
    expect(await r.findByText('Waiting to send')).toBeTruthy();
    await r.unmount();
    onSend = async (_u, b) => ({ data: answer(b.body, FLAGGED) });
    await act(async () => { for (const q of signOutQueues()) await q.send('me-1'); }); // services/authActions sendUnsyncedLogs
    await settle();
    expect(sends()).toHaveLength(1);
    expect(alerts()).toEqual([['', LINE]]);
    await signOut();
    await settle();
    expect(alerts()).toHaveLength(1);
  });
});

describe('CRISIS-TEXT-SPACE-M: what stays (C10, LIFETIME)', () => {
  const hasIt = (s: string) => s.includes('crisis_flag') || s.includes(LINE) || s.includes('call 911');
  const everyStore = async () => {
    const disk = [...mockDisk.entries()].map(([k, v]) => `${k}=${v}`);
    const queries = client.getQueryCache().getAll().map((q) => JSON.stringify(q.state.data) ?? '');
    const keys = await AsyncStorage.getAllKeys();
    const stored = await Promise.all(keys.map(async (k) => `${k}=${await AsyncStorage.getItem(k)}`));
    const calls = [
      ...(logger.log as jest.Mock).mock.calls, ...(logger.warn as jest.Mock).mock.calls, ...(logger.error as jest.Mock).mock.calls,
      ...(sentry.captureError as jest.Mock).mock.calls, ...(sentry.captureErrorWithoutPii as jest.Mock).mock.calls,
      ...(analytics.track as jest.Mock).mock.calls,
    ].map((c) => JSON.stringify(c, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v)) ?? '');
    return [...disk, ...queries, ...stored, ...calls];
  };
  /** Today's keys of a saved row (spaceChatOutbox PendingRow): the hold is never one of them. */
  const ROW_KEYS = ['body', 'cohortId', 'createdAt', 'key', 'localId', 'reason', 'state'];

  it('C10: after a marked answer and a marked refusal no store holds the key or the line; the hold ends when the words come back', async () => {
    let n = 0;
    onSend = async (_u, b) => { n += 1; if (n === 1) return { data: answer(b.body, FLAGGED) }; throw refused(FLAGGED); };
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    await write(r, 'Second set felt heavy');
    await waitFor(() => expect(field(r).props.value).toBe('Second set felt heavy'));
    await settle();
    expect((await everyStore()).filter(hasIt)).toEqual([]);
    expect(held(keyOf(1))).toBe(false); // the words went back: its id left the hold with its row
  });

  it('C10: the refused row saved on the device keeps today\'s keys only; the hold ends on Delete', async () => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { later.reject(refused(FLAGGED)); });
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '').toContain('"reason":"rejected"'));
    const saved = JSON.parse(mockDisk.get('space_outbox_me-1') ?? '[]') as Array<Record<string, unknown>>;
    expect(saved.map((row) => Object.keys(row).sort())).toEqual([ROW_KEYS]);
    expect((await everyStore()).filter(hasIt)).toEqual([]);
    if (spaceOutbox.refusalShown) expect(held(keyOf(0))).toBe(true); // the hold exists only with this job
    await fireEvent.press(r.getByLabelText('Delete'));
    await waitFor(() => expect(r.queryByText(REASON)).toBeNull());
    expect(held(keyOf(0))).toBe(false);
    expect((await everyStore()).filter(hasIt)).toEqual([]);
  });

  it.each([
    ['a sign-out (authEvents logout)', async () => { await act(async () => { authEvents.emit('logout'); }); }],
    ['the queue starting for another account', async () => { await act(async () => { startSpaceOutbox('other-9'); }); }],
  ])('C10: the hold ends on %s', async (_l, end) => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { later.reject(refused(FLAGGED)); });
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '').toContain('"reason":"rejected"'));
    if (spaceOutbox.refusalShown) expect(held(keyOf(0))).toBe(true);
    await r.unmount();
    await end();
    expect(held(keyOf(0))).toBe(false);
  });

  it('C10 (R4): a cold start with the refused row saved on the device: the words come back with today\'s alert only', async () => {
    const later = deferred();
    onSend = () => later.p as Promise<unknown>;
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { later.reject(refused(FLAGGED)); });
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '').toContain('"reason":"rejected"'));
    const kept = mockDisk.get('space_outbox_me-1') as string;
    const before = alerts().length;
    await r.unmount();
    // A cold start: memory is gone (the queue, its hold and the draft's copy); the device keeps what was saved.
    await act(async () => { authEvents.emit('logout'); });
    await settle();
    mockDisk.clear();
    mockDisk.set('space_outbox_me-1', kept);
    const again = await open();
    await waitFor(() => expect(field(again).props.value).toBe(WORDS));
    expect(alerts().slice(before)).toEqual([['Please rephrase', REASON]]);
    expect(sends()).toHaveLength(1);
  });
});

describe('CRISIS-TEXT-SPACE-M: the key anywhere but her own send answer shows nothing', () => {
  it('C11 (X3): a list page, an older page, a row, a row\'s parent and a realtime refresh that carry the key: no alert', async () => {
    readAnswer = { last_read_at: '2026-11-26T00:00:00.000Z', last_read_message_id: 'm0a' };
    const older = [msg('m0b', '2026-11-26T12:00:00.000Z', JO, { crisis_flag: true }), msg('m0a', '2026-11-26T08:00:00.000Z', JO)];
    page = [
      msg('m4', '2026-11-27T10:10:00.000Z', JO, { crisis_flag: true, body: 'Count me in', parent_message_id: 'm1',
        parent: { id: 'm1', gone: false, kind: 'text', sender_name: 'Sam Okafor', snippet: 'body m1', voice_duration_ms: null, crisis_flag: true } }),
      ...page,
    ];
    mockApi.get.mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => (url.endsWith('/read') ? { data: readAnswer }
      : { data: cfg?.params?.before ? { messages: older, next_before: null, crisis_flag: true } : { messages: page, next_before: 'cur-1', crisis_flag: true } }));
    const r = await open();
    await r.findByTestId('space-chat-row-m0b');
    await act(async () => { await client.refetchQueries(); }); // a realtime ping refetches the list
    await settle();
    expect(alerts()).toEqual([]);
    await r.unmount();
  });

  it('C11 (X3): a send answer whose message carries the key but whose top level does not: no alert', async () => {
    onSend = async (_u, b) => ({ data: { message: { ...answer(b.body).message, crisis_flag: true } } });
    const r = await open();
    await write(r, WORDS);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    expect(alerts()).toEqual([]);
  });

  it('C12 (X2): a 422 with the mark and another code (CAPTION_NOT_ALLOWED, :291-300): the line alone once; the row as today', async () => {
    onSend = async () => { throw httpError(422, { code: 'CAPTION_NOT_ALLOWED', message: 'Not allowed', crisis_flag: true }); };
    const r = await open();
    await write(r, WORDS);
    expect(await r.findByText('Not sent')).toBeTruthy();
    await settle();
    expect(alerts()).toEqual([['', LINE]]);
    expect(r.getByLabelText('Try again')).toBeTruthy();
    expect(r.queryByText(REASON)).toBeNull();
    expect(field(r).props.value).toBe('');
  });

  it.each([[403], [404], [409], [500]])('C13 (X3): a %s whose body carries the key: no alert; a 403 or 404 still closes the space', async (status) => {
    onSend = async () => { throw httpError(status, { code: 'community.cohort.no_access', message: 'No', crisis_flag: true }); };
    const r = await open();
    await write(r, WORDS);
    if (status === 403 || status === 404) expect(await r.findByTestId('space-chat-no-access')).toBeTruthy(); // still closes the space
    else expect(await r.findByText('Not sent')).toBeTruthy();
    await settle();
    expect(lineAlerts()).toEqual([]);
    expect(alerts()).toEqual([]);
  });
});

// C14 (R9): the class walk. Every api.post, api.put or api.patch to /community/cohorts/<id>/messages (S1) or
// /community/messages/<id> (S2) in code under src sits in a file that imports a reader of the mark from
// lib/communityCrisisLine. Test files, fixtures and .md are not code (crisisTextM.oneCopy.test.ts's rule).
const SRC = join(__dirname, '..');
const notCode = (name: string): boolean =>
  name === '__tests__' || name === '__fixtures__' || /\.test\.tsx?$/.test(name) || name.endsWith('.md');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    if (notCode(f)) return [];
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx)$/.test(f) ? [p] : [];
  });
const WRITE = /api\.(post|put|patch)\s*(<[^>(]*>)?\(\s*[`'"]\/?community\/(cohorts\/[^`'"/]+\/messages|messages\/[^`'"/]+)[`'"]/;
const READER = /import\s*\{[^}]*\b(crisisFlagIn|crisisFlagInError|showCrisisLineFor)\b[^}]*\}\s*from\s*['"][^'"]*lib\/communityCrisisLine['"]/;
/** The files that write S1 or S2, and those of them that read no mark. */
function spaceWriters(files: Array<{ name: string; text: string }>): { writers: string[]; unread: string[] } {
  const writers = files.filter((f) => WRITE.test(f.text)).map((f) => f.name);
  return { writers, unread: files.filter((f) => writers.includes(f.name) && !READER.test(f.text)).map((f) => f.name) };
}

describe('C14 (R9): every phone writer of S1 and S2 reads the mark through lib/communityCrisisLine', () => {
  it('the walk over code under src: spaceChatApi.ts writes S1 and reads the mark; no writer reads none', () => {
    const files = walk(SRC).map((p) => ({ name: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.length).toBeGreaterThan(500);
    const { writers, unread } = spaceWriters(files);
    expect(writers).toContain(join('components', 'community', 'space-chat', 'spaceChatApi.ts'));
    expect(unread).toEqual([]);
  });

  it('the walk would catch a writer added without a reader', () => {
    const plain = "return api.post<unknown>(\n  `/community/cohorts/${cohortId}/messages`, { body });";
    const edit = "api.patch(`/community/messages/${id}`, { body })";
    const withReader = `import { showCrisisLineFor } from '../../../lib/communityCrisisLine';\n${plain}`;
    expect(spaceWriters([{ name: 'x.ts', text: plain }]).unread).toEqual(['x.ts']);
    expect(spaceWriters([{ name: 'y.ts', text: edit }]).unread).toEqual(['y.ts']);
    expect(spaceWriters([{ name: 'z.ts', text: withReader }]).unread).toEqual([]);
    expect(spaceWriters([{ name: 'r.ts', text: 'api.post(`/community/cohorts/${id}/read`, {})' }]).writers).toEqual([]);
  });
});
