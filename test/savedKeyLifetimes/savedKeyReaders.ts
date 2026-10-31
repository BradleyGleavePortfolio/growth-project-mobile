/**
 * KT-13: how the lifetime case writes and reads back each saved key that has to outlive something
 * (a QUEUE across a restart, a MARK across sign out). See src/__tests__/savedKeyLifetimes.test.ts.
 *
 * Each QUEUE row needs an entry here, keyed `${store} ${key pattern}` as in the registry. The lifetime case
 * fails closed on a QUEUE row with no entry. An entry writes a value the app itself would save (its own
 * writer, or a payload its reader accepts) and reads it back with the app's own reader:
 *   - via 'reader': the app's exported reader (the one its restart and send paths call) reads it back;
 *   - via 'layer': the reader lives in a hook or a screen, so the store call that reader makes reads a
 *     valid payload back and the test parses it as the app does. Found, not fixed: the screen is not run.
 * MARK and DEVICE rows without an entry are read back through the store call their read sites make (a
 * 'layer' read): the value is opaque to the store, so the read proves the key outlives a restart, not
 * that the screen hides its prompt.
 *
 * `read(uid)` runs with `uid` as the signed-in account in the user cache (the lifetime case sets it and
 * puts the cache back afterwards), so readers that pick the account from the cache read that account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { cacheStorage } from '../../src/storage/mmkv';

export interface Probe {
  via: 'reader' | 'layer';
  /** Save a valid value for account `uid`, signed in. */
  write(uid: string): Promise<void>;
  /** The app's reader for signed-in account `uid` brings the value back. */
  read(uid: string): Promise<boolean>;
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
  // useVoiceOutbox reads the list at start and sends the items of the signed-in author.
  'async tgp.voiceOutbox.v1': {
    via: 'layer',
    write: (uid) => AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify([{
      id: 'kt13-voice', authorId: uid, workspaceId: 'kt13-ws', input: { uri: 'file:///kt13.m4a', durationMs: 1000 },
      peaks: [0.5], status: 'waiting',
    }])),
    read: async (uid) => {
      const raw = await AsyncStorage.getItem('tgp.voiceOutbox.v1');
      const items = raw ? (JSON.parse(raw) as { authorId?: string; status?: string }[]) : [];
      return items.some((i) => i.authorId === uid && i.status !== 'sending');
    },
  },
  // useChatDraft reads the draft back with getStringAsync and drops one without text.
  'cache chat_draft_{uid}': {
    via: 'layer',
    write: (uid) => cacheStorage.set(`chat_draft_${uid}`, JSON.stringify({ text: 'half typed' })),
    read: async (uid) => {
      const raw = await cacheStorage.getStringAsync(`chat_draft_${uid}`);
      return !!raw && typeof (JSON.parse(raw) as { text?: unknown }).text === 'string';
    },
  },
};
