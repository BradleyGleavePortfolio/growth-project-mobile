/**
 * REMOVED-BY-M2 (agent 175): owner #174-4 in the space chat. When the space's coach (or the platform owner, shown as the
 * coach) removes someone else's message, the row keeps its place as one quiet line, as WhatsApp's "This message was
 * deleted" and Slack's "This message was deleted." do: no player, reply, ack, reactions or menu. The server marks the row
 * deleted with removed_by (b#1165 CONTRACT 6405215872 section 2); an author's own delete has no removed_by and still
 * vanishes, and so does a removal from before b#1165. The rule reads no kind: a voice row says "voice note", every other
 * kind (text today, photo when it lands) says "message" (RB-W8).
 *
 * No GOAL frame draws this state (#172-10): it matches m#886's VoiceRemovedPlaceholder (ctx#266), a dashed track line,
 * 16 pt corners, 12 pt padding, a 16 pt mark and 13/18 text. The text and mark are this page's small grey #2C2C2C
 * (owner #168-13, SpaceChatRow's SMALL_GREY) where m#886 uses neutral 700.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../HapticPressable';
import { forestPop as fp, voiceShades } from '../../../../theme/tokens';
import type { SpaceMessage } from '../spaceChatApi';

const GREY = '#2C2C2C';

export type SpaceRemovedLine = { who: 'remover' | 'author' | 'other'; text: string };
type Removable = Pick<SpaceMessage, 'kind' | 'sender_user_id' | 'deleted' | 'removed_by'>;

/** A row the coach removed: deleted, with removed_by, of any kind. */
export function isCoachRemoved(m: Pick<SpaceMessage, 'deleted' | 'removed_by'>): boolean {
  return !!m.deleted && !!m.removed_by;
}

/**
 * The one line each viewer reads (b#1165 CONTRACT section 2): the coach who removed it reads RB-W5, the author RB-W6,
 * everyone else RB-W4 with removed_by.name (the same name rule as sender.name). Null for a row that is not a removal.
 */
export function spaceRemovedLine(m: Removable, viewerUserId?: string | null): SpaceRemovedLine | null {
  if (!isCoachRemoved(m)) return null;
  const noun = m.kind === 'voice' ? 'voice note' : 'message';
  if (viewerUserId && m.removed_by?.user_id === viewerUserId) return { who: 'remover', text: `You removed this ${noun}` };
  if (viewerUserId && m.sender_user_id === viewerUserId) return { who: 'author', text: `Your coach removed your ${noun}` };
  const name = (m.removed_by?.name ?? '').trim();
  return { who: 'other', text: name ? `Removed by Coach ${name}` : 'Removed by Coach' };
}

export interface SpaceRemovedPlaceholderProps {
  id: string;
  line: SpaceRemovedLine;
  /** The author's link to Community safety; left out where that page is not on the stack (the coach side). */
  onSafety?: () => void;
}

export default function SpaceRemovedPlaceholder({ id, line, onSafety }: SpaceRemovedPlaceholderProps): React.ReactElement {
  return (
    <View style={s.box} testID={`space-chat-removed-${id}`}>
      {/* The row's head reads the line with the name and time (SpaceChatRow's label), as it does a text body. */}
      <View style={s.line} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name="remove-circle-outline" size={16} color={GREY} />
        <Text style={s.text}>{line.text}</Text>
      </View>
      {line.who === 'author' && onSafety ? (
        <HapticPressable intent="light" onPress={onSafety} accessibilityRole="link" accessibilityLabel="Community safety"
          hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }} testID={`space-chat-removed-safety-${id}`}>
          <Text style={s.link}>Community safety</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: voiceShades.track, borderRadius: 16, padding: 12,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  text: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: GREY, flexShrink: 1 },
  link: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 13, lineHeight: 18, color: fp.forest, textDecorationLine: 'underline' },
});
