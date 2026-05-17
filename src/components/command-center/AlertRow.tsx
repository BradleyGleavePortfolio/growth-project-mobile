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
import { colors, spacing, typography, radius } from '../../theme/tokens';
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
  testID?: string;
  style?: ViewStyle;
}

export default function AlertRow({
  clientName,
  message,
  bucket,
  onPress,
  onDismiss,
  testID,
  style,
}: AlertRowProps) {
  const accent = bucket ? BUCKET_ACCENT[bucket] : colors.camel;
  const bucketLabel = bucket ? BUCKET_LABEL[bucket] : undefined;

  return (
    <TouchableOpacity
      onPress={onPress}
      testID={testID ?? 'command-center-at-risk-row'}
      accessibilityRole="button"
      accessibilityLabel={`${clientName}. ${bucketLabel ? `${bucketLabel}. ` : ''}${message}`}
      style={[styles.row, { borderLeftColor: accent }, style]}
      activeOpacity={0.75}
    >
      <View style={styles.content}>
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
        <Text style={styles.message} numberOfLines={3}>
          {message}
        </Text>
      </View>
      {onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
  dismissButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dismissText: {
    ...typography.eyebrow,
    color: colors.stone,
  },
});
