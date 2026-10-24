// AlertRow — single row for the AtRisk and ActionQueue screens.
//
// Displays a client name, alert message, and bucket indicator.
// Tappable. Dismiss is handled via an inline button.
//
// Doctrine: no emoji. No flame icon. Risk shown via text label + colour
// accent, not pictographic chrome.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { colors, lightTokens, spacing, typography, radius } from '../../theme/tokens';
import { Colors } from '../../constants/colors';
import type { RiskBucket } from '../../services/commandCenterApi';

// Bucket → left-border accent only.
// Red = oxblood, Amber = mutedGold, Green = forest.
const BUCKET_ACCENT: Record<RiskBucket, string> = {
  red:   Colors.earningsAccent,  // oxblood
  amber: Colors.warning,  // mutedGold
  green: Colors.primary,  // forest
};

const BUCKET_LABEL: Record<RiskBucket, string> = {
  red:   'High risk',
  amber: 'Moderate risk',
  green: 'On track',
};

interface AlertRowProps {
  clientName: string;
  message: string;
  bucket?: RiskBucket;
  onPress: () => void;
  onDismiss?: () => void;
  /** Lines of `message` before it truncates (default 3). */
  messageLines?: number;
  /** Visible label for what tapping the row does, e.g. "Message Sam". */
  actionLabel?: string;
  /**
   * Safety alert card (owner 57w, 57x): the message already names the
   * client, so the name header is left out, and `quote` (the client's own
   * message) shows under it on one muted line, cut off with an ellipsis.
   */
  quote?: string | null;
  hideClientName?: boolean;
  testID?: string;
  style?: ViewStyle;
}

export default function AlertRow({
  clientName,
  message,
  bucket,
  onPress,
  onDismiss,
  messageLines = 3,
  actionLabel,
  quote,
  hideClientName = false,
  testID,
  style,
}: AlertRowProps) {
  const accent = bucket ? BUCKET_ACCENT[bucket] : colors.camel;
  const bucketLabel = bucket ? BUCKET_LABEL[bucket] : undefined;
  const quoteLine = quote ? quote.replace(/\s+/g, ' ').trim() : '';
  // A screen reader hears the card's words once, without the arrow glyph.
  const label = hideClientName
    ? `${message.replace(/\s*→\s*$/, '.')}${quoteLine ? ` ${quoteLine}` : ''}`
    : `${clientName}. ${bucketLabel ? `${bucketLabel}. ` : ''}${message}${
        actionLabel ? ` ${actionLabel}.` : ''
      }`;

  return (
    <TouchableOpacity
      onPress={onPress}
      testID={testID ?? 'command-center-at-risk-row'}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.row, { borderLeftColor: accent }, style]}
      activeOpacity={0.75}
    >
      <View style={styles.content}>
        {hideClientName ? null : (
          <View style={styles.header}>
            <Text style={styles.clientName} numberOfLines={1}>
              {clientName}
            </Text>
            {bucketLabel ? (
              <Text
                style={[styles.bucketLabel, { color: accent }]}
                numberOfLines={1}
              >
                {bucketLabel}
              </Text>
            ) : null}
          </View>
        )}
        <Text
          style={hideClientName ? styles.safetyLine : styles.message}
          numberOfLines={messageLines}
        >
          {message}
        </Text>
        {quoteLine ? (
          <Text
            style={styles.quote}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID="command-center-alert-quote"
          >
            {quoteLine}
          </Text>
        ) : null}
        {actionLabel ? (
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        ) : null}
      </View>
      {onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss alert for ${clientName}`}
          testID="command-center-alert-dismiss"
          style={styles.dismissButton}
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  clientName: {
    ...typography.bodyMd,
    color: colors.ink,
    flex: 1,
    marginRight: spacing.sm,
  },
  bucketLabel: {
    ...typography.eyebrow,
    // colour applied inline
  },
  message: {
    ...typography.bodySmall,
    color: colors.charcoal,
    lineHeight: 20,
  },
  safetyLine: {
    ...typography.bodyMd,
    color: colors.ink,
  },
  quote: {
    ...typography.bodySmall,
    // Muted but AA on the cream card (stone is meta-only, below AA).
    color: lightTokens.textMuted,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  actionLabel: {
    ...typography.bodySmall,
    color: colors.forest,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  dismissButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dismissText: {
    ...typography.eyebrow,
    color: colors.graphite,
  },
});
