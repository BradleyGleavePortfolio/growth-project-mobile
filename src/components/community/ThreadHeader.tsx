/**
 * ThreadHeader — header for a single thread / post-detail screen. Shows the
 * post title and an optional coach acknowledgement signal (product plan §2.4).
 * Threads are first-class on mobile (full-screen, not a side panel — §3 row 3).
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';
import AckSignalChip, { type AckSignal } from './AckSignalChip';

export interface ThreadHeaderProps {
  title: string;
  /** Optional coach ack signal to surface to the client. */
  ackSignal?: AckSignal;
  testID?: string;
}

export default function ThreadHeader({
  title,
  ackSignal,
  testID,
}: ThreadHeaderProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View
      style={[styles.header, { borderBottomColor: semanticColors.border }]}
      testID={testID}
    >
      <Text
        style={[styles.title, { color: semanticColors.textPrimary }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {ackSignal ? (
        <View style={styles.ack}>
          <AckSignalChip signal={ackSignal} testID="thread-ack" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  ack: {
    marginTop: spacing.xs,
  },
});
