// Supabase Realtime "ping" signals for coach-client chat (MSGRT).
//
// Realtime never carries message rows or text. The backend sends an empty
// broadcast (`{}`) and the app refetches through the authenticated REST API,
// which enforces tenant isolation. Each person has one PRIVATE topic,
// `messages:user:<User.id>`: the backend pings both people in a chat on every
// send, read, edit, delete, pin and unpin. Its Realtime policy (backend
// migration 20270502003700) lets only the signed-in owner of the topic
// receive, and nobody but the server sends.
//
// - Auth: `accessToken` reads the signed-in Supabase access token from secure
//   storage; setAuth() reads it before every join and after every token
//   refresh (refreshRealtimeAuth, called by services/api.ts). Never logged.
// - One channel per person: realtime-js keeps one channel per topic, so every
//   screen's listener shares it. It goes when the last listener leaves (sign-
//   out unmounts every screen), and Realtime auth is read again then, which
//   clears it after sign-out. Another person's id (account switch) replaces it.
// - Pings are debounced (trailing, PING_DEBOUNCE_MS): a broadcast to 100
//   clients pings the coach 100 times and becomes one refetch.
// - Poll only: a join that is refused or fails (a server without the policy,
//   an expired token, no network) and a channel the server closes (its token
//   expired) are removed silently. The screens' 60 s poll and focus refresh
//   carry on, and the next screen or token refresh joins again. A joined
//   channel that drops with the network rejoins by itself.
// - One client, one socket: the community pings (api/communityRealtime.ts)
//   join their own private topic on this client and re-join from
//   onRealtimeAuthRefresh after a token refresh.

import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { secureStorage } from './secureStorage';

export const PING_DEBOUNCE_MS = 1000;

let client: SupabaseClient | null = null;

/** The app's one Realtime client (signed-in token from secure storage), shared by every private topic. */
export function getRealtimeClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      // The app keeps its own session (services/api.ts); this client only joins Realtime.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: {
        params: { eventsPerSecond: 5 },
        accessToken: () => secureStorage.getItem('supabase_token'),
      },
    });
  }
  return client;
}

interface Listener {
  onPing: () => void;
  onThreadUpdated?: () => void;
}

const listeners = new Set<Listener>();
let topic: string | null = null;
let channel: RealtimeChannel | null = null;
let leaving: Promise<unknown> = Promise.resolve();

function debounced(pick: (l: Listener) => (() => void) | undefined) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const ping = () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      for (const l of [...listeners]) {
        try {
          pick(l)?.();
        } catch {
          // A handler failure never reaches the realtime client.
        }
      }
    }, PING_DEBOUNCE_MS);
  };
  return { ping, cancel };
}
const newMessage = debounced((l) => l.onPing);
const threadUpdated = debounced((l) => l.onThreadUpdated);

function drop(ch: RealtimeChannel | null): void {
  if (!ch || ch !== channel) return;
  channel = null;
  // Awaited by the next join: realtime-js would hand back a channel still leaving.
  leaving = getRealtimeClient().removeChannel(ch).catch(() => undefined);
}

async function join(myTopic: string): Promise<void> {
  await leaving;
  const { realtime } = getRealtimeClient();
  await realtime.setAuth();
  // Signed out, another person meanwhile, or already joined: nothing to do.
  const token = realtime.accessTokenValue;
  if (topic !== myTopic || channel || !token) return;
  let joined = false;
  const ch = getRealtimeClient()
    .channel(myTopic, { config: { private: true, broadcast: { self: false } } })
    .on('broadcast', { event: 'new-message' }, newMessage.ping)
    .on('broadcast', { event: 'thread-updated' }, threadUpdated.ping);
  channel = ch;
  ch.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') joined = true;
    else if (ch === channel && (!joined || status === 'CLOSED')) {
      drop(ch);
      // A token refresh landed meanwhile: join again with the new token.
      if (realtime.accessTokenValue !== token) void join(myTopic).catch(() => undefined);
    }
  });
}

const authRefreshHooks = new Set<() => void>();

/** Another topic on this client (community pings) runs `hook` after every token refresh. */
export function onRealtimeAuthRefresh(hook: () => void): void {
  authRefreshHooks.add(hook);
}

/** After a token refresh: the open channel gets the new token, or a lost one joins again. */
export function refreshRealtimeAuth(): void {
  if (!client) return;
  if (topic && !channel) void join(topic).catch(() => undefined);
  else void client.realtime.setAuth().catch(() => undefined);
  for (const hook of authRefreshHooks) {
    try {
      hook();
    } catch {
      // A hook failure never reaches the token refresh.
    }
  }
}

function leaveAll(): void {
  listeners.clear();
  topic = null;
  newMessage.cancel();
  threadUpdated.cancel();
  drop(channel);
  if (client) void client.realtime.setAuth().catch(() => undefined);
}

/**
 * Listen for message pings on the signed-in person's own topic. `userId` is
 * their backend User.id. `onPing` runs for `new-message`, `onThreadUpdated`
 * (optional) for `thread-updated` (read receipts, edits, deletes, pins); each
 * at most once per PING_DEBOUNCE_MS burst. Either way the answer is "refetch".
 * Returns the unsubscribe that callers MUST invoke on unmount or blur.
 */
export function subscribeToMessages(
  userId: string,
  onPing: () => void,
  onThreadUpdated?: () => void,
): () => void {
  if (!userId) return () => {};
  const myTopic = `messages:user:${userId}`;
  if (topic && topic !== myTopic) leaveAll();
  topic = myTopic;
  const listener: Listener = { onPing, onThreadUpdated };
  listeners.add(listener);
  if (!channel) void join(myTopic).catch(() => undefined);
  return () => {
    if (listeners.delete(listener) && listeners.size === 0) leaveAll();
  };
}
