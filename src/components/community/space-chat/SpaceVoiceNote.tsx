/**
 * SC-M2 (FX-871 PR 2, agent 170): a voice note in the space stream, drawn as mockup VOICE-B 05b draws it, on m#848's
 * player (FX-848 owns the player; this file only feeds it). Someone else's note shows a leaf "New" pill until the viewer
 * has played it to the end, then "✓ Played"; playing to the end tells the server (POST community/voice-notes/:id/heard)
 * and keeps the answer in the note's query so the row does not flip back. The viewer's own notes carry neither. A note
 * still in the phone's outbox (Sending… / Waiting to send / Not sent) plays from the file on the phone (`localUri`).
 */
import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import VoiceNotePlayer from '../VoiceNotePlayer';
import { resolveVoicePlayback, type VoicePlaybackPort } from '../voicePlaybackPort';
import { communityVoiceApi, type VoiceNoteView } from '../../../api/communityVoiceApi';
import { forestPop as fp, radius, spacing, typography } from '../../../theme/tokens';
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
  /** Tests inject a port; defaults to the resolved adapter. */
  playback?: VoicePlaybackPort;
}

export default function SpaceVoiceNote({ voice, coach, mine, offline, localUri, playback }: SpaceVoiceNoteProps): React.ReactElement {
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

  const trailing = mine || localUri || !note.data ? null : heard ? (
    <View style={s.played} testID={`space-chat-voice-played-${voice.id}`}>
      <Ionicons name="checkmark" size={14} color={coach ? fp.onDeep : SMALL_GREY} />
      <Text style={[s.playedText, coach ? s.onDeep : null]}>Played</Text>
    </View>
  ) : (
    <View style={s.newPill} testID={`space-chat-voice-new-${voice.id}`}>
      <Text style={s.newText}>New</Text>
    </View>
  );

  return (
    <VoiceNotePlayer
      url={localUri ?? note.data?.url ?? null}
      durationMs={voice.duration_ms}
      peaks={voice.waveform_peaks ?? undefined}
      tone={coach ? 'coach' : 'light'}
      offline={localUri ? false : offline}
      playback={port}
      trailing={trailing}
      testID={`space-chat-voice-${voice.id}`}
    />
  );
}

const s = StyleSheet.create({
  played: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  playedText: { ...typography.bodySmall, color: SMALL_GREY },
  onDeep: { color: fp.onDeep },
  newPill: { backgroundColor: fp.leaf, borderWidth: 1, borderColor: fp.moss, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  newText: { ...typography.caption, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: fp.ink },
});
