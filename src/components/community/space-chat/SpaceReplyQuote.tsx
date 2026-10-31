/**
 * SC-M3 (agent 184, owner #167-5 TEXT-REPLIES: "it should appear like it does in IOS messages or slack responses"): the
 * quote a reply carries in the space chat, as iMessage and Slack draw one: who wrote the message it answers and its first
 * line (SC-BE1's parent block, 120 characters at most) or a voice note's length, in a white chip with a leaf bar (GOAL
 * VOICE-B 09b's quoted chip; ReplyComposer's bar). A message that is gone (deleted, removed, its author blocked either way
 * or left) reads the removed-message line (main community MessageBubble's "Message removed") and is no button. One loaded
 * on this page is a button that scrolls to it; one not loaded is the quote alone. Screen readers hear the quote first in
 * the row's one label (spokenQuote), so the chip itself is hidden from them.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatDuration } from '../voiceFormat';
import { colors, forestPop as fp, neutral, radius, spacing, voiceShades } from '../../../theme/tokens';
import type { SpaceReplyTarget } from './spaceChatOutbox';
import type { SpaceMessage } from './spaceChatApi';

export type SpaceQuote = { gone: true } | { gone: false; name: string; text: string; voiceMs?: number | null };

/** The first line with words in it (a quote shows one line of the message, as ReplyComposer does). */
export const firstLine = (text?: string | null): string => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
/** A voice note in a quote: the report sheet's card line (GOAL B-06a, "voice note · 0:21"). */
export const voiceLine = (ms: number): string => `voice note · ${formatDuration(ms)}`;

/** The server's parent block as a quote; none on a row that answers nothing. */
export function quoteOf(parent: SpaceMessage['parent']): SpaceQuote | null {
  if (!parent) return null;
  if (parent.gone) return { gone: true };
  const voiceMs = parent.kind === 'voice' ? parent.voice_duration_ms ?? 0 : null;
  return { gone: false, name: parent.sender_name ?? '', text: voiceMs != null ? voiceLine(voiceMs) : firstLine(parent.snippet), voiceMs };
}
/** A reply still on the phone: the quote it was written against. */
/** FR-909: a waiting reply whose message went keeps no words; it reads "Message removed", as the server's quote does. */
export const quoteOfTarget = (t: SpaceReplyTarget): SpaceQuote => (t.gone ? { gone: true } : { gone: false, name: t.authorLabel, text: t.body });

/** What a screen reader hears before the row's name (plan SC-M3: "Replying to {name}: ..."; SC-W06 for a voice note). */
export function spokenQuote(q: SpaceQuote): string {
  if (q.gone) return 'Replying to: Message removed. ';
  return `Replying to ${q.name}: ${q.voiceMs != null ? `voice note, ${formatDuration(q.voiceMs)}` : q.text}. `;
}

export default function SpaceReplyQuote({ id, quote, onPress }: { id: string; quote: SpaceQuote; onPress?: () => void }): React.ReactElement {
  const chip = (
    <View style={s.chip}>
      <View style={s.bar} />
      <View style={s.words}>
        {quote.gone ? <Text style={s.gone}>Message removed</Text> : (
          <>
            <Text style={s.name} numberOfLines={1}>{quote.name}</Text>
            {quote.text ? <Text style={s.text} numberOfLines={2}>{quote.text}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
  if (onPress && !quote.gone) {
    return (
      <TouchableOpacity onPress={onPress} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.touch} testID={`space-chat-quote-${id}`}>
        {chip}
      </TouchableOpacity>
    );
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`space-chat-quote-${id}`}>{chip}</View>
  );
}

const s = StyleSheet.create({
  // 44 pt to tap at the least; the chip itself keeps its own height.
  touch: { minHeight: 44, justifyContent: 'center' },
  // 09b's chip: white, a hairline edge, 12 corners; a 3 pt leaf bar (ReplyComposer's bar) marks it as a quote.
  chip: {
    flexDirection: 'row', alignSelf: 'flex-start', maxWidth: '100%', gap: spacing.sm, paddingVertical: 6, paddingLeft: spacing.sm,
    paddingRight: spacing.md, borderRadius: radius.button, borderWidth: 1, borderColor: voiceShades.hairline, backgroundColor: neutral[0],
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: fp.leaf },
  words: { flexShrink: 1, gap: 1 },
  name: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 13, lineHeight: 18, color: fp.ink },
  // Owner #168-13 GREY-TEXT op 1: small grey text on this page is #2C2C2C.
  text: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: colors.graphite },
  gone: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: colors.graphite },
});
