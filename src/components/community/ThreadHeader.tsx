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
import { forestPop as fp, radius, spacing } from '../../theme/tokens';
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
  /** COACH-DM-M (Studio): a line under the title, the person's initials beside it, and Close in place of Back. Unset,
   * the bar draws exactly as before (the client's DM thread and the voice note page pass none). */
  subtitle?: string;
  initials?: string | null;
  backKind?: 'back' | 'close';
  testID?: string;
}

export default function ThreadHeader({
  title,
  ackSignal,
  tone = 'default',
  onBack,
  trailing,
  subtitle,
  initials,
  backKind = 'back',
  testID,
}: ThreadHeaderProps): React.ReactElement {
  const { semanticColors } = useTheme();
  if (tone === 'deep') {
    const close = backKind === 'close';
    const heading = (
      <Text style={[styles.deepTitle, subtitle ? styles.stacked : null]} numberOfLines={1} accessibilityRole="header">{title}</Text>
    );
    return (
      <View style={styles.deep} testID={testID}>
        <View style={styles.slot}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={close ? 'Close' : 'Back'} hitSlop={4}
              testID={testID ? `${testID}-${close ? 'close' : 'back'}` : undefined} style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
              <Ionicons name={close ? 'close' : 'chevron-back'} size={24} color={fp.onDeep} />
            </Pressable>
          ) : null}
        </View>
        {initials ? <View style={styles.tile}><Text style={styles.tileText}>{initials}</Text></View> : null}
        {subtitle ? (
          <View style={styles.titles}>
            {heading}
            <Text style={styles.deepSub} numberOfLines={2}>{subtitle}</Text>
          </View>
        ) : heading}
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
  // COACH-DM-M (Studio thread bar): the initials tile, and the title with its line under it.
  titles: { flex: 1, minWidth: 0 },
  stacked: { flex: 0 },
  deepSub: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 19, color: fp.onDeepMuted },
  tile: { width: 40, height: 40, marginRight: spacing.xs, borderRadius: radius.input, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, fontWeight: '600', color: fp.deep },
  pressed: { opacity: 0.6 },
});
