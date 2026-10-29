/**
 * ThreadHeader — header for a single thread / post-detail screen. Shows the
 * post title and an optional coach acknowledgement signal (product plan §2.4).
 * Threads are first-class on mobile (full-screen, not a side panel — §3 row 3).
 *
 * Standardized on semanticColors / tokens.ts.
 *
 * FR-880R3 (Sol B2, #172-10): `tone="deep"` is Voice B Studio frame 05b's compact deep-forest bar: Back where 05b has
 * its navigation button, a light 20 pt title, and `trailing` where 05b has its info button (an empty 44 pt slot when
 * there is nothing to offer, never a dead button). The community DM and the voice note page (FR-865R4) use it; every
 * other screen keeps the default.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, spacing } from '../../theme/tokens';
import AckSignalChip, { type AckSignal } from './AckSignalChip';

export interface ThreadHeaderProps {
  title: string;
  /** Optional coach ack signal to surface to the client. */
  ackSignal?: AckSignal;
  /** "deep": frame 05b's deep-forest bar (community DM). Default: the light header. */
  tone?: 'default' | 'deep';
  /** Deep tone: Back, in 05b's navigation position. */
  onBack?: () => void;
  /** Deep tone: what sits in 05b's info position. */
  trailing?: React.ReactNode;
  testID?: string;
}

export default function ThreadHeader({
  title,
  ackSignal,
  tone = 'default',
  onBack,
  trailing,
  testID,
}: ThreadHeaderProps): React.ReactElement {
  const { semanticColors } = useTheme();
  if (tone === 'deep') {
    return (
      <View style={styles.deep} testID={testID}>
        <View style={styles.slot}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={4}
              testID={testID ? `${testID}-back` : undefined} style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={24} color={fp.onDeep} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.deepTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
        <View style={styles.slot}>{trailing}</View>
      </View>
    );
  }
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
  // 05b: deep forest (#1C3023), 44 pt targets at each end, a 20 pt semibold light title (as m#871's space chat bar).
  deep: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm,
    backgroundColor: fp.deep,
  },
  slot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  deepTitle: { flex: 1, minWidth: 0, fontFamily: 'Inter_600SemiBold', fontSize: 20, lineHeight: 25, fontWeight: '600', color: fp.onDeep },
  pressed: { opacity: 0.6 },
});
