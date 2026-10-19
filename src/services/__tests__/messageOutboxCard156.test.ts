// SHARE-B (shareSendV1 with c3StyleB): Send to {coach} through the thread outbox (MOCK-SHARE boards 7, 8 and 9). HTTP is
// mocked at services/api; the outbox, its storage, the send and the row schema are the real ones.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { drainOutbox, readOutbox, releaseOutbox, sendCardViaOutbox, subscribeOutbox, type OutboxEvent } from '../messageOutbox';

const mockPost = jest.fn();
jest.mock('../api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-A' }) }));
jest.mock('../../tutorial/tutorialEvents', () => ({ emitTutorialSignal: jest.fn() }));
const NetInfo = jest.requireMock('@react-native-community/netinfo');
const SNAP = { kind: 'weigh_in_run', value: 14, words: 'days in a row', from: '2026-10-04', to: '2026-10-17' } as const;
const CARD = { type: 'share', snapshot: SNAP };
const fail = (status?: number, data: object = {}) => Object.assign(new Error('send failed'), { isAxiosError: true, ...(status ? { response: { status, data } } : {}) });
const accept = async (_url: string, body: { client_message_id: string }) => ({
  data: { id: `srv-${body.client_message_id}`, coach_id: 'coach-1', client_id: 'client-A', sender_id: 'client-A', body: null,
    created_at: '2026-10-18T16:41:00.000Z', client_message_id: body.client_message_id, card: { card_type: 'share', ref_id: null, snapshot: SNAP } },
});
const setOnline = (on: boolean) => NetInfo.__setState({ isConnected: on, isInternetReachable: on });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  NetInfo.__reset();
  releaseOutbox();
  mockPost.mockImplementation(accept);
});

it('online: the card goes alone (no body), with its key in the body and the header, and the sent row keeps the card', async () => {
  const events: OutboxEvent[] = [];
  const off = subscribeOutbox((_items, e) => { if (e) events.push(e); });
  await expect(sendCardViaOutbox('client-A', SNAP, 'k-1')).resolves.toBe('sent');
  off();
  expect(mockPost).toHaveBeenCalledWith('/messages', { card: CARD, client_message_id: 'k-1' }, expect.objectContaining({ headers: { 'Idempotency-Key': 'k-1' } }));
  expect(events).toEqual([{ type: 'sent', row: expect.objectContaining({ card: { card_type: 'share', ref_id: null, snapshot: SNAP } }) }]);
  expect(readOutbox('client-A')).toEqual([]);
});

it('board 8, offline: the card waits, saved with its snapshot, and sends once when the signal returns', async () => {
  setOnline(false);
  mockPost.mockRejectedValueOnce(fail());
  await expect(sendCardViaOutbox('client-A', SNAP, 'k-2')).resolves.toBe('waiting');
  expect(readOutbox('client-A')).toEqual([expect.objectContaining({ key: 'k-2', body: '', card: SNAP, failed: false })]);
  expect(JSON.parse((await AsyncStorage.getItem('messages_thread_outbox_client-A'))!)[0].card).toEqual(SNAP);
  setOnline(true);
  await drainOutbox('client-A');
  expect(mockPost.mock.calls.map((c) => c[1])).toEqual([{ card: CARD, client_message_id: 'k-2' }, { card: CARD, client_message_id: 'k-2' }]);
  expect(readOutbox('client-A')).toEqual([]);
});

it('board 9, online: a server fault is "failed"; a second tap sends the same card again with the same key, once', async () => {
  mockPost.mockRejectedValueOnce(fail(500));
  await expect(sendCardViaOutbox('client-A', SNAP, 'k-3')).resolves.toBe('failed');
  expect(readOutbox('client-A')).toEqual([expect.objectContaining({ key: 'k-3', failed: true })]);
  await expect(sendCardViaOutbox('client-A', SNAP, 'k-3')).resolves.toBe('sent');
  expect(mockPost.mock.calls.map((c) => c[1].client_message_id)).toEqual(['k-3', 'k-3']);
});

it('a server without share cards (400 SHARE_CARD_INVALID) refuses it as written', async () => {
  mockPost.mockRejectedValueOnce(fail(400, { error: 'SHARE_CARD_INVALID' }));
  await expect(sendCardViaOutbox('client-A', SNAP, 'k-4')).resolves.toBe('refused');
});
