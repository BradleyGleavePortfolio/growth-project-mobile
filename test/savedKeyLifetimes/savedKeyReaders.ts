/**
 * KT-13: how the lifetime case writes and reads back each saved key that has to outlive something
 * (a QUEUE across a restart, a MARK across sign out). See src/__tests__/savedKeyLifetimes.test.ts.
 *
 * Each QUEUE row needs an entry here, keyed `${store} ${key pattern}` as in the registry. The lifetime case
 * fails closed on a QUEUE row with no entry. An entry writes a value the app itself would save (its own
 * writer, or a payload its reader accepts) and reads it back with the app's own reader:
 *   - via 'reader': the app's exported reader (the one its restart and send paths call) reads it back, or
 *     the app's own hook does (the chat box and the voice outbox, with their memory gone as after a restart);
 *   - via 'layer': the reader lives in a hook or a screen, so the store call that reader makes reads a
 *     valid payload back and the test parses it as the app does. Found, not fixed: the screen is not run.
 * MARK and DEVICE rows without an entry are read back through the store call their read sites make (a
 * 'layer' read): the value is opaque to the store, so the read proves the key outlives a restart, not
 * that the screen hides its prompt.
 *
 * An unkeyed QUEUE names in `empty` what the app itself leaves at the key for an empty queue; after sign out
 * the key is gone or holds exactly that, whatever the reader filters.
 *
 * `read(uid)` runs with `uid` as the signed-in account in the user cache (the lifetime case sets it and
 * puts the cache back afterwards), so readers that pick the account from the cache read that account.
 */
import React from 'react';
import * as ReactNative from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AUTOSAVE_MIRROR_VERSION, readAutosaveMirror, writeAutosaveMirror, type MirroredAutosave } from '../../src/storage/autosaveMirror';
import {
  LEGACY_ACTIVE_WORKOUT_SESSION_KEY,
  loadActiveWorkoutSession,
  saveActiveWorkoutSession,
} from '../../src/storage/activeWorkoutSession';
import { readDraft as readCoachDraft, writeDraft as writeCoachDraft } from '../../src/lib/coachConsultation/draft';
import type { CoachConsultAnswers } from '../../src/lib/coachConsultation/types';
import { markAiWithdrawalPending, readAiWithdrawalPending } from '../../src/lib/consultation/aiConsent';
import { openDraft, readLocalState, writeDraft as writeConsultDraft, type DraftWrite } from '../../src/lib/consultation/storage';
import { outboxLength, releaseOutbox } from '../../src/services/messageOutbox';
import { getQueueLength } from '../../src/services/foodLogQueue';
import { clearUserCache } from '../../src/lib/userCache';
import { resetVoiceOutbox, useVoiceOutbox } from '../../src/hooks/useVoiceOutbox';
import type * as ChatDrafts from '../../src/lib/chatDrafts';
import type * as CurrentUser from '../../src/hooks/useCurrentUser';

export interface Probe {
  via: 'reader' | 'layer';
  /** Save a valid value for account `uid`, signed in. */
  write(uid: string): Promise<void>;
  /** The app's reader for signed-in account `uid` brings the value back. */
  read(uid: string): Promise<boolean>;
  /** An unkeyed QUEUE: what the app itself leaves at the key for an empty queue (no key at all is always fine). */
  empty?: readonly string[];
}

const PLAN = 'x'; // the registry sample for mwb_autosave_mirror:*
const foodLog = (id: string) => ({
  id,
  createdAt: 1767225600000,
  kind: 'manual',
  food: { name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3 },
  log: { date: '2026-10-31', meal_type: 'breakfast', quantity_multiplier: 1 },
});
const workout = () => ({
  startedAtMs: Date.now() - 60_000,
  routineName: 'Push day',
  exercisesJson: '[]',
  idempotencyKey: 'kt13-session',
  sessionExercises: [{ exerciseId: 'kt13-bench', exerciseName: 'Bench press', sets: [] }],
});

const VOICE_WS = 'kt13-ws';
const CHAT_THREAD = 'roman'; // RomanChatScreen's chat (useChatDraft('roman'))
const CHAT_TEXT = 'half typed';
const CHAT_SEND_KEY = 'kt13-send-key';

/** True once `check` holds; false when it never does (a reader that brings nothing back). */
async function until(check: () => boolean): Promise<boolean> {
  try {
    await waitFor(() => expect(check()).toBe(true), { timeout: 800 });
    return true;
  } catch {
    return false;
  }
}
const asyncStorageModule: unknown = jest.requireMock('@react-native-async-storage/async-storage');
/**
 * Runs `body` with the 'roman' chat box of a fresh copy of src/lib/chatDrafts.ts, as after a restart: no kept text
 * in memory; the device store (the AsyncStorage double, which jest shares with every copy), React and React Native
 * shared with the test. The box belongs to `uid`, the account the lifetime case signed in (the app takes it from
 * useCurrentUser, which reads the same user cache).
 */
