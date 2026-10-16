// The Style B outbox at every real sign-out path (R5, owner "c3b-signout - handle like food logs and workouts") and over
// every way the server refuses a send (R6, backend src/messaging). HTTP is mocked; storage, sign-out and the error
// mapping are the real ones.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { prepareSignOutConfirm, signOut } from '../authActions';
import { drainOutbox, readOutbox, releaseOutbox, sendViaOutbox, takeBackRefused } from '../messageOutbox';
import type { SessionFencePass } from '../sessionFence';

const mockAccount = { id: 'client-A' };
const mockSend = jest.fn();
jest.mock('../../api/messagingV2Api', () => ({ ...jest.requireActual('../../api/messagingV2Api'), messagingV2Api: { sendMessage: (...a: unknown[]) => mockSend(...a) } }));
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => mockAccount, readUserCache: async () => mockAccount, clearUserCache: async () => undefined, patchUserCache: async () => undefined }));
jest.mock('../api', () => ({ usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) }, profileApi: { get: jest.fn() } }));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0), countQueuedWorkouts: jest.fn(async () => 0), pushQueuedWorkouts: jest.fn(async () => undefined) }));
jest.mock('../../db/fastingDb', () => ({ getActiveFast: jest.fn(async () => null), getFastingHistory: jest.fn(async () => []) }));
const NetInfo = jest.requireMock('@react-native-community/netinfo');
const fail = (status?: number, code?: string) => Object.assign(new Error('send failed'), { isAxiosError: true, ...(status ? { response: { status, data: code ? { code } : {} } } : {}) });
type Sent = { body: string; clientMessageId: string; replyToId: string | null };
const sent = () => mockSend.mock.calls.map(([, p]) => p as Sent);
// A sign-in as `id` (the drain hook's cleanup drops the last account's copy in memory), then its first drain.
const signIn = (id: string) => { releaseOutbox(); mockAccount.id = id; return drainOutbox(id); };
const OUTBOX_A = 'messages_thread_outbox_client-A';
const setOnline = (on: boolean) => NetInfo.__setState({ isConnected: on, isInternetReachable: on });
// Written with no signal: the one try gets no answer, so it waits.
const writeOffline = async (body: string) => {
  setOnline(false);
  mockSend.mockRejectedValueOnce(fail());
  await sendViaOutbox('client-A', body, null);
};
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  NetInfo.__reset();
  await signIn('client-A');
  mockSend.mockImplementation(async (_scope: unknown, p: Sent) => ({ id: `srv-${p.clientMessageId}`, body: p.body }));
});

describe('R5: nothing waits across accounts; sign-out sends what it can, names the rest, then removes it', () => {
  afterEach(() => jest.useRealTimers());

  // Every sign-out goes through signOut (search: rg -n "signOut\(" src --glob '!**/__tests__/**').
  it.each([
    ['Sign out in Settings or Profile', () => signOut('client-A')],
    ['account deletion (DeleteAccountScreen)', () => signOut()],
    ['a refused session renewal (api.ts)', () => signOut(undefined, { sessionFence: Object.freeze({}) as SessionFencePass })],
  ] as Array<[string, () => Promise<void>]>)('%s removes this account\'s waiting messages and keeps another account\'s', async (_path, run) => {
    const other = JSON.stringify([{ key: 'k-b', body: 'from B', replyToId: null, createdAt: '2026-10-15T08:00:00.000Z' }]);
    await AsyncStorage.setItem('messages_thread_outbox_client-B', other);
    await writeOffline('see you friday');
    expect(JSON.parse((await AsyncStorage.getItem(OUTBOX_A))!)).toHaveLength(1); // control: it was saved
    mockSend.mockRejectedValue(fail()); // still no signal at sign-out
    await run();
    expect([await AsyncStorage.getItem(OUTBOX_A), readOutbox('client-A')]).toEqual([null, []]);
    expect(await AsyncStorage.getItem('messages_thread_outbox_client-B')).toBe(other);
    setOnline(true);
    mockSend.mockClear();
    await signIn('client-A');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('still no signal: the confirm names the waiting messages, which stay until sign-out', async () => {
    await writeOffline('see you friday');
    await writeOffline('bring the bands');
    mockSend.mockRejectedValue(fail());
    await expect(prepareSignOutConfirm('client-A')).resolves.toBe('2 messages have not synced yet and will be removed from this phone.');
    expect(readOutbox('client-A').map((i) => i.body)).toEqual(['see you friday', 'bring the bands']);
  });

  it('signal back: one that failed online and the one behind it go once, in order, with their keys', async () => {
    await writeOffline('one');
    await writeOffline('two');
    setOnline(true);
    mockSend.mockRejectedValueOnce(fail(500));
    await drainOutbox('client-A');
    expect(readOutbox('client-A').map((i) => !!i.failed)).toEqual([true, false]); // control: "one" waits for a tap
    const keys = readOutbox('client-A').map((i) => i.key);
    mockSend.mockClear();
    await expect(prepareSignOutConfirm('client-A')).resolves.toBe('Are you sure you want to sign out?');
    expect(sent()).toEqual([{ body: 'one', clientMessageId: keys[0], replyToId: null }, { body: 'two', clientMessageId: keys[1], replyToId: null }]);
  });

  it('a send still in flight when sign-out removes the outbox never writes it back', async () => {
    await writeOffline('one');
    await writeOffline('two');
    setOnline(true);
    let answer: (row: unknown) => void = () => undefined;
    mockSend.mockClear();
    mockSend.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    jest.useFakeTimers();
    const out = signOut('client-A');
    await jest.advanceTimersByTimeAsync(10_000);
    await out;
    answer({ id: 'srv-one', body: 'one' });
    await jest.advanceTimersByTimeAsync(0);
    expect([await AsyncStorage.getItem(OUTBOX_A), mockSend.mock.calls.length]).toEqual([null, 1]);
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
