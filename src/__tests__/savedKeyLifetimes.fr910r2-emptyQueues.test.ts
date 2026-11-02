/**
 * FR-910R2 (LS-910R2 B2, LO-910R2 C2): the chat and voice QUEUE probes read back through the app's own hooks,
 * so an empty or unusable queue reads as empty and a real one (the 'roman' chat of the account, a voice note cut
 * off mid-send) reads back. Each row seeds the device store the way the app saves it, then asks the probe.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheStorage } from '../storage/mmkv';
import { setUserCache, clearUserCache } from '../lib/userCache';
import { READERS } from '../../test/savedKeyLifetimes/savedKeyReaders';

jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => null }));

const A = 'acct-a-1111';
const B = 'acct-b-2222';
const VOICE = 'async tgp.voiceOutbox.v1';
const CHAT = 'cache chat_draft_{uid}';
const note = (status: string, authorId = A) => ({
  id: 'kt13-voice', authorId, workspaceId: 'kt13-ws',
  input: { uri: 'file:///kt13.m4a', durationMs: 1000, bytes: 1, mimeType: 'audio/m4a' }, peaks: [0.5], status,
});
const seedVoice = (items: unknown[] | null) => async () => {
  if (items) await AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify(items));
};
const seedChat = (key: string | null, draft: unknown) => async () => {
  if (key) await cacheStorage.set(key, JSON.stringify(draft));
};

type Case = [name: string, probe: string, seed: () => Promise<void>, reader: string, expected: boolean];
const cases: Case[] = [
  // controls
  ['control: the voice probe writes a note its reader brings back', VOICE, () => READERS[VOICE].write(A), A, true],
  ['control: the chat probe writes a draft its reader brings back', CHAT, () => READERS[CHAT].write(A), A, true],
  ['control: a voice note of another author is not read back', VOICE, seedVoice([note('waiting', B)]), A, false],
  // empty queues
  ['empty voice queue: no key', VOICE, seedVoice(null), A, false],
  ["empty voice queue: the app's own []", VOICE, seedVoice([]), A, false],
  ['empty chat queue: no key', CHAT, seedChat(null, null), A, false],
  ['empty chat queue: kept text of spaces only (the app drops it)', CHAT, seedChat(`chat_draft_${A}:roman`, { text: '   ' }), A, false],
  // real payloads
  ['a voice note cut off mid-send comes back as waiting', VOICE, seedVoice([note('sending')]), A, true],
  ["the account's own 'roman' chat draft comes back", CHAT, seedChat(`chat_draft_${A}:roman`, { text: 'half typed', failed: { text: 'half typed', key: 'kt13-send-key' } }), A, true],
  ["another account's 'roman' chat draft is not read back", CHAT, seedChat(`chat_draft_${B}:roman`, { text: 'half typed', failed: { text: 'half typed', key: 'kt13-send-key' } }), A, false],
];

describe('FR-910R2 chat and voice QUEUE probes read through the app hooks', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await setUserCache({ id: A, role: 'coach', name: A } as Parameters<typeof setUserCache>[0]);
  });
  afterAll(async () => {
    await clearUserCache();
  });

  it.each(cases)('%s', async (_name, key, seed, reader, expected) => {
    const probe = READERS[key];
    expect(probe).toBeDefined();
    await seed();
    expect(await probe.read(reader)).toBe(expected);
  });

  it("the voice queue names the app's own empty queue", () => {
    expect(READERS[VOICE].empty).toEqual(['[]']);
  });
});
