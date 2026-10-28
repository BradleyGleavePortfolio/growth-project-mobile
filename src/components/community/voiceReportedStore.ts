/**
 * The voice notes this viewer reported (GOAL B-06b, VN-07), kept on the phone per signed-in account.
 *
 * Opus R5-B3 / Sol R5-B1: a report must keep its note folded after the app restarts, and a second
 * account on the same phone must not inherit the first account's folds. So the store saves only note
 * ids (no audio, words, names or reasons) under a key that carries the signed-in user's id, reads that
 * key when it first runs for an account, and drops the ids (memory and storage) at sign-out.
 *
 * Fenced like the voice outbox (useVoiceOutbox.ts): a sign-out or account change while a read is in
 * flight wins, so an old account's ids can never land in the new account's set.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { readUserCache } from '../../lib/userCache';
import { authEvents } from '../../utils/authEvents';

const KEY_PREFIX = 'tgp.voiceReported.v1:';
/** Enough for any real feed; the oldest ids drop first. */
const MAX_IDS = 500;

let ids: ReadonlySet<string> = new Set();
/** The signed-in user whose ids `ids` holds (null until read, or after sign-out). */
let owner: string | null = null;
let epoch = 0;
let adopting: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  ids = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return []; // a damaged entry starts clean rather than failing the feed
  }
}

/** Reads the signed-in account's saved ids once per account; resolves to that account's id. */
function adopt(): Promise<string | null> {
  adopting ??= (async (): Promise<string | null> => {
    const startedAt = epoch;
    let userId: string | null = null;
    try {
      userId = (await readUserCache())?.id ?? null;
    } catch {
      userId = null;
    }
    if (startedAt !== epoch) return null;
    if (!userId) {
      adopting = null; // not signed in yet: try again on the next mount
      return null;
    }
    if (owner === userId) return owner;
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId).catch(() => null);
    if (startedAt !== epoch) return null;
    // Ids marked before this first read belong to this session's account; a different account's never do.
    const carried = owner === null ? [...ids] : [];
    owner = userId;
    publish(new Set([...parseIds(raw), ...carried]));
    return owner;
  })();
  return adopting;
}

function save(userId: string): void {
  void AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify([...ids].slice(-MAX_IDS))).catch(() => {
    // Best effort: the fold still holds for this session.
  });
}

/** Sign-out (or an account change): forget the ids in memory, and on sign-out on the phone too. */
function drop(removeSaved: boolean): void {
  epoch += 1;
  adopting = null;
  const was = owner;
  owner = null;
  publish(new Set());
  if (removeSaved && was) void AsyncStorage.removeItem(KEY_PREFIX + was).catch(() => undefined);
}

// Tests may stand in a partial authEvents (emit or onAuthChange only), so guard like dunningLockoutStore.
if (typeof authEvents?.on === 'function') authEvents.on('logout', () => drop(true));
if (typeof authEvents?.onAuthChange === 'function') {
  authEvents.onAuthChange(() => {
    // A sign-in reads the new account; the same account keeps its ids. A sign-out emits this first and
    // then 'logout' (which bumps the epoch at once), so the read below stands down for it.
    const at = epoch;
    void Promise.resolve()
      .then(() => readUserCache())
      .then((u) => {
        if (at !== epoch) return;
        if (owner !== null && u?.id !== owner) drop(false);
        void adopt();
      })
      .catch(() => undefined);
  });
}

/** Folds the note away for this viewer now, and saves it for this account once the account is known. */
export function markVoiceNoteReported(id: string): void {
  if (!ids.has(id)) publish(new Set([...ids, id]));
  const marked = epoch;
  void adopt().then((userId) => {
    if (userId && marked === epoch && owner === userId) save(userId);
  });
}

/** The notes this viewer reported (re-renders when the set changes; reads the saved ids on first use). */
export function useReportedVoiceNotes(): ReadonlySet<string> {
  const set = useSyncExternalStore(subscribe, () => ids, () => ids);
  useEffect(() => {
    void adopt();
  }, []);
  return set;
}

/** Test seam: forget every reported note in memory (as a cold start would); storage is left alone. */
export function resetReportedVoiceNotes(): void {
  epoch += 1;
  adopting = null;
  owner = null;
  publish(new Set());
}
