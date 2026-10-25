/**
 * SC-M2 (FX-871 PR 2, agent 170): a voice note in the space stream, drawn as mockup VOICE-B 05b draws it, on m#848's
 * player (FX-848 owns the player; this file only feeds it). Someone else's note shows a leaf "New" pill until the viewer
 * has played it to the end, then "✓ Played"; playing to the end tells the server (POST community/voice-notes/:id/heard)
 * and keeps the answer in the note's query so the row does not flip back. The viewer's own notes carry neither. A note
 * still in the phone's outbox plays from the file on the phone (`localUri`) and shows its send state in the card as
 * m#848 and GOAL 03 / 04 / 10a draw it (FR-871): a sending circle; offline, a clock and "Waiting to send" with the disc
 * greyed (no fade); Not sent, the red line with Try again and Delete. A play that fails (the signed URL ran out) asks
 * the server for a fresh one; a lookup that fails has Try again (FR-871, m#879 Sol B3).
 */
import React, { useMemo, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import VoiceNotePlayer from '../VoiceNotePlayer';
import { resolveVoicePlayback, type VoicePlaybackPort } from '../voicePlaybackPort';
import { communityVoiceApi, type VoiceNoteView } from '../../../api/communityVoiceApi';
import { forestPop as fp, radius, spacing } from '../../../theme/tokens';
import { spaceChatApi, type SpaceMessage } from './spaceChatApi';

const SMALL_GREY = '#2C2C2C';

export const spaceVoiceKey = (voiceNoteId: string) => ['community', 'space-chat-voice', voiceNoteId] as const;

/** The resolved player, with one extra step when a clip plays to the end. */
export function withHeard(base: VoicePlaybackPort, onHeard: () => void): VoicePlaybackPort {
  return {
    isAvailable: base.isAvailable,
    load: (url, events) => base.load(url, { ...events, onEnd: () => { events.onEnd?.(); onHeard(); } }),
  };
}

export interface SpaceVoiceNoteProps {
  voice: NonNullable<SpaceMessage['voice_note']>;
  coach: boolean;
  /** The viewer's own note: no New / Played mark, nothing sent to the heard route. */
  mine: boolean;
  offline: boolean;
  /** A note still on the phone (outbox): play the file there, no server lookups. */
  localUri?: string | null;
  /** An outbox note's state ('waiting' only while offline: online it is next in the queue, drawn as sending). */
  send?: 'sending' | 'waiting' | 'failed';
  onRetry?: () => void;
  onDiscard?: () => void;
  /** Tests inject a port; defaults to the resolved adapter. */
  playback?: VoicePlaybackPort;
}

export default function SpaceVoiceNote(p: SpaceVoiceNoteProps): React.ReactElement {
  const { voice, coach, mine, offline, localUri, playback, send } = p;
  const qc = useQueryClient();
  const note = useQuery({
    queryKey: spaceVoiceKey(voice.id),
    queryFn: () => communityVoiceApi.getOne(voice.id),
    staleTime: 5 * 60_000,
    enabled: !localUri,
  });
  const heard = !mine && !localUri && !!note.data?.heard_at;
  const sentRef = useRef(false);
  const wantHeard = !mine && !localUri && !heard;
  const wantRef = useRef(wantHeard);
  wantRef.current = wantHeard;
  const port = useMemo(() => withHeard(playback ?? resolveVoicePlayback(), () => {
    if (!wantRef.current || sentRef.current) return;
    sentRef.current = true;
    spaceChatApi.markHeard(voice.id).then(
      (at) => qc.setQueryData<VoiceNoteView>(spaceVoiceKey(voice.id), (old) => (old ? { ...old, heard_at: at } : old)),
      () => { sentRef.current = false; },
    );
  }), [playback, qc, voice.id]);

  const status = send === 'waiting' ? (
    <View style={s.played} accessible accessibilityLabel="Waiting to send" testID={`space-chat-voice-waiting-${voice.id}`}>
      <Ionicons name="time-outline" size={16} color={SMALL_GREY} />
      <Text style={s.playedText}>Waiting to send</Text>
    </View>
  ) : send === 'sending' ? (
    <ActivityIndicator size="small" color={fp.n700} accessibilityLabel="Sending…" testID={`space-chat-voice-sending-${voice.id}`} />
  ) : null;
  const trailing = send ? status : mine || localUri || !note.data ? null : heard ? (
    <View style={s.played} testID={`space-chat-voice-played-${voice.id}`}>
      <Ionicons name="checkmark" size={14} color={coach ? fp.onDeep : SMALL_GREY} />
      <Text style={[s.playedText, coach ? s.onDeep : null]}>Played</Text>
    </View>
  ) : (
    <View style={[s.newPill, coach ? s.newCoach : null]} testID={`space-chat-voice-new-${voice.id}`}>
      <Text style={s.newText}>New</Text>
    </View>
  );

  const confirmDiscard = () => Alert.alert('Delete this voice note?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: p.onDiscard },
  ]);
  const footer = send === 'failed' ? (
    <View style={s.failed} testID={`space-chat-voice-failed-${voice.id}`}>
      <View style={s.failedLine} accessibilityRole="alert">
        <Ionicons name="alert-circle-outline" size={16} color={fp.error} />
        <Text style={s.failedText}>That didn’t send. Your recording is safe — try sending again.</Text>
      </View>
      <View style={s.actions}>
        <TouchableOpacity onPress={p.onRetry} accessibilityRole="button" accessibilityLabel="Try sending the voice note again" style={s.retry} testID={`space-chat-retry-${voice.id}`}>
          <Ionicons name="refresh" size={18} color={fp.onDeep} />
          <Text style={[s.actionText, { color: fp.onDeep }]}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={confirmDiscard} accessibilityRole="button" accessibilityLabel="Delete" style={s.del} testID={`space-chat-discard-${voice.id}`}>
          <Text style={[s.actionText, { color: fp.n700 }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : !localUri && note.isError && !note.isFetching ? (
    <TouchableOpacity onPress={() => { void note.refetch(); }} accessibilityRole="button" accessibilityLabel="Try again" style={s.del} testID={`space-chat-voice-retry-${voice.id}`}>
      <Text style={[s.actionText, { color: coach ? fp.onDeep : fp.n700 }]}>Try again</Text>
    </TouchableOpacity>
  ) : undefined;

  return (
    <VoiceNotePlayer
      url={localUri ?? note.data?.url ?? null}
      durationMs={voice.duration_ms}
      peaks={voice.waveform_peaks ?? undefined}
      tone={coach ? 'coach' : 'light'}
      offline={send === 'waiting' || (!localUri && offline)}
      playback={port}
      onPlaybackError={localUri ? undefined : () => { void note.refetch(); }}
      trailing={trailing}
      footer={footer}
      testID={`space-chat-voice-${voice.id}`}
    />
  );
}

const s = StyleSheet.create({
  // GOAL .bst: 500 13 pt, 4 pt gap. .bnew: 4 x 9 padding inside a 1 pt moss edge (none on the coach card), 600 12 pt.
  played: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playedText: { fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 13, lineHeight: 16, color: SMALL_GREY },
  onDeep: { color: fp.onDeep },
  newPill: { backgroundColor: fp.leaf, borderWidth: 1, borderColor: fp.moss, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  newCoach: { borderWidth: 0, paddingHorizontal: 9, paddingVertical: 3 },
  newText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 14, letterSpacing: 0, color: fp.ink },
  // GOAL .bstat / .bact (m#848's failed card): red 13 / 1.4 line, then Try again (forest) and Delete.
  failed: { gap: 6, marginTop: 8 },
  failedLine: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  failedText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: fp.error },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  retry: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.button, backgroundColor: fp.forest },
  del: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 20 },
});
