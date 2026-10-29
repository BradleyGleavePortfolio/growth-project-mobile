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
 *   - PRIVATE topic (backend C10RT): every ping is a private broadcast on
 *     `community:user:<User.id>`, and Realtime lets only the signed-in owner of
 *     the topic receive it (policy community_realtime_own_topic_receive,
 *     backend migration 20270502003300). So we join privately on the app's one
 *     Realtime client (services/realtime.ts: signed-in token from secure
 *     storage, setAuth before every join and after every token refresh).
 *   - One channel per person, shared by every listener; it goes with the last
 *     one (sign-out unmounts them all) and another person's id replaces it. A
 *     refused or failed join and a channel the server closes are dropped
 *     quietly (the poll carries on); the next listener or token refresh joins
 *     again.
 *
 * The channel + event string constants below MIRROR the backend's single
 * source of truth (community-events.ts). If the backend renames an event, the
 * mirror here must change in lockstep; the contract test pins the strings.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { getRealtimeClient, onRealtimeAuthRefresh } from '../services/realtime';

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

type Listener = (ping: CommunityPing) => void;

const listeners = new Set<Listener>();
let topic: string | null = null;
let channel: RealtimeChannel | null = null;
let leaving: Promise<unknown> = Promise.resolve();

/** Each bound event reaches every listener, with its name only (never the payload). */
function deliver(event: CommunityBroadcastEventName): void {
  for (const l of [...listeners]) {
    try {
      l({ event });
    } catch {
      // Handler failures must never tear down the WebSocket.
    }
  }
}

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
  let ch = getRealtimeClient().channel(myTopic, { config: { private: true, broadcast: { self: false } } });
  for (const event of Object.values(COMMUNITY_BROADCAST_EVENTS)) {
    ch = ch.on('broadcast', { event }, () => deliver(event));
  }
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

// After a token refresh (services/api.ts): a lost channel joins again; an open
// one already has the new token from refreshRealtimeAuth's setAuth.
onRealtimeAuthRefresh(() => {
  if (topic && !channel) void join(topic).catch(() => undefined);
});

function leaveAll(): void {
  listeners.clear();
  topic = null;
  drop(channel);
  void getRealtimeClient().realtime.setAuth().catch(() => undefined);
}

/**
 * Subscribe to the calling client's per-user community channel. The handler
 * fires whenever the backend broadcasts an unread-affecting event (new cohort
 * message, new DM, mention, membership change). The right response is always
 * "refetch /community/me" — which the badge hook does — NOT "trust this
 * payload." Returns an unsubscribe the caller MUST invoke on unmount.
 *
 * @param userId  the calling client's backend User.id (useCurrentUser().id).
 * @param onPing  invoked with the coarse event name on every broadcast.
 */
export function subscribeToCommunityUser(
  userId: string,
  onPing: (ping: CommunityPing) => void,
): () => void {
  if (!userId) return () => {};
  const myTopic = communityChannels.user(userId);
  if (topic && topic !== myTopic) leaveAll();
  topic = myTopic;
  const listener: Listener = (ping) => onPing(ping);
  listeners.add(listener);
  if (!channel) void join(myTopic).catch(() => undefined);
  return () => {
    if (listeners.delete(listener) && listeners.size === 0) leaveAll();
  };
}
