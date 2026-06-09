/**
 * communityRealtime — Supabase Realtime BROADCAST subscription for the
 * Community tab (v1-5 client surface over the v1-4 backend realtime layer).
 *
 * Architecture (mirrors src/services/realtime.ts and the backend doctrine in
 * growth-project-backend/src/community/community-events.ts):
 *   - We subscribe to BROADCAST channels only. The server emits IDs /
 *     timestamps / enum state values — NEVER user-authored text, names, emoji
 *     glyphs, or bodies. Receiving a ping means "something changed; refetch via
 *     the authenticated, tenant-scoped REST API." The channel is untrusted.
 *   - Data delivery NEVER rides Realtime: doing so would require perfect RLS on
 *     every community table. The REST guards already enforce tenant isolation.
 *   - Realtime is a BEST-EFFORT accelerator ABOVE the REST poll floor. If the
 *     WebSocket fails to init, the caller's polling/refetch keeps working —
 *     we return a no-op unsubscribe so the call site stays uniform.
 *
 * The channel + event string constants below MIRROR the backend's single
 * source of truth (community-events.ts). If the backend renames an event, the
 * mirror here must change in lockstep; the contract test pins the strings.
 */

import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// ─── Channel name builders (mirror COMMUNITY_REALTIME_CHANNELS) ──────────────

export const communityChannels = {
  /** Per-user channel — carries unread-affecting pings for the calling client. */
  user: (userId: string): string => `community:user:${userId}`,
  workspace: (wsId: string): string => `community:workspace:${wsId}:hall`,
} as const;

// ─── Broadcast event names (mirror COMMUNITY_BROADCAST_EVENTS) ───────────────

export const COMMUNITY_BROADCAST_EVENTS = {
  messageCreated: 'community.message.created',
  messageUpdated: 'community.message.updated',
  postCreated: 'community.post.created',
  postUpdated: 'community.post.updated',
  reactionChanged: 'community.reaction.changed',
  membershipChanged: 'community.membership.changed',
} as const;

export type CommunityBroadcastEventName =
  (typeof COMMUNITY_BROADCAST_EVENTS)[keyof typeof COMMUNITY_BROADCAST_EVENTS];

/**
 * The minimal ping shape the client acts on. We intentionally read ONLY the
 * coarse `event` discriminator and ignore the rest of the payload — the
 * client never trusts broadcast contents; it refetches via REST.
 */
export interface CommunityPing {
  event: CommunityBroadcastEventName;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        // Broadcast doesn't touch RLS-protected tables — anon role is fine and
        // the realtime client needn't manage its own session.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

/**
 * Subscribe to the calling client's per-user community channel. The handler
 * fires whenever the backend broadcasts an unread-affecting event (new cohort
 * message, new DM, mention, membership change). The right response is always
 * "refetch /community/me" — which the badge hook does — NOT "trust this
 * payload." Returns an unsubscribe the caller MUST invoke on unmount.
 *
 * @param userId  the calling client's user id (from auth/session).
 * @param onPing  invoked with the coarse event name on every broadcast.
 */
export function subscribeToCommunityUser(
  userId: string,
  onPing: (ping: CommunityPing) => void,
): () => void {
  if (!userId) return () => {};

  const supabase = getClient();
  const channelName = communityChannels.user(userId);
  const events = Object.values(COMMUNITY_BROADCAST_EVENTS);

  let channel: RealtimeChannel | null = null;
  try {
    let builder = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    for (const event of events) {
      builder = builder.on('broadcast', { event }, (msg) => {
        try {
          // We read only the event discriminator; the payload is untrusted.
          const evt = (msg?.event as CommunityBroadcastEventName) ?? event;
          onPing({ event: evt });
        } catch {
          // Handler failures must never tear down the WebSocket.
        }
      });
    }
    channel = builder.subscribe();
  } catch {
    // No network / blocked WebSocket → silent fallback to the caller's poll.
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
