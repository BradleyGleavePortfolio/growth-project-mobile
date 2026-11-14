/**
 * MessageBubble — a single DM message bubble. Mine vs. theirs alignment, a
 * relative timestamp, and a "sending" treatment for optimistic (temp-id)
 * messages until the server reconciles. Standardized on semanticColors /
 * tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { colors, forestPop, neutral, spacing, radius } from '../../theme/tokens';
import { isOptimisticId } from '../../hooks/useCommunity';
import type { CommunityDmMessage } from '../../api/communityApi';
import { formatTime } from '../../calendar/calendarTime';

export interface MessageBubbleProps {
  message: CommunityDmMessage;
  /** Calling client's user id, to decide alignment. */
  myUserId: string;
  /** COACH-DM-M (Studio): the send time inside the bubble, in the phone's zone. Unset, nothing changes. */
  showTime?: boolean;
  /** REFINE-962 (Studio bubbles, S_thread_ios.html:73-:77): 16 pt words, 12.5 pt times, radius 18, the other person's
   * bubble white with a sage line; the caller's box sets the width. Only the coach's DM thread passes it; unset, the
   * bubble draws as before. A dark theme keeps its own colours. */
  studio?: boolean;
  /** REFINE-985 (C6CHAT-S-V2 c08, src/screens.py:122-127; the time's type from Voice B 05b .mtime :40): radius 18 with 6 at
   * the tail, padding 10 14, at most 78% wide, the other person's bubble white with a 1 pt sage line, a 13 pt time 4 below
   * the words. Only the client's DM thread passes it; unset, the bubble draws as before. A dark theme keeps its colours. */
  voiceB?: boolean;
  testID?: string;
}

export default function MessageBubble({
  message,
  myUserId,
  showTime,
  studio = false,
  voiceB = false,
  testID,
}: MessageBubbleProps): React.ReactElement {
  const { semanticColors, colorScheme } = useTheme();
  const studioLight = studio && colorScheme !== 'dark';
  const voiceBLight = voiceB && colorScheme !== 'dark';
  const mine = message.sender_user_id === myUserId;
  const sending = isOptimisticId(message.id);
  const body = message.deleted ? 'Message removed' : message.body ?? '';

  return (
    <View
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, studio ? styles.studioRow : null]}
      testID={testID}
    >
      <View
        testID={(studio || voiceB) && testID ? `bubble-${testID}` : undefined}
        style={[
          styles.bubble,
          {
            backgroundColor: mine
              ? semanticColors.accent
              : semanticColors.bgSurface,
            borderColor: semanticColors.border,
            opacity: sending ? 0.6 : 1,
          },
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          studio ? [styles.studioBubble, mine ? styles.studioMine : styles.studioTheirs] : null,
          studioLight && !mine ? { backgroundColor: neutral[0], borderColor: forestPop.sageLine } : null,
          voiceB ? [styles.voiceBBubble, mine ? styles.voiceBMine : styles.voiceBTheirs] : null,
          voiceBLight && !mine ? { backgroundColor: neutral[0], borderColor: forestPop.sageLine } : null,
        ]}
      >
        <Text
          style={[
            styles.body,
            studio ? styles.studioBody : null,
            {
              color: mine
                ? semanticColors.textOnAccent
                : semanticColors.textPrimary,
              fontStyle: message.deleted ? 'italic' : 'normal',
            },
          ]}
        >
          {body}
        </Text>
        {sending ? (
          <Text
            style={[styles.status, { color: semanticColors.textOnAccent }]}
            accessibilityLabel="Sending"
          >
            Sending…
          </Text>
        ) : showTime ? (
          <Text style={[styles.status, !mine && styles.timeTheirs, { color: mine ? semanticColors.textOnAccent : semanticColors.textMuted },
            studio ? styles.studioTime : null, studioLight ? { color: mine ? forestPop.onDeepMuted : forestPop.n700 } : null,
            voiceB ? styles.voiceBTime : null, voiceBLight ? { color: mine ? forestPop.onDeepMuted : colors.graphite } : null]}>
            {formatTime(new Date(message.created_at))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleMine: {
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    borderBottomLeftRadius: radius.sm,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
  },
  status: {
    fontSize: 11,
    marginTop: 2,
    textAlign: 'right',
  },
  timeTheirs: { textAlign: 'left' },
  // REFINE-962 `studio`: .bub padding 12px 16px 10px, radius 18px (mine 18 18 4 18), them 1.5px line; .bt 12.5px, 6px above.
  studioRow: { paddingHorizontal: 0, paddingVertical: 0 },
  studioBubble: { maxWidth: '100%', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderRadius: 18 },
  studioMine: { borderBottomRightRadius: 4, borderWidth: 0 },
  studioTheirs: { borderBottomLeftRadius: 18, borderWidth: 1.5 },
  studioBody: { fontSize: 16, lineHeight: 22 },
  studioTime: { fontSize: 12.5, marginTop: 6 },
  // REFINE-985 `voiceB`: c08 bubble (max-width 78%, padding 10px 14px, radius 18px, 6px at the tail, them a 1 px line);
  // the time 05b .mtime 13px (line-height 1.3), c08's 4px above; mine #B8CCBF (5.81:1 on forest), theirs graphite
  // #2C2C2C (owner #168-13; 13.97:1 on white).
  voiceBBubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  voiceBMine: { borderBottomRightRadius: 6, borderWidth: 0 },
  voiceBTheirs: { borderBottomLeftRadius: 6, borderWidth: 1 },
  voiceBTime: { fontSize: 13, lineHeight: 16.9, marginTop: 4 },
});
