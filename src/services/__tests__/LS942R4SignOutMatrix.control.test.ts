/**
 * LS-942R4: reviewer-only regression controls for the round-three shared sign-out fix.
 * Product implementations run unchanged. Device storage, transport, filesystem and workout DB are doubled.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { prepareSignOutConfirm, sendUnsyncedLogs, signOut } from '../authActions';
import { authEvents } from '../../utils/authEvents';
import { resetVoiceOutbox } from '../../hooks/useVoiceOutbox';
import { releaseOutbox } from '../messageOutbox';
import { setSpaceOutboxOnline } from '../../components/community/space-chat/spaceChatOutbox';

const mockCache = new Map<string, string>();
const mockTextSend = jest.fn();
const mockVoiceSend = jest.fn();
const mockDirectSend = jest.fn();
const mockDelete = jest.fn();
const mockErrorBuzz = jest.fn();
const mockSuccessBuzz = jest.fn();
jest.mock('../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true, communitySpaceChat: false, c3StyleB: true, shareSendV1: true },
}));
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => { mockCache.clear(); }),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: {
    getString: (key: string) => mockCache.get(key),
    getStringAsync: async (key: string) => mockCache.get(key),
    getAllKeys: async () => [...mockCache.keys()],
    set: async (key: string, value: string) => { mockCache.set(key, value); },
    delete: async (key: string) => { mockCache.delete(key); },
  },
  secureStorage: { getString: () => undefined },
}));
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => 'review-unit-session'),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
  // The foreground identity is A; the cold-start background adopter is held empty.
  // Sign-out itself must adopt the author and send, with the v1 voice switch enabled.
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
}));
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null), getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined), endFast: jest.fn(async () => undefined),
}));
jest.mock('../../hooks/useVoiceUpload', () => ({
  publishVoiceNote: (...args: unknown[]) => mockVoiceSend(...args),
}));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: { error: (...args: unknown[]) => mockErrorBuzz(...args), success: (...args: unknown[]) => mockSuccessBuzz(...args) },
}));
jest.mock('../../components/community/space-chat/spaceChatApi', () => ({
  spaceChatApi: { send: (...args: unknown[]) => mockTextSend(...args) },
  isNoAccess: (err: { status?: number }) => err?.status === 403 || err?.status === 404,
}));
jest.mock('../../api/messagingV2Api', () => ({
  ...jest.requireActual('../../api/messagingV2Api'),
  messagingV2Api: { sendMessage: (...args: unknown[]) => mockDirectSend(...args) },
}));
jest.mock('expo-file-system', () => ({
  Directory: class { delete() { mockDelete('directory'); } },
  File: class { delete() { mockDelete('file'); } },
  Paths: { document: 'file:///docs' },
}));

const net = NetInfo as unknown as { __setState: (state: object) => void; fetch: jest.Mock };
const engine = jest.requireMock('../../offline/sync/sync-engine') as {
  countQueuedWorkouts: jest.Mock; pushQueuedWorkouts: jest.Mock;
};
const settle = async () => { for (let n = 0; n < 20; n += 1) await Promise.resolve(); };
const offlineError = () => Object.assign(new Error('unit transport unavailable'), { isAxiosError: true });
const text = (id: string, state = 'waiting', reason?: string) => ({
  localId: id, key: id, cohortId: 'space-1', body: `text-${id}`,
  createdAt: '2026-11-06T05:00:00Z', state, ...(reason ? { reason } : {}),
});
const voice = (id: string, status = 'waiting', authorId = 'user-A', target: 'hall' | 'space' | 'dm' = 'space') => ({
  id, authorId, workspaceId: 'workspace-1', peaks: [], status,
  input: {
    uri: `file:///docs/voice-outbox/${id}.m4a`, durationMs: 3000, bytes: 1000, mimeType: 'audio/mp4',
    ...(target === 'space' ? { cohortId: 'space-1' } : target === 'dm' ? { conversationId: 'conversation-1' } : {}),
  },
});
const saveTexts = (entries: ReturnType<typeof text>[], user = 'user-A') =>
  mockCache.set(`space_outbox_${user}`, JSON.stringify(entries));
const saveVoices = (entries: ReturnType<typeof voice>[]) =>
  AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify(entries));

beforeEach(async () => {
  authEvents.emit('logout');
  resetVoiceOutbox();
  releaseOutbox();
  await settle();
  await AsyncStorage.clear();
  mockCache.clear();
  jest.clearAllMocks();
  net.fetch.mockImplementation(async () => ({ isConnected: false, isInternetReachable: false }));
  net.__setState({ isConnected: false, isInternetReachable: false });
  setSpaceOutboxOnline(false);
  engine.countQueuedWorkouts.mockResolvedValue(0);
  mockTextSend.mockResolvedValue({ id: 'server-text' });
  mockVoiceSend.mockResolvedValue({ id: 'server-voice' });
  mockDirectSend.mockRejectedValue(offlineError());
});
afterEach(async () => {
  authEvents.emit('logout');
  resetVoiceOutbox();
  releaseOutbox();
  await settle();
  jest.useRealTimers();
});

it.each([
  ['waiting', undefined],
  ['failed', undefined],
  ['failed', 'rejected'],
  ['failed', 'closed'],
  ['sending', undefined],
] as const)('offline text %s/%s is counted, not sent, and cancel keeps it', async (state, reason) => {
  saveTexts([text('a', state, reason)]);
  saveTexts([text('b')], 'user-B');
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('1 message has not synced yet and will be removed from this phone.');
  expect(mockTextSend).not.toHaveBeenCalled();
  expect(mockCache.get('space_outbox_user-A')).toContain('text-a');
  expect(mockCache.get('space_outbox_user-B')).toContain('text-b');
});

it.each(['waiting', 'failed', 'sending'])('offline voice %s is counted only for its author', async (status) => {
  await saveVoices([voice('a', status), voice('b', status, 'user-B')]);
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('1 message has not synced yet and will be removed from this phone.');
  expect(mockVoiceSend).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1'))!)).toHaveLength(2);
});

it('the shared confirm aggregates all five queues without counting another account', async () => {
  saveTexts([text('a'), text('a2', 'failed', 'closed')]);
  saveTexts([text('b')], 'user-B');
  await saveVoices([voice('hall', 'failed', 'user-A', 'hall'), voice('space'), voice('dm', 'waiting', 'user-A', 'dm'), voice('b', 'waiting', 'user-B')]);
  const direct = (key: string) => ({ key, body: key, createdAt: '2026-11-06T05:00:00Z', replyToId: null, failed: true });
  await AsyncStorage.setItem('messages_thread_outbox_user-A', JSON.stringify([direct('a'), { ...direct('a2'), refused: true }]));
  await AsyncStorage.setItem('messages_thread_outbox_user-B', JSON.stringify([direct('b')]));
  await AsyncStorage.setItem('pending_food_logs_user-A', JSON.stringify([{ id: 'a', parkedAt: 1 }, { id: 'a2', parkedAt: 1 }]));
  await AsyncStorage.setItem('pending_food_logs_user-B', JSON.stringify([{ id: 'b', parkedAt: 1 }]));
  await AsyncStorage.setItem('active_workout_session:user-A', '{}');
  engine.countQueuedWorkouts.mockResolvedValue(2);
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('3 workouts, 2 foods and 7 messages have not synced yet and will be removed from this phone.');
  expect(engine.countQueuedWorkouts).toHaveBeenCalledWith('user-A', { includeParked: true });
  expect(engine.pushQueuedWorkouts).toHaveBeenCalledTimes(1);
  expect(mockVoiceSend).not.toHaveBeenCalled();
  expect(mockTextSend).not.toHaveBeenCalled();
  expect(mockDirectSend).toHaveBeenCalledTimes(1);
  expect(mockDirectSend.mock.calls[0][1].body).toBe('a');
  await signOut('user-A');
  expect(mockCache.size).toBe(0);
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1')) ?? '[]')).toEqual([]);
  expect(await AsyncStorage.getItem('messages_thread_outbox_user-A')).toBeNull();
  expect(await AsyncStorage.getItem('pending_food_logs_user-A')).toBeNull();
  expect(await AsyncStorage.getItem('messages_thread_outbox_user-B')).toContain('"b"');
  expect(await AsyncStorage.getItem('pending_food_logs_user-B')).toContain('"b"');
});

it.each(['hall', 'space', 'dm'] as const)('online %s voice gets one bound try and disappears on success with the space switch off', async (target) => {
  await saveVoices([voice('a', 'failed', 'user-A', target), voice('b', 'failed', 'user-B')]);
  net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('Are you sure you want to sign out?');
  expect(mockVoiceSend).toHaveBeenCalledTimes(1);
  expect(mockVoiceSend.mock.calls[0][0]).toBe('workspace-1');
  expect(mockVoiceSend.mock.calls[0][1]).toEqual(voice('a', 'failed', 'user-A', target).input);
  expect(mockVoiceSend.mock.calls[0][2].binding).toEqual({ subject: expect.stringMatching(/^tok:/), epoch: expect.any(Number) });
  expect(mockSuccessBuzz).toHaveBeenCalledTimes(1);
  expect(mockErrorBuzz).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1'))!)).toEqual([voice('b', 'failed', 'user-B')]);
});

it('one failed online voice try buzzes once and remains named', async () => {
  await saveVoices([voice('a', 'failed', 'user-A', 'hall')]);
  net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockVoiceSend.mockRejectedValue(new Error('unit server failure'));
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('1 message has not synced yet and will be removed from this phone.');
  expect(mockVoiceSend).toHaveBeenCalledTimes(1);
  expect(mockErrorBuzz).toHaveBeenCalledTimes(1);
  expect(mockSuccessBuzz).not.toHaveBeenCalled();
});

it('a failed text retries once in order, while refused texts stay counted and are not retried', async () => {
  saveTexts([text('first', 'failed'), text('refused', 'failed', 'rejected'), text('closed', 'failed', 'closed'), text('last')]);
  net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockTextSend.mockImplementation(async (_space: string, body: string) => ({ id: `server-${body}` }));
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('2 messages have not synced yet and will be removed from this phone.');
  expect(mockTextSend.mock.calls.map((args) => [args[1], args[2]])).toEqual([['text-first', 'first'], ['text-last', 'last']]);
  const saved = JSON.parse(mockCache.get('space_outbox_user-A')!);
  expect(saved.map((row: { localId: string }) => row.localId)).toEqual(['refused', 'closed']);
});

it.each(['voice', 'text'] as const)('an in-flight %s is counted, bounded, not duplicated, and cannot write after the wipe', async (kind) => {
  jest.useFakeTimers();
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => { finish = resolve; });
  if (kind === 'voice') {
    await saveVoices([voice('a')]);
    mockVoiceSend.mockReturnValue(pending);
  } else {
    saveTexts([text('a')]);
    mockTextSend.mockReturnValue(pending);
  }
  net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  const confirm = prepareSignOutConfirm('user-A');
  await jest.advanceTimersByTimeAsync(4001);
  await expect(confirm).resolves.toBe('1 message has not synced yet and will be removed from this phone.');
  const out = signOut('user-A');
  await jest.advanceTimersByTimeAsync(4001);
  await out;
  finish({ id: 'server-a' });
  await jest.advanceTimersByTimeAsync(0);
  expect(mockTextSend.mock.calls.length + mockVoiceSend.mock.calls.length).toBe(1);
  expect(mockCache.size).toBe(0);
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1')) ?? '[]')).toEqual([]);
  expect(mockErrorBuzz).not.toHaveBeenCalled();
  expect(mockSuccessBuzz).not.toHaveBeenCalled();
});

it('even a stalled connection lookup is inside the shared four-second send bound', async () => {
  jest.useFakeTimers();
  saveTexts([text('a')]);
  await saveVoices([voice('a')]);
  net.fetch.mockReturnValue(new Promise(() => undefined));
  const confirm = prepareSignOutConfirm('user-A');
  await jest.advanceTimersByTimeAsync(4001);
  await expect(confirm).resolves.toBe('2 messages have not synced yet and will be removed from this phone.');
  expect(mockVoiceSend).not.toHaveBeenCalled();
  expect(mockTextSend).not.toHaveBeenCalled();
});

it('coach-style direct sign-out gives voice a try before the wipe without preparing a member confirm', async () => {
  await saveVoices([voice('a', 'failed', 'user-A', 'hall')]);
  net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await signOut('user-A');
  expect(mockVoiceSend).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1')) ?? '[]')).toEqual([]);
});

it('empty queues make no send or connection lookup', async () => {
  await expect(sendUnsyncedLogs('user-A')).resolves.toEqual({ workouts: 0, foods: 0, messages: 0 });
  expect(net.fetch).not.toHaveBeenCalled();
  expect(mockVoiceSend).not.toHaveBeenCalled();
  expect(mockTextSend).not.toHaveBeenCalled();
});
