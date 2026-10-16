// FIXC3B: the Style B outbox at the real sign-out (R5) and over every way the server refuses a send (R6, backend
// src/messaging). HTTP is mocked; storage, sign-out and the error mapping are the real ones.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from '../authActions';
import { drainOutbox, readOutbox, releaseOutbox, sendViaOutbox, takeBackRefused } from '../messageOutbox';
import { cacheStorage } from '../../storage/mmkv';

const mockAccount = { id: 'client-A' };
const mockSend = jest.fn();
jest.mock('../../api/messagingV2Api', () => ({ ...jest.requireActual('../../api/messagingV2Api'), messagingV2Api: { sendMessage: (...a: unknown[]) => mockSend(...a) } }));
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => mockAccount, readUserCache: async () => mockAccount, clearUserCache: async () => undefined, patchUserCache: async () => undefined }));
jest.mock('../api', () => ({ usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) }, profileApi: { get: jest.fn() } }));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../db/fastingDb', () => ({ getActiveFast: jest.fn(async () => null), getFastingHistory: jest.fn(async () => []) }));
const NetInfo = jest.requireMock('@react-native-community/netinfo');
const fail = (status?: number, code?: string) => Object.assign(new Error('send failed'), { isAxiosError: true, ...(status ? { response: { status, data: code ? { code } : {} } } : {}) });
type Sent = { body: string; clientMessageId: string; replyToId: string | null };
const sent = () => mockSend.mock.calls.map(([, p]) => p as Sent);
// A sign-in as `id` (the drain hook's cleanup drops the last account's copy in memory), then its first drain.
const signIn = (id: string) => { releaseOutbox(); mockAccount.id = id; return drainOutbox(id); };
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  NetInfo.__reset();
  await signIn('client-A');
  mockSend.mockImplementation(async (_scope: unknown, p: Sent) => ({ id: `srv-${p.clientMessageId}`, body: p.body }));
});

describe('R5: a queued message stays recoverable until the server has it or the client knowingly discards it', () => {
  it('offline send, sign out, sign in: another account never sees or sends it; the same account delivers it once', async () => {
    NetInfo.__setState({ isConnected: false, isInternetReachable: false });
    mockSend.mockRejectedValueOnce(fail());
    await sendViaOutbox('client-A', 'see you friday', null);
    const key = readOutbox('client-A')[0].key;
    await cacheStorage.set('messages_thread_client:client-A', '[]');
    await signOut('client-A');
    expect(await cacheStorage.getStringAsync('messages_thread_client:client-A')).toBeUndefined(); // control: the wipe ran
    NetInfo.__setState({ isConnected: true, isInternetReachable: true });
    mockSend.mockClear();
    await signIn('client-B');
    expect([readOutbox('client-B'), readOutbox('client-A'), mockSend.mock.calls]).toEqual([[], [], []]);
    await signIn('client-A');
    await drainOutbox('client-A');
    expect(sent()).toEqual([{ body: 'see you friday', clientMessageId: key, replyToId: null }]);
    expect(await AsyncStorage.getItem('messages_thread_outbox_client-A')).toBe('[]');
  });
});

describe('R6: an ordered queue always keeps a working way forward when its first message can never be accepted', () => {
  it.each([
    ['no answer', 'held', fail()],
    ['500', 'held', fail(500)],
    ['503 messaging.feature_disabled', 'held', fail(503, 'messaging.feature_disabled')],
    ['429 rate limit', 'held', fail(429)],
    ['408 timeout', 'held', fail(408)],
    ['401 session', 'held', fail(401)],
    ['403 blocked', 'held', fail(403)],
    ['409 NO_COACH_ASSIGNED', 'held', fail(409, 'NO_COACH_ASSIGNED')],
    ['409 messaging.reply_target_unavailable', 'unquoted', fail(409, 'messaging.reply_target_unavailable')],
    ['400 validation', 'refused', fail(400)],
    ['400 messaging.idempotency_key_invalid', 'refused', fail(400, 'messaging.idempotency_key_invalid')],
    ['400 messaging.idempotency_key_mismatch', 'refused', fail(400, 'messaging.idempotency_key_mismatch')],
    ['409 messaging.idempotency_key_reused', 'refused', fail(409, 'messaging.idempotency_key_reused')],
    ['404', 'refused', fail(404)],
  ] as Array<[string, string, Error]>)('%s: %s', async (_kind, outcome, err) => {
    mockSend.mockRejectedValueOnce(err);
    await sendViaOutbox('client-A', 'first', 'm1'); // a reply
    await sendViaOutbox('client-A', 'second', null);
    await drainOutbox('client-A', true); // a tap on "first"
    const key = sent()[0].clientMessageId;
    const route = sent().map((p) => [p.body, p.replyToId, p.clientMessageId === key]);
    if (outcome === 'refused') {
      // Never repeated and holds nothing; a tap takes its text back (MessagesScreen puts it in the composer).
      expect(route).toEqual([['first', 'm1', true], ['second', null, false]]);
      expect(readOutbox('client-A')).toEqual([expect.objectContaining({ body: 'first', refused: true })]);
      expect(takeBackRefused('client-A', key)?.body).toBe('first');
    } else {
      // Held: it keeps its place, quote and key, and "second" goes after it. Unquoted: at once, same key, no quote.
      expect(route).toEqual([['first', 'm1', true], ['first', outcome === 'held' ? 'm1' : null, true], ['second', null, false]]);
    }
    expect(readOutbox('client-A')).toEqual([]);
  });
});
