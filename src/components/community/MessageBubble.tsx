/**
 * MessageBubble — a single DM message bubble. Mine vs. theirs alignment, a
 * relative timestamp, and a "sending" treatment for optimistic (temp-id)
 * messages until the server reconciles. Standardized on semanticColors /
 * tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { isOptimisticId } from '../../hooks/useCommunity';
import type { CommunityDmMessage } from '../../api/communityApi';

export interface MessageBubbleProps {
  message: CommunityDmMessage;
  /** Calling client's user id, to decide alignment. */
  myUserId: string;
  testID?: string;
}

export default function MessageBubble({
  message,
  myUserId,
  testID,
}: MessageBubbleProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const mine = message.sender_user_id === myUserId;
  const sending = isOptimisticId(message.id);
  const body = message.deleted ? 'Message removed' : message.body ?? '';

  return (
    <View
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
      testID={testID}
    >
      <View
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
        ]}
      >
        <Text
          style={[
            styles.body,
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
});
