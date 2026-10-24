/**
 * VoiceNotesSection — the Hall's voice notes: a Record entry point and the
 * workspace voice-note feed, each note with a player and its safety menu.
 *
 * Apple App Review 1.2 on audio: voice notes cannot be text-filtered (they
 * are audio and are not transcribed), so every note carries Report (with a
 * reason, reviewed within 24 hours by the coach and the TGP team) and Block,
 * and the author can delete their own note. A block hides notes both ways.
 *
 * Rendered only when `featureFlags.communityVoiceNotes` is on (the composer
 * route is registered behind the same flag). Notes are scoped to community
 * spaces; there are no voice notes in direct messages.
 *
 * Style B (VOICE-M): Record opens the record sheet over this feed; a note shows the author's name
 * ("Member" before backend #1122), a Coach mark and deep card, and the real waveform. Unsent notes wait
 * on top: Sending…, Not sent (Try again, Delete), or offline a spinner and wifi-off ("Waiting to send").
 *
 * Copy: plain words, no exclamation marks, no emojis. Failures say what
 * happened and what to do next (describeCommunityFailure).
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import VoiceNotePlayer from './VoiceNotePlayer';
import VoiceRecordSheet from './VoiceRecordSheet';
import SafetyMenu from './SafetyMenu';
import { formatRelative } from './SearchResultRow';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, radius, spacing, voiceShades } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useVoiceFeed } from '../../hooks/useVoiceFeed';
import { useVoiceOutbox, type VoiceOutboxItem } from '../../hooks/useVoiceOutbox';
import { voiceKeys } from '../../hooks/voiceQueryKeys';
import { communityVoiceApi, type VoiceNoteView } from '../../api/communityVoiceApi';
import { describeCommunityFailure } from '../../api/communityErrors';

export interface VoiceNotesSectionProps {
  workspaceId: string | null;
  viewerUserId?: string | null;
  viewerCoachId?: string | null;
  /** Not used: Style B records in a sheet over this feed (caller not VOICE-M's). */
  onRecord?: () => void;
  testID?: string;
}

