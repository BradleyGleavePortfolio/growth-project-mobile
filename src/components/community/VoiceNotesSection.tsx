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
 * Style B (VOICE-M): Record opens the record sheet over this feed. A note
 * shows the author's name (backend #1122; "Member" before it), a Coach mark
 * and the deep coach card, the real waveform, and New until this viewer has
 * played it to the end (then Played; heard, backend #1122). Unsent notes wait on top:
 * Sending… with a spinner, Not sent with Try again and Delete, or offline a
 * spinner and a wifi-off mark ("Waiting to send" when spoken).
 *
 * Copy: plain words, no exclamation marks, no emojis. Failures say what
 * happened and what to do next (describeCommunityFailure).
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import VoiceNotePlayer from './VoiceNotePlayer';
import VoiceRecordSheet from './VoiceRecordSheet';
import SafetyMenu from './SafetyMenu';
import { formatRelative } from './SearchResultRow';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, radius, spacing } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useVoiceFeed } from '../../hooks/useVoiceFeed';
import { useVoiceOutbox, type VoiceOutboxItem } from '../../hooks/useVoiceOutbox';
import { voiceKeys } from '../../hooks/voiceQueryKeys';
import { communityVoiceApi, type VoiceNoteFeedPage, type VoiceNoteView } from '../../api/communityVoiceApi';
import { describeCommunityFailure } from '../../api/communityErrors';

export interface VoiceNotesSectionProps {
  workspaceId: string | null;
  viewerUserId?: string | null;
  viewerCoachId?: string | null;
  /** Not used: Style B records in a sheet over this feed (caller not VOICE-M's). */
  onRecord?: () => void;
  /** A space: its notes only, and new notes go there (absent = the Hall). */
  cohortId?: string;
  cohortName?: string;
  /** The space's coach: "Reply by voice" on members' notes (Style B 09). */
  coachView?: boolean;
  testID?: string;
}

export default function VoiceNotesSection({
  workspaceId,
  viewerUserId,
  viewerCoachId,
  cohortId,
  cohortName,
  coachView = false,
  testID = 'voice-notes-section',
}: VoiceNotesSectionProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  const feed = useVoiceFeed({ workspaceId, cohortId });
  const outbox = useVoiceOutbox(workspaceId, viewerUserId ?? null);
  const pending = outbox.items.filter((i) => i.input.cohortId === cohortId);
  const [recordOpen, setRecordOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<VoiceNoteView | null>(null);
  const closeSheet = () => {
    setRecordOpen(false);
    setReplyTo(null);
  };

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    await qc.invalidateQueries({ queryKey: voiceKeys.feedRoot(workspaceId) });
  }, [qc, workspaceId]);

  // Played to the end: Played at once here; the server keeps it for next time.
  const markHeard = useCallback(
    (id: string) => {
      if (!workspaceId) return;
      const at = new Date().toISOString();
      qc.setQueriesData<InfiniteData<VoiceNoteFeedPage>>({ queryKey: voiceKeys.feedRoot(workspaceId) }, (d) =>
        d && { ...d, pages: d.pages.map((p) => ({ ...p, voice_notes: p.voice_notes.map((n) => (n.id === id ? { ...n, heard_at: at } : n)) })) },
      );
      void communityVoiceApi.markHeard(id).catch(() => undefined);
    },
    [qc, workspaceId],
  );

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

      {[...pending].reverse().map((item) => (
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
      ) : notes.length === 0 && pending.length === 0 ? (
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
          // heard_at is undefined on a server without it: then neither mark.
          const heard = mine || note.heard_at === undefined ? undefined : note.heard_at;
          const parent = note.parent_message_id ? notes.find((n) => n.message_id === note.parent_message_id) : undefined;
          const canReply = coachView && !mine && !!cohortId && !!note.message_id;
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
              {parent ? (
                <Text style={styles.replyTo} numberOfLines={2}>{`Reply to ${parent.author_name ?? 'Member'}`}</Text>
              ) : null}
              <VoiceNotePlayer
                url={note.url}
                durationMs={note.duration_ms}
                peaks={note.waveform_peaks ?? []}
                tone={coach ? 'coach' : 'light'}
                offline={!outbox.online}
                onPlaybackError={() => void feed.refetch()}
                onFinished={heard === null ? () => markHeard(note.id) : undefined}
                trailing={
                  canReply ? (
                    <HapticPressable
                      intent="light"
                      onPress={() => setReplyTo(note)}
                      accessibilityRole="button"
                      accessibilityLabel="Reply by voice"
                      testID={`${testID}-reply-${note.id}`}
                      style={styles.reply}
                    >
                      <Ionicons name="mic-outline" size={18} color={coach ? fp.leaf : fp.forest} />
                      <Text style={[styles.replyText, coach && { color: fp.leaf }]}>Reply by voice</Text>
                    </HapticPressable>
                  ) : heard === null ? (
                    <Text style={[styles.fresh, coach && { borderWidth: 0 }]} testID={`${testID}-new-${note.id}`}>New</Text>
                  ) : heard ? (
                    <View style={styles.played} testID={`${testID}-played-${note.id}`}>
                      <Ionicons name="checkmark" size={16} color={coach ? fp.onDeepMuted : fp.n700} />
                      <Text style={[styles.playedText, coach && { color: fp.onDeepMuted }]}>Played</Text>
                    </View>
                  ) : null
                }
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
        visible={recordOpen || replyTo !== null}
        target={cohortId ? { kind: 'cohort', cohortName } : { kind: 'hall' }}
        title={replyTo ? `Reply to ${replyTo.author_name ?? 'Member'}` : undefined}
        coachView={coachView}
        onClose={closeSheet}
        onSend={(recording) => {
          outbox.send(recording, { cohortId, parentMessageId: replyTo?.message_id ?? undefined });
          closeSheet();
        }}
      />
    </View>
  );
}

/** An unsent note of the viewer's: sending, waiting for the signal, or not sent. */
function OutboxRow({
  item,
  onRetry,
  onDiscard,
  testID,
}: {
  item: VoiceOutboxItem;
  onRetry: () => void;
  onDiscard: () => void;
  testID: string;
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
                  <Text style={[styles.recordLabel, { color: fp.onDeep }]}>Try again</Text>
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
  state: { gap: spacing.sm, alignItems: 'flex-start' },
  muted: { fontSize: 14, lineHeight: 20 },
  note: { gap: spacing.sm },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  who: { fontSize: 17, fontWeight: '600', color: fp.ink, flexShrink: 1 },
  coach: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.chip,
    backgroundColor: fp.deep, color: fp.gold, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  when: { fontSize: 15, color: fp.n700 },
  replyTo: { fontSize: 15, lineHeight: 20, color: fp.n700 },
  spacer: { flex: 1 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  replyText: { fontSize: 13, fontWeight: '600', color: fp.forest },
  fresh: { overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.chip, backgroundColor: fp.leaf,
    borderWidth: 1, borderColor: fp.moss, color: fp.ink, fontSize: 13, lineHeight: 16, fontWeight: '600' },
  played: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playedText: { fontSize: 14, fontWeight: '500', color: fp.n700 },
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
  del: { minHeight: 48, minWidth: 48, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
});
