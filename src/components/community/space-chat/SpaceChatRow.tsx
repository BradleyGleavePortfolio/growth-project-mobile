/**
 * SC-M1 (agent 168), FX-871 (agent 169): one Studio row of the space chat (mockup VOICE-B 05b). Rounded-square avatar
 * (members on the Studio greens, the coach deep with a gold initial), the name exactly as the server sends it, the Coach
 * mark (VN-M1) on the coach's rows, the time, then the content under the name. Each message kind draws in one place
 * (MessageBody): text unboxed, voice on m#848's player via SpaceVoiceNote (New / Played, SC-M2); a later kind adds a case.
 * Rows the viewer sent carry the send state beside the name (mockup 03 / 04): Sending... and Waiting to send (with a
 * clock) keep the text at full contrast (FR-871 Sol B4: no fade); Not sent has Try again (the same Idempotency-Key)
 * and Delete. Report / Block / Delete go through SafetyMenu; a row still on the phone has its own ••• that only deletes
 * it from the phone (FR-871R5, m#879 Opus B3 / Sol B4). Metrics are 05b's CSS (FR-871 Sol B3 / Opus B1).
 */
import React, { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SafetyMenu from '../SafetyMenu';
import SpaceVoiceNote from './SpaceVoiceNote';
import { brand, forestPop as fp, radius, spacing, typography } from '../../../theme/tokens';
import type { SpaceMessage } from './spaceChatApi';
import type { PendingState } from './spaceChatOutbox';

/** Owner #168-13 GREY-TEXT op 1: every small grey text on this page is #2C2C2C (13.4:1 on bone #F7FAF7). */
export const SMALL_GREY = '#2C2C2C';
/** Member tiles on the Studio greens (mockup 05b), picked per person; light initials, except ink on leaf with a moss edge. */
type Tile = { bg: string; fg: string; edge?: string };
const TILES: readonly Tile[] = [
  { bg: fp.moss, fg: fp.onDeep }, { bg: brand[500], fg: fp.onDeep }, { bg: fp.leaf, fg: fp.ink, edge: fp.moss }, { bg: fp.forest, fg: fp.onDeep },
];
export function tileFor(authorId: string): Tile {
  let h = 0;
  for (let i = 0; i < authorId.length; i += 1) h = (h * 31 + authorId.charCodeAt(i)) | 0;
  return TILES[Math.abs(h) % TILES.length];
}

export interface SpaceChatRowProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isCoach: boolean;
  createdAt: string;
  body: string | null;
  voice?: SpaceMessage['voice_note'];
  /** A voice note still in the phone's outbox (SC-M2): played from this file. */
  localUri?: string | null;
  authorId: string;
  /** Local rows only ('waiting' is drawn as sending while the phone is online: it is next in the queue). */
  state?: PendingState;
  onRetry?: () => void;
  onDiscard?: () => void;
  viewerUserId?: string | null;
  viewerCoachId?: string | null;
  offline: boolean;
  onDelete?: () => Promise<void>;
  onBlocked?: (userId: string) => void;
}

/** One place per message kind: a later kind (photo, reply) adds its case here. */
function MessageBody(p: SpaceChatRowProps): React.ReactElement | null {
  if (p.voice) {
    const mine = !!p.viewerUserId && p.authorId === p.viewerUserId;
    const send = p.state === 'waiting' && !p.offline ? 'sending' : p.state === 'sent' ? undefined : p.state;
    return (
      <SpaceVoiceNote voice={p.voice} coach={p.isCoach} mine={mine} offline={p.offline} localUri={p.localUri}
        send={send} onRetry={p.onRetry} onDiscard={p.onDiscard} />
    );
  }
  if (p.body) return <Text style={s.body} importantForAccessibility="no" accessibilityElementsHidden>{p.body}</Text>;
  return null;
}

const STATE_WORD: Record<'sending' | 'waiting' | 'failed', string> = { sending: 'Sending…', waiting: 'Waiting to send', failed: 'Not sent' };

