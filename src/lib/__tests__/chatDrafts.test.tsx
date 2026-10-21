/**
 * CHAT-DISCARD (owner 10-21, op 1): half-typed chat text is kept on the device per signed-in user and per chat, and a
 * failed send keeps its key with its text (Sol B1, m#841).
 */
import { act, renderHook } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
jest.mock('../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined, // the AsyncStorage fallback: no synchronous read
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
let mockUser: { id: string } | null = { id: 'client-1' };
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

const { useChatDraft, CHAT_DRAFT_KEY_PREFIX } = require('../chatDrafts');
const { authEvents } = require('../../utils/authEvents');

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  mockUser = { id: 'client-1' };
  authEvents.emit('logout');
  await flush();
  mockDisk.clear();
});

it('keeps half-typed text per chat and brings it back when that chat opens again', async () => {
  const a = renderHook(() => useChatDraft('client:coach'));
  act(() => a.result.current[1]('Hey, loved th'));
  a.unmount();
  await flush();
  expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:client:coach`)).toContain('Hey, loved th');
  expect(renderHook(() => useChatDraft('dm:w:coach-1')).result.current[0]).toBe('');
  expect(renderHook(() => useChatDraft('client:coach')).result.current[0]).toBe('Hey, loved th');
});

it('reads the device copy after the app closed (memory empty) and never shows it to another account', async () => {
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`, JSON.stringify({ text: 'What should I eat' }));
  const same = renderHook(() => useChatDraft('roman'));
  await flush();
  expect(same.result.current[0]).toBe('What should I eat');
  mockUser = { id: 'client-2' };
  const other = renderHook(() => useChatDraft('roman'));
  await flush();
  expect(other.result.current[0]).toBe('');
});

it('a failed send keeps its key with its text; sending (an empty box) drops both', async () => {
  const a = renderHook(() => useChatDraft('coach:client-1'));
  act(() => a.result.current[1]('see you at 6'));
  act(() => a.result.current[2].keepFailed('see you at 6', 'key-1'));
  a.unmount();
  const b = renderHook(() => useChatDraft('coach:client-1'));
  expect(b.result.current[2].keyFor('see you at 6')).toBe('key-1');
  expect(b.result.current[2].keyFor('see you at 7')).toBeUndefined();
  act(() => b.result.current[1](''));
  await flush();
  expect(b.result.current[2].keyFor('see you at 6')).toBeUndefined();
  expect([...mockDisk.keys()]).toEqual([]);
});

it('a passed draft wins over kept text; a sign-out removes every kept text from memory and the device', async () => {
  const a = renderHook(() => useChatDraft('coach:client-1'));
  act(() => a.result.current[1]('old reply'));
  a.unmount();
  expect(renderHook(() => useChatDraft('coach:client-1', 'How did the week go?')).result.current[0]).toBe('How did the week go?');
  act(() => authEvents.emit('logout'));
  await flush();
  expect([...mockDisk.keys()]).toEqual([]);
  const after = renderHook(() => useChatDraft('coach:client-1'));
  await flush();
  expect(after.result.current[0]).toBe('');
});

it('without a chat (null) the box keeps nothing', async () => {
  const a = renderHook(() => useChatDraft(null));
  act(() => a.result.current[1]('a comment'));
  expect(a.result.current[0]).toBe('a comment');
  a.unmount();
  expect(renderHook(() => useChatDraft(null)).result.current[0]).toBe('');
  expect([...mockDisk.keys()]).toEqual([]);
});
