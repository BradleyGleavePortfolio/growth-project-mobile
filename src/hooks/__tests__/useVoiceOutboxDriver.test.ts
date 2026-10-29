/**
 * LS-848 B2 (FR-848R4): a cold restart on Home sends the waiting voice note with NO voice screen mounted.
 * The outbox module drives itself from import (flag on): the author from the user cache, the signal from
 * NetInfo. Sign-out empties the queue and a later reconnect sends nothing. Each test loads fresh modules.
 */
const mockPublish = jest.fn();
jest.mock('../useVoiceUpload', () => ({ publishVoiceNote: (...a: unknown[]) => mockPublish(...a) }));
jest.mock('../../config/featureFlags', () => ({ featureFlags: { communityVoiceNotes: true } }));
const mockUser = { current: { id: 'u-me' } as { id: string } | null };
jest.mock('../../lib/userCache', () => ({ readUserCache: async () => mockUser.current }));
jest.mock('../../services/queryClient', () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...p: (string | { uri: string })[]) {
      this.uri = p.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
    }
    exists = true;
    delete = () => undefined;
  }
  return { File, Directory: File, Paths: { document: 'file:///docs' } };
});

const SAVED = [{
  id: 'local-1', authorId: 'u-me', workspaceId: 'ws-1', peaks: [0.3], status: 'sending',
  input: { uri: 'file:///docs/voice-outbox/r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4' },
}];

type Net = { __setState: (s: object) => void; __reset: () => void };
async function coldStart(online: boolean): Promise<{ net: Net; authEvents: { emit: (e?: string) => void } }> {
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify(SAVED));
  const net = require('@react-native-community/netinfo') as Net;
  net.__reset();
  net.__setState({ isConnected: online, isInternetReachable: online });
  require('../useVoiceOutbox'); // app start: imported, no hook mounted
  return { net, authEvents: require('../../utils/authEvents').authEvents };
}
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockPublish.mockReset().mockResolvedValue({ id: 'vn-1' });
  mockUser.current = { id: 'u-me' };
});

it('a cold start online sends the saved note with no voice screen open', async () => {
  await coldStart(true);
  for (let i = 0; i < 5 && mockPublish.mock.calls.length === 0; i += 1) await flushAsync();
  expect(mockPublish).toHaveBeenCalledWith('ws-1', expect.objectContaining({ uri: SAVED[0].input.uri }), expect.anything());
});

it('a cold start offline waits, then sends on reconnect — still no voice screen', async () => {
  const { net } = await coldStart(false);
  for (let i = 0; i < 5; i += 1) await flushAsync();
  expect(mockPublish).not.toHaveBeenCalled();
  net.__setState({ isConnected: true, isInternetReachable: true });
  for (let i = 0; i < 5 && mockPublish.mock.calls.length === 0; i += 1) await flushAsync();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('sign-out empties the queue: a later reconnect sends nothing', async () => {
  const { net, authEvents } = await coldStart(false);
  for (let i = 0; i < 5; i += 1) await flushAsync();
  mockUser.current = null;
  authEvents.emit('logout');
  net.__setState({ isConnected: true, isInternetReachable: true });
  for (let i = 0; i < 5; i += 1) await flushAsync();
  expect(mockPublish).not.toHaveBeenCalled();
});