export default function SpaceChatRow(p: SpaceChatRowProps): React.ReactElement {
  const local = !!p.state;
  const shown = p.state === 'waiting' && !p.offline ? 'sending' : p.state;
  // A voice note waiting offline says so in its card (GOAL 10a), so its header carries no word.
  const time = shown === 'waiting' && p.voice ? '' : shown && shown !== 'sent' ? STATE_WORD[shown] : spaceTime(p.createdAt);
  const initial = p.name.trim().charAt(0).toUpperCase();
  const isOwn = !!p.viewerUserId && p.authorId === p.viewerUserId;
  const tile: Tile = p.isCoach ? { bg: fp.deep, fg: fp.gold } : tileFor(p.authorId);
  // Name, chip and time grow (large text) or wrap: then the body starts below them, not tucked up.
  const [wrapped, setWrapped] = useState(false);
  const label = `${p.name}${p.isCoach ? ', Coach' : ''}, ${time}${p.body ? `. ${p.body}` : ''}`;
  const noun = p.voice ? 'voice note' : 'message';
  const confirmDiscard = () => Alert.alert(`Delete this ${noun}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: p.onDiscard },
  ]);
  return (
    <View style={s.row} testID={`space-chat-row-${p.id}`}>
      <View style={s.head}>
        {p.avatarUrl ? (
          <Image source={{ uri: p.avatarUrl }} style={[s.avatar, p.voice ? s.avatarSm : null]} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[s.avatar, p.voice ? s.avatarSm : null, { backgroundColor: tile.bg }, tile.edge ? { borderWidth: 1, borderColor: tile.edge } : null]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={[p.isCoach ? s.coachInitial : s.initial, { color: tile.fg }]}>{initial}</Text>
          </View>
        )}
        <View style={s.who} accessible accessibilityLabel={label} onLayout={(e) => setWrapped(e.nativeEvent.layout.height > 24)}>
          <Text style={s.name}>{p.name}</Text>
          {p.isCoach ? <Text style={s.mark}>Coach</Text> : null}
          {shown === 'waiting' && !p.voice ? <Ionicons name="time-outline" size={14} color={SMALL_GREY} /> : null}
          <Text style={s.time} testID={shown ? `space-chat-${shown}-${p.id}` : undefined}>{time}</Text>
        </View>
        {local ? (
          <TouchableOpacity onPress={confirmDiscard} accessibilityRole="button" accessibilityLabel={`Delete this ${noun}`} hitSlop={8} style={s.more} testID={`space-chat-local-menu-${p.id}`}>
            <Ionicons name="ellipsis-horizontal" size={18} color={SMALL_GREY} />
          </TouchableOpacity>
        ) : (
          <SafetyMenu
            targetType="message"
            targetId={p.id}
            authorUserId={p.authorId}
            authorName={p.name}
            viewerUserId={p.viewerUserId}
            viewerCoachId={p.isCoach && !isOwn ? p.authorId : p.viewerCoachId}
            contentNoun={p.voice ? 'voice note' : 'message'}
            onDelete={isOwn ? p.onDelete : undefined}
            onBlocked={p.onBlocked}
            testID={`space-chat-menu-${p.id}`}
          />
        )}
      </View>
      <View style={[s.content, p.voice ? s.voiceCard : wrapped ? s.untucked : null]} testID={`space-chat-content-${p.id}`}>
        <MessageBody {...p} />
        {p.state === 'failed' && !p.voice ? (
          <View style={s.actions}>
            <TouchableOpacity onPress={p.onRetry} accessibilityRole="button" accessibilityLabel="Try again" style={s.again} testID={`space-chat-retry-${p.id}`}>
              <Ionicons name="refresh" size={16} color={fp.onDeep} />
              <Text style={s.againText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={p.onDiscard} accessibilityRole="button" accessibilityLabel="Delete" style={s.discard} testID={`space-chat-discard-${p.id}`}>
              <Text style={s.discardText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Time and day marks in the formats of main's Style B thread ("6:03 pm", "Thu, Oct 22"). Kept here, not imported:
 * MessagesScreenStyleB.test.tsx (coach side unchanged) allows no other file to read the Style B thread, and this page
 * is on the coach side too.
 */
export function spaceTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/, (_m, x: string) => ` ${x.toLowerCase()}`);
}
export function spaceDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
export function DayLine({ label }: { label: string }): React.ReactElement {
  return <Text style={s.day}>{label}</Text>;
}

/** "New messages" above the first unread row (SC-BE2's read cursor): a short lead dash, moss words, a leaf rule (05b). */
export function NewMessagesLine(): React.ReactElement {
  return (
    <View style={s.newLine} testID="space-chat-new-line" accessibilityRole="text" accessibilityLabel="New messages">
      <View style={s.newDash} />
      <Text style={s.newText}>New messages</Text>
      <View style={s.newRule} />
    </View>
  );
}

// 05b (.msg / .av / .bcard): text rows have a 40 pt tile and the text under the name; voice rows a 32 pt tile, the card
// below the 44 pt head at 62 pt from the edge (16 + 46).
const AVATAR = 40;
const GAP = 10;
const s = StyleSheet.create({
  row: { paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: GAP, minHeight: 44 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarSm: { width: 32, height: 32, borderRadius: 10 },
  initial: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  coachInitial: { ...typography.h3, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 18 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 },
  name: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 20, color: fp.ink, flexShrink: 1 },
  mark: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11, lineHeight: 13, letterSpacing: 0.22, color: fp.gold, backgroundColor: fp.deep, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 3, overflow: 'hidden' },
  time: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: SMALL_GREY },
  // Text: up under the name, 2 pt below it, as in 05b (the head row stays 44 pt for the menu's touch target).
  content: { marginLeft: AVATAR + GAP, marginRight: spacing.md, marginTop: -10, gap: spacing.xs },
  voiceCard: { marginLeft: 46, marginRight: spacing.sm, marginTop: 6 },
  untucked: { marginTop: 0 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: fp.ink },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  again: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.button, backgroundColor: fp.forest },
  againText: { ...typography.bodyMd, color: fp.onDeep },
  more: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  discard: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  discardText: { ...typography.bodyMd, color: SMALL_GREY },
  // A small sans day mark ("Thu, Oct 22"), 05b .day: 600 12 pt, 10 pt above, 4 below.
  day: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 15, color: SMALL_GREY, textAlign: 'center', paddingTop: GAP, paddingBottom: spacing.xs },
  // 05b .newline: an 8 pt lead dash, 10 pt gaps, 600 12 pt brand 400 (#4D7059) words, a leaf rule.
  newLine: { flexDirection: 'row', alignItems: 'center', gap: GAP, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  newDash: { width: 8, height: 2, borderRadius: 1, backgroundColor: fp.leaf },
  newText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 15, color: fp.brand400 },
  newRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: fp.leaf },
  glyph: { width: 24, height: 24, justifyContent: 'center', gap: 3, paddingLeft: 3 }, bar: { height: 2, borderRadius: 1 },
  hash: { width: 18, height: 18, marginRight: 6 },
  hashH: { position: 'absolute', left: 3, width: 12, height: 1.7, borderRadius: 1 },
  hashV: { position: 'absolute', top: 2.5, width: 1.7, height: 13, borderRadius: 1, transform: [{ rotate: '6deg' }] },
});

/** 05b's drawer glyph (three round-capped bars, 18 / 18 / 12 pt; Opus B1 f) and the drawn hash before the space name. */
export const MenuGlyph = ({ color }: { color: string }): React.ReactElement => (
  <View style={s.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{[18, 18, 12].map((w, i) => <View key={i} style={[s.bar, { width: w, backgroundColor: color }]} />)}</View>
);
export const HashGlyph = ({ color }: { color: string }): React.ReactElement => (
  <View style={s.hash} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="space-chat-hash">
    {[5.9, 10.4].map((top) => <View key={top} style={[s.hashH, { top, backgroundColor: color }]} />)}
    {[6.1, 10.2].map((left) => <View key={left} style={[s.hashV, { left, backgroundColor: color }]} />)}
  </View>
);
