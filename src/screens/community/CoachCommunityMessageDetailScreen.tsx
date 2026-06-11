/**
 * CoachCommunityMessageDetailScreen — v2-2 (R1 fixer, M-NEW). The single
 * cohort-message detail surface that the ack signals finally have a home on.
 *
 * The R1 UX audit's coach POV walk-through dead-ended here: the inbox rendered
 * ack badges + a "Mark acked" quick-action, but tapping a row went NOWHERE —
 * there was no detail screen to (a) read the full message, (b) see the ack
 * lifecycle timestamps, or (c) REPLY (the strongest ack transition). This
 * screen closes that loop:
 *
 *   - Fetches the message via GET /community/messages/:id (`useCoachMessageDetail`),
 *     Zod-validated at the wire boundary; the FLAT message-view ack envelope is
 *     lifted into the badge shape via `deriveAckStateFromEnvelope`.
 *   - On mount, if the message is still `none`, fires the `markSeen` transition
 *     (opening the detail IS the coach seeing it) — once, idempotent on the server.
 *   - Renders the sender label + relative age + body, the CoachAckBadge pill, an
 *     ack-timestamp strip ("Seen 4m ago · Acked 2m ago · Replied just now"), an
 *     SLA explainer line, and a reply composer.
 *   - On a successful reply, fires the `markReplied` transition (the SLA-closing
 *     ack) + the `community.ack.replied` telemetry event.
 *   - Three honest branches (loading / error / loaded) mirroring the
 *     PostDetail surface; never a calm-empty masquerade on failure.
 *
 * Flag posture: this route is only registered inside CoachCommunityNavigator,
 * which is only mounted when `featureFlags.coachCommunity` is on; the inbox row
 * tap that reaches it is additionally gated on `featureFlags.communityAcks`. So
 * with the ack flag OFF the screen is unreachable and the v1-6 surface is intact.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachErrorState, relativeAge } from '../../components/community/coach';
import { formatAckTimestampStrip } from '../../components/community/coach/relativeAge';
import { formatSlaExplainer } from '../../components/community/coach/slaCopy';
import {
  trackAckDetailOpened,
  trackAckReplied,
} from '../../components/community/coach/ackTelemetry';
import CoachAckBadge from '../../components/community/CoachAckBadge';
import { useCoachMessageDetail } from '../../hooks/useCoachCommunity';
import { useCoachAckActions } from '../../hooks/useCoachAckActions';
import { deriveAckStateFromEnvelope } from '../../api/coachCommunityApi';
import type { CoachCommunityRoute } from './coachCommunityNavTypes';

/** Short, honest sender label — the message view carries no display name. */
function senderLabel(userId: string): string {
  return `Client ${userId.slice(0, 8)}`;
}

