/**
 * ackTelemetry — v2-2 coach ack-signal PostHog events (R1 fixer, M-P1a).
 *
 * The R1 UX audit flagged that the ack surface shipped with NO analytics, so we
 * could not measure adoption (are coaches actually using the badges / actions?)
 * or SLA outcomes. This module centralises the four ack events behind small
 * typed wrappers over the lib-level `track(event: string, props)` sink.
 *
 * WHY the lib-level sink (not the typed `posthog.service` wrapper): the typed
 * wrapper enforces the `AnalyticsEventName` union declared in
 * `src/analytics/events.ts`, which is OUTSIDE this PR's allowed-file lane (it is
 * a shared, cross-surface registry). Routing through the string-level `track`
 * keeps the ack telemetry self-contained in the community/coach lane while
 * still flowing through the same PII-stripping PostHog pipeline. The event names
 * use the documented `community.ack.*` namespace so they remain greppable and
 * can be promoted into the typed registry in a later, registry-scoped change.
 *
 * PII: only message ids (uuids) + bounded enum states are sent — never names,
 * bodies, or any client content. The lib sink additionally strips PII keys.
 */
import { track } from '../../../lib/analytics';
import type { CoachAckState, CoachSlaState } from '../../../api/coachCommunityApi';

/** Event-name constants — single source of truth for the four ack events. */
export const ACK_TELEMETRY_EVENTS = {
  badgeRendered: 'community.ack.badge_rendered',
  actionPressed: 'community.ack.action_pressed',
  detailOpened: 'community.ack.detail_opened',
  replied: 'community.ack.replied',
} as const;

/** Fired when a CoachAckBadge renders for a message (adoption / exposure). */
export function trackAckBadgeRendered(args: {
  messageId: string;
  state: CoachAckState;
  slaState: CoachSlaState | null;
}): void {
  track(ACK_TELEMETRY_EVENTS.badgeRendered, {
    message_id: args.messageId,
    state: args.state,
    sla_state: args.slaState,
  });
}

/** Fired when a coach taps an ack quick-action (seen/acked/replied). */
export function trackAckActionPressed(args: {
  messageId: string;
  fromState: CoachAckState;
  action: Exclude<CoachAckState, 'none'>;
}): void {
  track(ACK_TELEMETRY_EVENTS.actionPressed, {
    message_id: args.messageId,
    from_state: args.fromState,
    action: args.action,
  });
}

/** Fired when the coach opens the message-detail surface for a message. */
export function trackAckDetailOpened(args: {
  messageId: string;
  state: CoachAckState;
}): void {
  track(ACK_TELEMETRY_EVENTS.detailOpened, {
    message_id: args.messageId,
    state: args.state,
  });
}

/** Fired when a reply succeeds on the detail surface (SLA-closing event). */
export function trackAckReplied(args: { messageId: string }): void {
  track(ACK_TELEMETRY_EVENTS.replied, { message_id: args.messageId });
}
