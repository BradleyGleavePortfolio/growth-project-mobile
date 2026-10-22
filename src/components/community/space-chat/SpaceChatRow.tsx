/**
 * SC-M1 (agent 168): one Studio row of the space chat (mockup VOICE-B 05b). Rounded-square avatar, the name exactly as
 * the server sends it, the Coach mark (VN-M1) on the coach's rows, the time, the text unboxed; the coach's rows sit on
 * the deep card. Voice rows draw m#848's player (only while communityVoiceNotes is on; the screen leaves them out
 * otherwise). Rows the viewer sent carry the send state: Waiting to send, or Not sent with a tap to send again.
 * Report / Block / Delete go through SafetyMenu (noun "message").
 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import SafetyMenu from '../SafetyMenu';
import VoiceNotePlayer from '../VoiceNotePlayer';
import { timeB } from '../../messaging/StyleBThread';
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
  const time = timeB(p.createdAt);
  const initial = p.name.trim().charAt(0).toUpperCase();
  const isOwn = !!p.viewerUserId && p.authorId === p.viewerUserId;
  const label = `${p.name}${p.isCoach ? ', Coach' : ''}, ${time}${p.body ? `. ${p.body}` : ''}`;
  return (
    <View style={s.row} testID={`space-chat-row-${p.id}`}>
      {p.avatarUrl ? (
        <Image source={{ uri: p.avatarUrl }} style={s.avatar} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[s.avatar, { backgroundColor: p.isCoach ? fp.deep : fp.sage }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={[s.initial, { color: p.isCoach ? fp.onDeep : fp.ink }]}>{initial}</Text>
        </View>
      )}
      <View style={s.main}>
        <View accessible={!p.voice} accessibilityLabel={p.voice ? undefined : label} style={[s.content, p.isCoach && s.card]}>
          <View style={s.head} accessible={!!p.voice} accessibilityLabel={p.voice ? label : undefined}>
            <Text style={[s.name, { color: p.isCoach ? fp.onDeep : fp.ink }]}>{p.name}</Text>
            {p.isCoach ? <Text style={s.mark}>Coach</Text> : null}
            <Text style={[s.time, { color: p.isCoach ? fp.onDeepMuted : fp.n700 }]}>{time}</Text>
          </View>
          {p.voice ? <VoiceBody voice={p.voice} coach={p.isCoach} offline={p.offline} /> : null}
          {p.body ? <Text style={[s.body, { color: p.isCoach ? fp.onDeep : fp.ink }]}>{p.body}</Text> : null}
        </View>
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
      {local ? <View style={s.menuGap} /> : (
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
  );
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

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { ...typography.h4 },
  main: { flex: 1, minWidth: 0 },
  content: { gap: spacing.xs },
  card: { backgroundColor: fp.deep, borderRadius: radius.card, padding: spacing.md },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm },
  name: { ...typography.h4, flexShrink: 1 },
  mark: { ...typography.caption, color: fp.gold, backgroundColor: fp.forest, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  time: { ...typography.bodySmall },
  body: { ...typography.body },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  retry: { minHeight: 44 },
  meta: { ...typography.bodySmall },
  menuGap: { width: 44 },
  newLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  newText: { ...typography.caption, color: fp.goldInk },
  newRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: fp.goldInk },
});