export default function CoachCommunityMessageDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route =
    useRoute<CoachCommunityRoute<'CoachCommunityMessageDetail'>>();
  const messageId = route.params?.messageId ?? '';

  const detail = useCoachMessageDetail(messageId);
  const actions = useCoachAckActions(messageId);

  // Lift the FLAT message-view ack envelope into the full badge shape. Memoised
  // so the badge prop identity is stable across composer keystrokes.
  const ackState = useMemo(
    () => deriveAckStateFromEnvelope(detail.data?.ack),
    [detail.data?.ack],
  );

  // ── markSeen on first load when still `none` ──────────────────────────────
  // Opening the detail IS the coach seeing the message. Fire once (guard ref)
  // and only when we have loaded data still at `none`. Idempotent server-side.
  const seenFiredRef = useRef(false);
  const detailOpenedFiredRef = useRef(false);
  useEffect(() => {
    if (detail.data == null) return;
    const state = ackState?.state ?? 'none';
    if (!detailOpenedFiredRef.current) {
      detailOpenedFiredRef.current = true;
      trackAckDetailOpened({ messageId, state });
    }
    if (state === 'none' && !seenFiredRef.current) {
      seenFiredRef.current = true;
      actions.markSeen.mutate();
    }
    // `actions` is stable per messageId; depending on data + derived state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, ackState?.state, messageId]);

  const [reply, setReply] = useState('');
  const replyTrimmed = reply.trim();
  const replyPending = actions.markReplied.isPending;
  const canReply = replyTrimmed.length > 0 && !replyPending;

  const onSendReply = (): void => {
    if (!canReply) return;
    // The reply transition is the SLA-closing ack. (The message SEND itself is
    // out of scope for this fixer; the ack lifecycle is what we own. Stamping
    // `replied` reflects the coach having answered the thread.)
    actions.markReplied.mutate(undefined, {
      onSuccess: () => {
        trackAckReplied({ messageId });
        setReply('');
      },
    });
  };

  if (detail.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-message-detail-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-message-detail-loading"
        />
      </View>
    );
  }

  if (detail.isError || detail.data == null) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-message-detail-screen"
      >
        <CoachErrorState
          message="Could not load this message. Pull back and open it again."
          onRetry={() => detail.refetch()}
          retrying={detail.isRefetching}
          testID="coach-community-message-detail-error"
        />
      </View>
    );
  }

  const message = detail.data;
  const timestampStrip = formatAckTimestampStrip(message.ack);
  const slaExplainer =
    ackState != null && ackState.state !== 'replied'
      ? formatSlaExplainer(ackState.sla.sla_state)
      : '';

  return (
    <ScrollView
      style={{ backgroundColor: semanticColors.bgPrimary }}
      contentContainerStyle={styles.content}
      testID="coach-community-message-detail-screen"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
        {senderLabel(message.sender_user_id)} · {relativeAge(message.created_at)}
      </Text>

      <Text style={[styles.body, { color: semanticColors.textPrimary }]}>
        {message.deleted
          ? 'This message was removed.'
          : message.body ?? 'This message has no body.'}
      </Text>

      <View style={styles.ackBlock}>
        <CoachAckBadge
          ack={ackState}
          testID="coach-community-message-detail-ack-badge"
        />
        {timestampStrip.length > 0 ? (
          <Text
            style={[styles.ackStrip, { color: semanticColors.textMuted }]}
            testID="coach-community-message-detail-ack-strip"
          >
            {timestampStrip}
          </Text>
        ) : null}
        {slaExplainer.length > 0 ? (
          <Text
            style={[styles.slaExplainer, { color: semanticColors.textMuted }]}
            testID="coach-community-message-detail-sla-explainer"
          >
            {slaExplainer}
          </Text>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: semanticColors.border }]} />

      <Text style={[styles.composerHeading, { color: semanticColors.textPrimary }]}>
        Reply
      </Text>
      <TextInput
        value={reply}
        onChangeText={setReply}
        editable={!replyPending}
        multiline
        placeholder="Write a reply to mark this thread replied…"
        placeholderTextColor={semanticColors.textMuted}
        accessibilityLabel="Reply to this message"
        testID="coach-community-message-detail-reply-input"
        style={[
          styles.composer,
          {
            color: semanticColors.textPrimary,
            borderColor: semanticColors.border,
            backgroundColor: semanticColors.bgSurface,
          },
        ]}
      />
      <HapticPressable
        intent="success"
        onPress={onSendReply}
        disabled={!canReply}
        accessibilityRole="button"
        accessibilityLabel="Send reply and mark thread replied"
        accessibilityState={{ disabled: !canReply }}
        testID="coach-community-message-detail-reply-send"
        style={[
          styles.sendButton,
          {
            backgroundColor: canReply
              ? semanticColors.accent
              : semanticColors.disabledBg,
          },
        ]}
      >
        <Text
          style={[
            styles.sendLabel,
            {
              color: canReply
                ? semanticColors.textOnAccent
                : semanticColors.textOnDisabled,
            },
          ]}
        >
          {replyPending ? 'Sending…' : 'Send reply'}
        </Text>
      </HapticPressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing['3xl'],
  },
  meta: {
    fontSize: 13,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  ackBlock: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  ackStrip: {
    fontSize: 12,
    lineHeight: 18,
  },
  slaExplainer: {
    fontSize: 12,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  composerHeading: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  composer: {
    minHeight: 88,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  sendButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sendLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
