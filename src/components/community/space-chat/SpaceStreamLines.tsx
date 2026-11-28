/**
 * LEAVE-MUTE-M (agent 203; LEAVE-MUTE-MOCK Style 1): the stream's leave and thread lines, each its own row so SpaceChatRow
 * stays as it is.
 *   - "{name} left" (D2d op 2, frames s1_L6, s1_L7a to s1_L7c): a centred quiet line like the day line (.s1left).
 *   - The Muted mark (LM-05, spoken LM-06 "Thread muted", s1_L9): a small hairline pill under the first message's words.
 *   - The fold (LM-08, s1_L10a): a dashed card at the words' column, "{n} replies since you left"; a tap opens it.
 *   - Follow thread (LM-04, s1_L10b): an underlined forest link under the opened replies.
 * The words' column is the row's 16 pt edge plus its 40 pt tile and 10 pt gap (SpaceChatRow.tsx content).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, forestPop as fp, radius, spacing, voiceShades } from '../../../theme/tokens';

const COLUMN = 66;
export const leftLine = (name: string) => `${name} left`;
export const foldLine = (n: number) => `${n} ${n === 1 ? 'reply' : 'replies'} since you left`;

export function LeftLine({ name, testID }: { name: string; testID: string }): React.ReactElement {
  return <Text style={s.left} testID={testID}>{leftLine(name)}</Text>;
}

export function MutedMark({ testID }: { testID: string }): React.ReactElement {
  return (
    <View style={s.markRow}>
      <View style={s.mark} accessible accessibilityRole="text" accessibilityLabel="Thread muted" testID={testID}>
        <Ionicons name="notifications-off-outline" size={14} color={colors.graphite} />
        <Text style={s.markText}>Muted</Text>
      </View>
    </View>
  );
}

export function FoldLine({ count, onPress, testID }: { count: number; onPress: () => void; testID: string }): React.ReactElement {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={foldLine(count)} style={s.fold} testID={testID}>
      <Ionicons name="chatbubble-outline" size={18} color={fp.forest} />
      <Text style={s.foldText}>{foldLine(count)}</Text>
    </TouchableOpacity>
  );
}

export function FollowLink({ busy, onPress, testID }: { busy: boolean; onPress: () => void; testID: string }): React.ReactElement {
  return (
    <TouchableOpacity
      onPress={busy ? undefined : onPress} disabled={busy} accessibilityRole="button" accessibilityLabel="Follow thread"
      accessibilityState={{ busy, disabled: busy }} style={s.follow} testID={testID}
    >
      {busy ? <ActivityIndicator color={fp.forest} /> : <Text style={s.followText}>Follow thread</Text>}
    </TouchableOpacity>
  );
}

/** The hold sheet's hairline between its groups (s1_L8 .sheet .hr). */
export function SheetHairline(): React.ReactElement {
  return <View style={s.hr} />;
}

const s = StyleSheet.create({
  hr: { height: 1, backgroundColor: voiceShades.hairline, marginVertical: spacing.xs },
  // .s1left: 600 12 / 15, graphite, centred, 10 pt above and 6 below (the day line's family).
  left: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 15, color: colors.graphite, textAlign: 'center', paddingTop: 10, paddingBottom: 6, paddingHorizontal: spacing.lg },
  // .s1mark: a hairline pill, 600 13 / 16 graphite, 4 / 10 inside, at the words' column.
  markRow: { paddingLeft: COLUMN, paddingRight: spacing.lg, paddingBottom: spacing.sm, marginTop: -2, alignItems: 'flex-start' },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.chip, backgroundColor: voiceShades.hairline, paddingVertical: 4, paddingHorizontal: 10 },
  markText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 13, lineHeight: 16, color: colors.graphite },
  // .s1fold: 44 pt, a 1 pt dashed track border, radius 16, 600 13 / 18 forest, 66 pt in, 16 pt from the right.
  fold: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, marginLeft: COLUMN, marginRight: spacing.lg, marginVertical: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderStyle: 'dashed', borderColor: voiceShades.track, borderRadius: radius.card,
  },
  foldText: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 13, lineHeight: 18, color: fp.forest },
  follow: { alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center', marginLeft: COLUMN - spacing.sm, paddingHorizontal: spacing.sm },
  followText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 20, color: fp.forest, textDecorationLine: 'underline' },
});
