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
import { brand, forestPop as fp, radius, spacing } from '../../theme/tokens';
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
  /** REFINE-962 (Studio bar, S_list_ios.html:49-:50): an 18 pt title, Studio's padding and gap, a 26 pt Back. Only the
   * coach's DM screens pass it; unset, the deep bar draws as before (20 pt). */
  studio?: boolean;
  /** REFINE-985 (Voice B Studio 05b, B-05b-feed-1000_ios.html .mast :20, .mt :22, .mtt :23, .mts :24): a 19 pt title,
   * 05b's padding and gap, a 13 pt line under the title, and C6CHAT-S-V2 c08's person tile (.mono.sm). Only the client's
   * DM thread passes it; unset, the bar draws exactly as before. */
  voiceB?: boolean;
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
  studio = false,
  voiceB = false,
  testID,
}: ThreadHeaderProps): React.ReactElement {
  const { semanticColors } = useTheme();
  if (tone === 'deep') {
    const close = backKind === 'close';
    const heading = (
      <Text style={[styles.deepTitle, studio ? styles.studioTitle : null, voiceB ? styles.voiceBTitle : null, subtitle ? styles.stacked : null,
        voiceB && !subtitle ? styles.voiceBTitles : null]} numberOfLines={1} accessibilityRole="header">{title}</Text>
    );
    return (
      <View style={[styles.deep, studio ? styles.studioBar : null, voiceB ? styles.voiceBBar : null]} testID={testID}>
        <View style={styles.slot}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={close ? 'Close' : 'Back'} hitSlop={4}
              testID={testID ? `${testID}-${close ? 'close' : 'back'}` : undefined} style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
              <Ionicons name={close ? 'close' : 'chevron-back'} size={studio ? 26 : 24} color={fp.onDeep} />
            </Pressable>
          ) : null}
        </View>
        {initials ? <View style={[styles.tile, voiceB ? styles.voiceBTile : null]} testID={testID ? `${testID}-tile` : undefined}>
          <Text style={[styles.tileText, voiceB ? styles.voiceBTileText : null]}>{initials}</Text></View> : null}
        {subtitle ? (
          <View style={[styles.titles, voiceB ? styles.voiceBTitles : null]}>
            {heading}
            <Text style={[styles.deepSub, voiceB ? styles.voiceBSub : null]} numberOfLines={2}>{subtitle}</Text>
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
  // Studio .mono.cl (S_thread_ios.html:52, :54): 44 pt, radius 12, a 1 pt sage line, forest letters.
  tile: { width: 44, height: 44, borderRadius: radius.input, borderWidth: 1, borderColor: fp.sageLine, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, fontWeight: '600', color: fp.forest },
  // REFINE-962 `studio`: .brow padding 6px 12px 12px 6px, gap 10px; .btitle 18px, 600, line-height 1.2.
  studioBar: { gap: 10, paddingLeft: 6, paddingRight: 12, paddingTop: 6, paddingBottom: 12 },
  studioTitle: { fontSize: 18, lineHeight: 22 },
  // REFINE-985 `voiceB`: 05b .mast padding 2px 6px 10px, gap 2px; .mt padding 0 4px; .mtt 1.1875rem/1.25; .mts .8125rem/1.35
  // #B8CCBF; c08 .mono.sm (C6CHAT-S-V2 src/lib.py:176-177, screens.py:130): 36 pt, radius 10, forest, a 1 pt brand 500
  // line, a gold Cormorant 21 pt letter, 2 before and 6 after.
  voiceBBar: { gap: 2, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 6 },
  voiceBTitle: { fontSize: 19, lineHeight: 23.75 },
  voiceBTitles: { paddingHorizontal: 4 },
  voiceBSub: { fontSize: 13, lineHeight: 17.55 },
  voiceBTile: { width: 36, height: 36, borderRadius: 10, borderColor: brand[500], backgroundColor: fp.forest, marginLeft: 2, marginRight: 6 },
  voiceBTileText: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 21, color: fp.gold },
  pressed: { opacity: 0.6 },
});