export default function VoiceNotesSection({
  workspaceId,
  viewerUserId,
  viewerCoachId,
  testID = 'voice-notes-section',
}: VoiceNotesSectionProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  const feed = useVoiceFeed({ workspaceId });
  const outbox = useVoiceOutbox(workspaceId, viewerUserId ?? null);
  const [recordOpen, setRecordOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    await qc.invalidateQueries({ queryKey: voiceKeys.feedRoot(workspaceId) });
  }, [qc, workspaceId]);

  if (!featureFlags.communityVoiceNotes || !workspaceId) return null;

  const notes: VoiceNoteView[] = feed.data?.pages.flatMap((p) => p.voice_notes) ?? [];
  const failure = feed.isError ? describeCommunityFailure(feed.error, 'load_voice') : null;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <Ionicons name="mic-outline" size={18} color={semanticColors.textMuted} />
        <Text
          style={[styles.heading, { color: semanticColors.textPrimary }]}
          accessibilityRole="header"
        >
          Voice notes
        </Text>
        <HapticPressable
          intent="light"
          onPress={() => setRecordOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Record a voice note"
          testID={`${testID}-record`}
          style={[styles.record, { borderColor: semanticColors.accent }]}
        >
          <Text style={[styles.recordLabel, { color: semanticColors.accentText }]}>Record</Text>
        </HapticPressable>
      </View>

      {[...outbox.items].reverse().map((item) => (
        <OutboxRow
          key={item.id}
          item={item}
          onRetry={() => outbox.retry(item.id)}
          onDiscard={() => outbox.discard(item.id)}
          testID={`${testID}-pending-${item.id}`}
        />
      ))}

      {feed.isLoading ? (
        <ActivityIndicator
          color={semanticColors.accent}
          accessibilityLabel="Loading voice notes"
          testID={`${testID}-loading`}
        />
      ) : failure ? (
        <View style={styles.state} testID={`${testID}-error`}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>{failure.message}</Text>
          <HapticPressable
            intent="light"
            onPress={() => void feed.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID={`${testID}-retry`}
            style={[styles.record, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.recordLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      ) : notes.length === 0 && outbox.items.length === 0 ? (
        <Text
          style={[styles.muted, { color: semanticColors.textMuted }]}
          testID={`${testID}-empty`}
        >
          No voice notes yet. Tap Record to share one with your community.
        </Text>
      ) : (
        notes.map((note) => {
          const mine = !!viewerUserId && note.author_id === viewerUserId;
          const coach = note.author_is_coach === true;
          const when = formatRelative(note.created_at);
          return (
            <View key={note.id} style={styles.note} testID={`${testID}-note-${note.id}`}>
              <View style={styles.noteMeta}>
                <Text style={styles.who} numberOfLines={1}>
                  {mine ? 'You' : (note.author_name ?? 'Member')}
                </Text>
                {coach ? <Text style={styles.coach}>Coach</Text> : null}
                {when ? <Text style={styles.when}>{when}</Text> : null}
                <View style={styles.spacer} />
                <SafetyMenu
                  targetType="voice_note"
                  targetId={note.id}
                  authorUserId={note.author_id}
                  viewerUserId={viewerUserId}
                  viewerCoachId={viewerCoachId}
                  contentNoun="voice note"
                  onDelete={
                    mine
                      ? async () => {
                          await communityVoiceApi.remove(note.id);
                          await refresh();
                        }
                      : undefined
                  }
                  onBlocked={() => {
                    void refresh();
                  }}
                  testID={`${testID}-menu-${note.id}`}
                />
              </View>
              <VoiceNotePlayer
                url={note.url}
                durationMs={note.duration_ms}
                peaks={note.waveform_peaks ?? []}
                tone={coach ? 'coach' : 'light'}
                offline={!outbox.online}
                onPlaybackError={() => void feed.refetch()}
                testID={`${testID}-player-${note.id}`}
              />
            </View>
          );
        })
      )}

      {feed.hasNextPage ? (
        <HapticPressable
          intent="light"
          onPress={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          accessibilityRole="button"
          accessibilityLabel="Show older voice notes"
          testID={`${testID}-more`}
          style={styles.more}
        >
          <Text style={[styles.recordLabel, { color: semanticColors.accentText }]}>
            {feed.isFetchingNextPage ? 'Loading…' : 'Show older voice notes'}
          </Text>
        </HapticPressable>
      ) : null}

      <VoiceRecordSheet
        visible={recordOpen}
        target={{ kind: 'hall' }}
        onClose={() => setRecordOpen(false)}
        onSend={(recording) => { outbox.send(recording); setRecordOpen(false); }}
      />
    </View>
  );
}

/** An unsent note of the viewer's: sending, waiting for the signal, or not sent. */
function OutboxRow({ item, onRetry, onDiscard, testID }: {
  item: VoiceOutboxItem; onRetry: () => void; onDiscard: () => void; testID: string;
}): React.ReactElement {
  const failed = item.status === 'failed';
  const waiting = item.status === 'waiting';
  const confirmDiscard = () =>
    Alert.alert('Delete this voice note?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDiscard },
    ]);
  return (
    <View style={styles.note} testID={testID}>
      <View style={styles.noteMeta}>
        <Text style={styles.who}>You</Text>
        <Text style={styles.when} testID={`${testID}-status`}>
          {item.status === 'sending' ? 'Sending…' : failed ? 'Not sent' : ''}
        </Text>
      </View>
      <VoiceNotePlayer
        url={item.input.uri}
        durationMs={item.input.durationMs}
        peaks={item.peaks}
        trailing={
          failed ? undefined : (
            // Owner: a sending circle, plus a struck-through wifi mark offline.
            <View
              style={styles.waiting}
              accessible={waiting}
              accessibilityLabel={waiting ? 'Waiting to send' : undefined}
              testID={`${testID}-${item.status}`}
            >
              <ActivityIndicator size="small" color={fp.n700} />
              {waiting ? (
                <View style={styles.wifiOff}>
                  <Ionicons name="wifi-outline" size={18} color={fp.n700} />
                  <View style={styles.strike} />
                </View>
              ) : null}
            </View>
          )
        }
        footer={
          failed ? (
            <View style={styles.failed}>
              <View style={styles.failedLine} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={18} color={fp.error} />
                <Text style={styles.failedText}>That didn’t send. Your recording is safe — try sending again.</Text>
              </View>
              <View style={styles.failedActions}>
                <HapticPressable
                  intent="light"
                  onPress={onRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Try sending the voice note again"
                  testID={`${testID}-retry`}
                  style={styles.retry}
                >
                  <Ionicons name="refresh" size={18} color={fp.onDeep} />
                  <Text style={[styles.recordLabel, styles.retryLabel, { color: fp.onDeep }]}>Try again</Text>
                </HapticPressable>
                <HapticPressable
                  intent="light"
                  onPress={confirmDiscard}
                  accessibilityRole="button"
                  accessibilityLabel="Delete"
                  testID={`${testID}-delete`}
                  style={styles.del}
                >
                  <Text style={[styles.recordLabel, { color: fp.n700 }]}>Delete</Text>
                </HapticPressable>
              </View>
            </View>
          ) : item.status === 'sending' ? (
            // GOAL 03: a thin line fills as the audio goes up (the owner's circle stays beside the time).
            <View
              style={styles.prog}
              accessibilityRole="progressbar"
              accessibilityLabel="Sending voice note"
              accessibilityValue={{ min: 0, max: 100, now: Math.round((item.progress ?? 0) * 100) }}
              testID={`${testID}-progress`}
            >
              <View style={[styles.progFill, { width: `${Math.round((item.progress ?? 0) * 100)}%` }]} />
            </View>
          ) : null
        }
        testID={`${testID}-player`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: { flex: 1, fontSize: 15, fontWeight: '600' },
  record: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordLabel: { fontSize: 14, fontWeight: '600' },
  retryLabel: { fontSize: 15 }, // GOAL .btn.sm 0.9375rem
  state: { gap: spacing.sm, alignItems: 'flex-start' },
  muted: { fontSize: 14, lineHeight: 20 },
  note: { gap: spacing.sm },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  who: { fontSize: 17, fontWeight: '600', color: fp.ink, flexShrink: 1 },
  coach: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.chip,
    backgroundColor: fp.deep, color: fp.gold, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  when: { fontSize: 15, color: fp.n700 },
  spacer: { flex: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  wifiOff: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  strike: { position: 'absolute', width: 22, height: 2, backgroundColor: fp.n700, transform: [{ rotate: '45deg' }] },
  failed: { gap: spacing.sm },
  failedLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  failedText: { flex: 1, fontSize: 15, lineHeight: 21, color: fp.error },
  failedActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  retry: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, borderRadius: radius.button, backgroundColor: fp.forest },
  more: { minHeight: 44, justifyContent: 'center' },
  prog: { height: 4, borderRadius: 2, backgroundColor: voiceShades.hairline, overflow: 'hidden', marginTop: spacing.sm },
  progFill: { height: 4, borderRadius: 2, backgroundColor: fp.forest },
  del: { minHeight: 48, minWidth: 48, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
});
