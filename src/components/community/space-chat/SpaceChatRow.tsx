/**
 * SC-M1 (agent 168): one Studio row of the space chat (mockup VOICE-B 05b). Rounded-square avatar, the name exactly as
 * the server sends it, the Coach mark (VN-M1) on the coach's rows, the time, the text unboxed; the coach's voice notes sit
 * on the deep card. Voice rows draw m#848's player (only while communityVoiceNotes is on; the screen leaves them out
 * otherwise). Rows the viewer sent carry the send state: Waiting to send, or Not sent with a tap to send again.
 * Report / Block / Delete go through SafetyMenu (noun "message").
 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import SafetyMenu from '../SafetyMenu';
import VoiceNotePlayer from '../VoiceNotePlayer';
import { communityVoiceApi } from '../../../api/communityVoiceApi';
import { forestPop as fp, radius, spacing, typography } from '../../../theme/tokens';
import type { SpaceMessage } from './spaceChatApi';
import type { PendingState } from './useSpaceChat';

export interface SpaceChatRowProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isCoach: boolean;
  createdAt: string;
  body: string | null;
  voice?: SpaceMessage['voice_note'];
  authorId: string;
  /** Local rows only. */
  state?: PendingState;
  onRetry?: () => void;
  viewerUserId?: string | null;
  viewerCoachId?: string | null;
  offline: boolean;
  onDelete?: () => Promise<void>;
  onBlocked?: (userId: string) => void;
}

function VoiceBody({ voice, coach, offline }: { voice: NonNullable<SpaceMessage['voice_note']>; coach: boolean; offline: boolean }) {
  const note = useQuery({
    queryKey: ['community', 'space-chat-voice', voice.id],
    queryFn: () => communityVoiceApi.getOne(voice.id),
    staleTime: 5 * 60_000,
  });
  return (
    <VoiceNotePlayer
      url={note.data?.url ?? null}
      durationMs={voice.duration_ms}
      peaks={voice.waveform_peaks ?? undefined}
      tone={coach ? 'coach' : 'light'}
      offline={offline}
      testID={`space-chat-voice-${voice.id}`}
    />
  );
}

export default function SpaceChatRow(p: SpaceChatRowProps): React.ReactElement {
  const local = !!p.state;
  const time = spaceTime(p.createdAt);
  const initial = p.name.trim().charAt(0).toUpperCase();
  const isOwn = !!p.viewerUserId && p.authorId === p.viewerUserId;
  const label = `${p.name}${p.isCoach ? ', Coach' : ''}, ${time}${p.body ? `. ${p.body}` : ''}`;
  // Mockup VOICE-B 05b: one line (avatar, name, Coach, time, menu), the content indented under the name. Text is unboxed;
  // a voice note is the m#848 player card (the deep card on the coach's rows).
  return (
    <View style={s.row} testID={`space-chat-row-${p.id}`}>
      <View style={s.head}>
        {p.avatarUrl ? (
          <Image source={{ uri: p.avatarUrl }} style={s.avatar} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[s.avatar, { backgroundColor: p.isCoach ? fp.deep : fp.sage }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={[s.initial, { color: p.isCoach ? fp.onDeep : fp.ink }]}>{initial}</Text>
          </View>
        )}
        <View style={s.who} accessible accessibilityLabel={label}>
          <Text style={s.name}>{p.name}</Text>
          {p.isCoach ? <Text style={s.mark}>Coach</Text> : null}
          <Text style={s.time}>{time}</Text>
        </View>
        {local ? null : (
          <SafetyMenu
            targetType="message"
            targetId={p.id}
            authorUserId={p.authorId}
            authorName={p.name}
            viewerUserId={p.viewerUserId}
            viewerCoachId={p.isCoach && !isOwn ? p.authorId : p.viewerCoachId}
            contentNoun="message"
            onDelete={isOwn && !p.voice ? p.onDelete : undefined}
            onBlocked={p.onBlocked}
            testID={`space-chat-menu-${p.id}`}
          />
        )}
      </View>
      <View style={s.content}>
        {p.voice ? <VoiceBody voice={p.voice} coach={p.isCoach} offline={p.offline} /> : null}
        {p.body ? (
          <Text style={s.body} importantForAccessibility="no" accessibilityElementsHidden>{p.body}</Text>
        ) : null}
        {p.state === 'waiting' ? (
          <View style={s.status} testID={`space-chat-waiting-${p.id}`}>
            <Ionicons name="time-outline" size={14} color={fp.n700} />
            <Text style={[s.meta, { color: fp.n700 }]}>Waiting to send</Text>
          </View>
        ) : null}
        {p.state === 'failed' ? (
          <TouchableOpacity
            onPress={p.onRetry}
            accessibilityRole="button"
            accessibilityLabel="Not sent. Tap to send again"
            style={[s.status, s.retry]}
            testID={`space-chat-retry-${p.id}`}
          >
            <Ionicons name="alert-circle-outline" size={14} color={fp.goldInk} />
            <Text style={[s.meta, { color: fp.goldInk }]}>Not sent. Tap to send again</Text>
          </TouchableOpacity>
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

/** "New messages" above the first unread row (SC-BE2's read cursor). */
export function NewMessagesLine(): React.ReactElement {
  return (
    <View style={s.newLine} testID="space-chat-new-line" accessibilityRole="text" accessibilityLabel="New messages">
      <Text style={s.newText}>New messages</Text>
      <View style={s.newRule} />
    </View>
  );
}

const AVATAR = 32;
const s = StyleSheet.create({
  row: { paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { ...typography.bodyMd },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm },
  name: { ...typography.h4, color: fp.ink, flexShrink: 1 },
  mark: { ...typography.caption, color: fp.gold, backgroundColor: fp.deep, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  time: { ...typography.bodySmall, color: fp.n700 },
  content: { marginLeft: AVATAR + spacing.sm, marginRight: spacing.md, gap: spacing.xs },
  body: { ...typography.body, color: fp.ink },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  retry: { minHeight: 44 },
  meta: { ...typography.bodySmall },
  day: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', color: fp.ink, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  newLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  newText: { ...typography.caption, color: fp.goldInk },
  newRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: fp.goldInk },
});
