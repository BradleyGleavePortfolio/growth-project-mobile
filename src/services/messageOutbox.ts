/**
 * The Style B outbox (C3B-THREAD-R1, featureFlags.c3StyleB): the one ordered, keyed dispatcher for the client's coach
 * thread. Every Style B send goes through it: a fresh send, a tap on a failed bubble or its status line, long-press
 * Send again, and the automatic send when the app opens, the signal returns or the app comes back to the foreground
 * (useMessageOutboxDrain, mounted by ClientNavigator, so it runs whether or not the thread is open).
 *
 * - Each message gets its client_message_id when it is written and keeps it, so every send and replay is one the
 *   server dedupes (POST /messages, messaging.service insertThreadMessage; the same route with v2 on or off).
 * - One message at a time, in the order written. One that fails stops the ones after it until the client taps it;
 *   a send made during a drain queues behind it. A refusal that can never be accepted does not hold the rest (refusal).
 * - Saved per user as messages_thread_outbox_<id> in AsyncStorage, outside what sign-out wipes: it survives leaving the
 *   thread, closing the app and signing out, and sends on that account's next sign-in. No other account reads or sends it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { messagingV2Api, toMessagingError, type MessagingApiError, type ThreadMessage } from '../api/messagingV2Api';
import { newClientMessageId } from '../components/messaging/threadV2';
import { isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { readUserCacheSync } from '../lib/userCache';

export interface OutboxItem {
  key: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  /** Not sent while online, or refused: it waits for a tap and holds the ones after it. */
  failed?: boolean;
  /** Can never be accepted as written: it holds nothing, and a tap takes its text back to the composer. */
  refused?: boolean;
}

export type OutboxEvent =
  | { type: 'sent'; row: ThreadMessage }
  /** A 2xx this build cannot read: the server has the message, so reload the thread. */
  | { type: 'taken' }
  | { type: 'stopped'; error: MessagingApiError; manual: boolean };

type Listener = (items: OutboxItem[], event?: OutboxEvent) => void;

export const OUTBOX_KEY_PREFIX = 'messages_thread_outbox_';
const storageKey = (uid: string) => `${OUTBOX_KEY_PREFIX}${uid}`;

let owner: string | null = null;
let items: OutboxItem[] = [];
let ready: Promise<void> | null = null;
let running: Promise<void> | null = null;
let rerun: { manual: boolean } | null = null;
const listeners = new Set<Listener>();

/** No answer, a server fault or a rate limit: the message may still go; anything else is a refusal. */
export const isTransient = (e: MessagingApiError) => e.kind === 'network' || e.status >= 500 || e.status === 429;

/**
 * A refused send (backend src/messaging send path). 'retry': it can still go as written, so it keeps its place and holds
 * the rest (no answer, 5xx, 429, 408, 401, 403 blocked, 409 NO_COACH_ASSIGNED). 'unquote': the quoted message was deleted
 * (409 messaging.reply_target_unavailable), so it goes at once without it. 'permanent': any other 4xx (400, 404, 409 key reused).
 */
export function refusal(e: MessagingApiError): 'retry' | 'unquote' | 'permanent' {
  if (e.code === 'messaging.reply_target_unavailable') return 'unquote';
  const retry = e.kind === 'network' || e.status >= 500 || [401, 403, 408, 429].includes(e.status) || e.code === 'NO_COACH_ASSIGNED';
  return retry ? 'retry' : 'permanent';
}

function commit(uid: string, next: OutboxItem[], event?: OutboxEvent): void {
  if (owner !== uid) return;
  items = next;
  void AsyncStorage.setItem(storageKey(uid), JSON.stringify(next)).catch(() => undefined);
  listeners.forEach((l) => l(items, event));
}

function parse(raw: string | null): OutboxItem[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((i) => typeof i?.key === 'string' && typeof i?.body === 'string') : [];
  } catch {
    return [];
  }
}

async function onlineNow(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return isEffectivelyOnline({ isOnline: !!s.isConnected, isInternetReachable: s.isInternetReachable });
  } catch {
    return true;
  }
}

/** Reads the signed-in client's saved outbox once (async: the AsyncStorage shim has no synchronous read). */
export function hydrateOutbox(uid: string): Promise<void> {
  if (owner !== uid) {
    owner = uid;
    items = [];
    ready = null;
  }
  ready ??= AsyncStorage.getItem(storageKey(uid)).then((raw) => {
    if (owner !== uid) return;
    items = parse(raw);
    listeners.forEach((l) => l(items));
  }, () => undefined);
  return ready;
}

/** Sign-out or app close: forget the copy in memory; the saved list stays the only source. */
export function releaseOutbox(): void {
  owner = null;
  items = [];
  ready = null;
}

export const readOutbox = (uid: string): OutboxItem[] => (owner === uid ? items : []);

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A fresh send: written at the end with its own key, then sent in turn. */
export async function sendViaOutbox(uid: string, body: string, replyToId: string | null): Promise<void> {
  await hydrateOutbox(uid);
  commit(uid, [...items, { key: newClientMessageId(), body, replyToId, createdAt: new Date().toISOString() }]);
  return drainOutbox(uid);
}

/** A refused message leaves the outbox and is returned, for its text to go back to the composer. */
export function takeBackRefused(uid: string, key: string): OutboxItem | undefined {
  const item = readOutbox(uid).find((i) => i.key === key && i.refused);
  if (item) commit(uid, items.filter((i) => i !== item));
  return item;
}

/** Drops messages a thread read shows the server already has, so a lost reply never leaves one holding the rest. */
export function settleOutbox(uid: string, serverKeys: Array<string | null | undefined>): void {
  const next = readOutbox(uid).filter((i) => !serverKeys.includes(i.key));
  if (next.length !== items.length) commit(uid, next);
}

/** Sends the outbox in order. `manual` (a tap or Send again) also sends a failed first message. */
export function drainOutbox(uid: string, manual = false): Promise<void> {
  if (running) {
    rerun = { manual: manual || !!rerun?.manual };
    return running;
  }
  running = (async () => {
    try {
      let tapped = manual;
      for (;;) {
        await hydrateOutbox(uid);
        await sendInOrder(uid, tapped);
        if (!rerun) return;
        tapped = rerun.manual;
        rerun = null;
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function sendInOrder(uid: string, manual: boolean): Promise<void> {
  while (owner === uid && readUserCacheSync()?.id === uid) {
    const head = items.find((i) => !i.refused);
    if (!head || (head.failed && !manual)) return;
    try {
      const row = await messagingV2Api.sendMessage({ role: 'client' }, { body: head.body, clientMessageId: head.key, replyToId: head.replyToId });
      commit(uid, items.filter((i) => i.key !== head.key), { type: 'sent', row });
    } catch (err) {
      const error = toMessagingError(err);
      if (error.kind === 'contract') {
        commit(uid, items.filter((i) => i.key !== head.key), { type: 'taken' });
        continue;
      }
      const how = refusal(error);
      if (how !== 'retry') {
        const unquote = how === 'unquote' && !!head.replyToId;
        const next = items.map((i) => (i.key !== head.key ? i : unquote ? { ...i, replyToId: null } : { ...i, failed: true, refused: true }));
        commit(uid, next, unquote ? undefined : { type: 'stopped', error, manual });
        continue;
      }
      // Offline it keeps waiting for the signal; online, or refused, it waits for a tap.
      const failed = error.code === 'NO_COACH_ASSIGNED' ? !!head.failed : !isTransient(error) || (await onlineNow());
      commit(uid, items.map((i) => (i.key === head.key ? { ...i, failed } : i)), { type: 'stopped', error, manual });
      return;
    }
  }
}
