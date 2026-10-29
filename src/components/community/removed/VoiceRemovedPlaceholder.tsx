/**
 * VoiceRemovedPlaceholder — owner #174-4: when the space's coach (or the platform owner) removes
 * someone else's voice note, the note keeps its place as one quiet line, like the chat apps the owner
 * named (WhatsApp's "This message was deleted", Slack's "This message was deleted."): no player, no
 * menu, no reactions. The server sends the removed row with `removed_at` and `removed_by` (backend
 * #1165 CONTRACT 6405215872); an author's own delete still vanishes (no such row).
 *
 * What each viewer reads (words RB-W4..RB-W6, needs owner):
 *   the remover            "You removed this voice note"
 *   the note's author      "Your coach removed your voice note" + a link to Community safety
 *   everyone else          "Removed by Coach {name}"
 *
 * #172-10: no GOAL frame draws this state, so it follows the newest voice GOAL style, the reported
 * fold (GOAL .bfold, B-06b): dashed track line, 16 corners, padding 12, 13/18 n700, a 16 px mark.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../HapticPressable';
import { forestPop as fp, voiceFaces, voiceShades } from '../../../theme/tokens';
import type { VoiceNoteView } from '../../../api/communityVoiceApi';
import type { CommunityNav } from '../../../screens/community/communityNavTypes';

export type VoiceRemovedLine = {
  /** remover: the viewer removed it; author: the viewer's note was removed; other: anyone else. */
  who: 'remover' | 'author' | 'other';
  text: string;
};

/** The placeholder line for this viewer, or null when the note was not removed by a coach. */
export function voiceRemovedLine(
  note: Pick<VoiceNoteView, 'author_id' | 'removed_at' | 'removed_by'>,
  viewerUserId?: string | null,
): VoiceRemovedLine | null {
  if (!note.removed_at && !note.removed_by) return null;
  if (viewerUserId && note.removed_by?.user_id === viewerUserId) {
    return { who: 'remover', text: 'You removed this voice note' };
  }
  if (viewerUserId && note.author_id === viewerUserId) {
    return { who: 'author', text: 'Your coach removed your voice note' };
  }
  const name = note.removed_by?.name.trim() ?? '';
  return { who: 'other', text: name ? `Removed by Coach ${name}` : 'Removed by Coach' };
}

export default function VoiceRemovedPlaceholder({
  line,
  testID,
}: {
  line: VoiceRemovedLine;
  testID?: string;
}): React.ReactElement {
  const navigation = useNavigation<CommunityNav>();
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.what} accessible accessibilityLabel={line.text}>
        <Ionicons name="remove-circle-outline" size={16} color={fp.n700} />
        <Text style={styles.text}>{line.text}</Text>
      </View>
      {line.who === 'author' ? (
        <HapticPressable
          intent="light"
          onPress={() => navigation.navigate('CommunitySafety')}
          accessibilityRole="link"
          accessibilityLabel="Community safety"
          hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }}
          testID={testID ? `${testID}-safety` : undefined}
        >
          <Text style={styles.link}>Community safety</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // GOAL .bfold (B-06b, the reported fold): the same quiet row, so a removed note reads as gone, not broken.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: voiceShades.track,
    borderRadius: 16,
    padding: 12,
  },
  what: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  text: { flexShrink: 1, fontFamily: voiceFaces.regular, fontSize: 13, lineHeight: 18, color: fp.n700 },
  // GOAL .btn.t ink (forest, 600), underlined so it reads as a link inside a quiet row.
  link: {
    fontFamily: voiceFaces.semibold,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: fp.forest,
    textDecorationLine: 'underline',
  },
});