async function withChatBox<T>(uid: string, body: (box: { current: ReturnType<typeof ChatDrafts.useChatDraft> }) => Promise<T>): Promise<T> {
  let mod: typeof ChatDrafts | undefined;
  let users: typeof CurrentUser | undefined;
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('react-native', () => ReactNative);
    jest.doMock('@react-native-async-storage/async-storage', () => asyncStorageModule);
    // A plain require: the copy must load through the isolated registry (and see the test's mocks).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../../src/lib/chatDrafts') as typeof ChatDrafts;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    users = require('../../src/hooks/useCurrentUser') as typeof CurrentUser;
  });
  jest.dontMock('react');
  jest.dontMock('react-native');
  if (!mod || !users) throw new Error('chatDrafts did not load');
  const { useChatDraft } = mod;
  // The useCurrentUser this copy reads (a test's mocked one is shared, as jest shares mocks) answers with the account.
  const signedIn = jest.spyOn(users, 'useCurrentUser').mockImplementation(() => ({ id: uid }) as ReturnType<typeof CurrentUser.useCurrentUser>);
  const hook = await renderHook(() => useChatDraft(CHAT_THREAD));
  try {
    return await body(hook.result);
  } finally {
    await hook.unmount();
    signedIn.mockRestore();
  }
}
/** Every device write the chat box queued has landed. */
async function chatSaved(uid: string): Promise<void> {
  const key = `cache:chat_draft_${uid}:${CHAT_THREAD}`;
  for (let i = 0; i < 50 && (await AsyncStorage.getItem(key)) === null; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
}

export const READERS: Record<string, Probe> = {
  'async mwb_autosave_mirror:*': {
    via: 'reader',
    write: () => writeAutosaveMirror({
      version: AUTOSAVE_MIRROR_VERSION,
      planId: PLAN,
      batch: { days: [] } as unknown as MirroredAutosave['batch'],
      idempotencyKey: 'kt13-autosave',
      queuedAtMs: Date.now(),
    }),
    read: async () => (await readAutosaveMirror(PLAN)) !== null,
  },
  'async active_workout_session:{uid}': {
    via: 'reader',
    write: (uid) => saveActiveWorkoutSession(uid, workout()),
    read: async (uid) => (await loadActiveWorkoutSession(uid)) !== null,
  },
  // The one-slot key of an older build: the reader moves it under the signed-in account.
  'async @activeWorkoutSession/v1': {
    via: 'reader',
    write: () => AsyncStorage.setItem(LEGACY_ACTIVE_WORKOUT_SESSION_KEY, JSON.stringify({
      version: 1, updatedAtMs: Date.now(), ...workout(),
    })),
    read: async (uid) => (await loadActiveWorkoutSession(uid)) !== null,
  },
  'async coach_consult_v1:{uid}': {
    via: 'reader',
    write: (uid) => writeCoachDraft(uid, {} as CoachConsultAnswers, 'K1'),
    read: async (uid) => (await readCoachDraft(uid)) !== null,
  },
  'async consultation_ai_withdraw_pending:{uid}': {
    via: 'reader',
    write: async (uid) => { await markAiWithdrawalPending(uid); },
    read: async (uid) => (await readAiWithdrawalPending(uid)) !== null,
  },
  // Written as the outbox saves it; read by the outbox after its memory is dropped (a restart).
  'async messages_thread_outbox_{uid}': {
    via: 'reader',
    write: (uid) => AsyncStorage.setItem(`messages_thread_outbox_${uid}`, JSON.stringify([
      { key: 'kt13-message', body: 'See you at 6' },
    ])),
    read: async (uid) => {
      releaseOutbox();
      return (await outboxLength(uid)) > 0;
    },
  },
  // The food queue reads the queue of the account in the user cache (the send path reads the same).
  'async pending_food_logs_{uid}': {
    via: 'reader',
    write: (uid) => AsyncStorage.setItem(`pending_food_logs_${uid}`, JSON.stringify([foodLog('kt13-food')])),
    read: async () => (await getQueueLength()) > 0,
  },
  'async pending_food_logs_anonymous': {
    via: 'reader',
    write: () => AsyncStorage.setItem('pending_food_logs_anonymous', JSON.stringify([foodLog('kt13-anon')])),
    read: async () => {
      await clearUserCache(); // the queue of "no account known yet"
      return (await getQueueLength()) > 0;
    },
  },
  'secure-store consult_draft.{uid}.*': {
    via: 'reader',
    write: (uid) => writeConsultDraft(openDraft(uid), {
      answers: {} as DraftWrite['answers'],
      screenId: 'kt13-screen',
      editedAt: new Date().toISOString(),
      dirty: true,
      synced: null,
    }),
    read: async (uid) => (await readLocalState(uid)) !== null,
  },
  // The voice outbox through its own hook after a cold start (resetVoiceOutbox(true): memory gone, the store kept). A
  // send cut off mid-way is saved as 'sending'; the hook brings it back as 'waiting' for its author only.
  'async tgp.voiceOutbox.v1': {
    via: 'reader',
    empty: ['[]'],
    write: (uid) => AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify([{
      id: 'kt13-voice', authorId: uid, workspaceId: VOICE_WS, input: { uri: 'file:///kt13.m4a', durationMs: 1000, bytes: 1, mimeType: 'audio/m4a' },
      peaks: [0.5], status: 'sending',
    }])),
    read: async (uid) => {
      resetVoiceOutbox(true);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
      const hook = await renderHook(() => useVoiceOutbox(VOICE_WS, uid), { wrapper });
      try {
        return await until(() => hook.result.current.items.some((i) => i.id === 'kt13-voice' && i.status === 'waiting'));
      } finally {
        await hook.unmount();
        resetVoiceOutbox(true);
        qc.clear();
      }
    },
  },
  // The chat box through its own hook, in a fresh copy of src/lib/chatDrafts.ts (its memory is gone, as after a
  // restart): typed into the real 'roman' chat of the signed-in account with a failed send's key, read back the same way.
  'cache chat_draft_{uid}': {
    via: 'reader',
    write: (uid) => withChatBox(uid, async (box) => {
      await act(async () => {
        box.current[1](CHAT_TEXT);
      });
      await act(async () => {
        box.current[2].keepFailed(CHAT_TEXT, CHAT_SEND_KEY);
      });
      await chatSaved(uid);
    }),
    read: (uid) => withChatBox(uid, async (box) => until(() => box.current[0] === CHAT_TEXT && box.current[2].keyFor(CHAT_TEXT) === CHAT_SEND_KEY)),
  },
};
