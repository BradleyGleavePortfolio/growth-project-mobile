// Lightweight Supabase Realtime helper for message-arrived "ping" signals.
//
// Architecture choice: we deliberately do NOT use Realtime to deliver message
// rows. Doing that would require Postgres RLS to be perfectly configured for
// the messages table — any misconfig leaks every user's DMs to every other
// user's WebSocket. The backend's REST API already enforces tenant isolation
// via the JWT-scoped guards from Fix #3 / Fix #4, so we keep data delivery
// there.
//
// Instead we use Realtime BROADCAST channels (server-to-client pings with no
// row payload). When the backend processes a message send, it broadcasts an
// empty signal on `messages:{recipientUserId}`. Subscribed clients receive
// the ping and trigger a React Query invalidation, fetching the actual
// message list through the authenticated REST endpoint.
//
// This gives us:
//  - sub-second perceived latency (no more 15s polling)
//  - zero PII over the WebSocket
//  - no RLS risk \u2014 Broadcast is opt-in per channel, no DB rows are exposed
//  - graceful degradation \u2014 if Realtime fails, the existing setInterval
//    fallback keeps working

import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        // Realtime client doesn't need to manage its own session \u2014 we use
        // anon role + Broadcast which doesn't touch RLS-protected tables.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    });
  }
  return client;
}

/**
 * Subscribe to message-arrived pings for the given user. Returns an unsubscribe
 * function that callers MUST invoke on unmount to free the WebSocket.
 *
 * The handler is called whenever the backend broadcasts on the user's channel
 * \u2014 either because they received a new message, or one of their own outbound
 * messages was acknowledged. Either way the right response is "refetch".
 */
export function subscribeToMessages(
  userId: string,
  onPing: () => void,
): () => void {
  if (!userId) return () => {};

  const supabase = getClient();
  const channelName = `messages:${userId}`;

  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase
      .channel(channelName, {
        config: {
          // Broadcast self=false is the default \u2014 we don't want to bounce our
          // own outgoing pings back to ourselves. The backend is the only sender.
          broadcast: { self: false },
        },
      })
      .on('broadcast', { event: 'new-message' }, () => {
        try {
          onPing();
        } catch {
          // Handler failures must never propagate into the realtime client \u2014
          // they would tear down the entire WebSocket.
        }
      })
      .subscribe();
  } catch {
    // If Realtime fails to initialise (no network, blocked WebSocket, etc.)
    // we silently fall back to the caller's polling loop. Returning a noop
    // unsubscribe keeps the call site uniform.
    return () => {};
  }

  return () => {
    try {
      if (channel) supabase.removeChannel(channel);
    } catch {
      /* noop */
    }
  };
}
