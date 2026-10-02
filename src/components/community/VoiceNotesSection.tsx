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
 * Copy: plain words, no exclamation marks, no emojis. Failures say what
 * happened and what to do next (describeCommunityFailure).
 */
import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import VoiceNotePlayer from './VoiceNotePlayer';
import SafetyMenu from './SafetyMenu';
import { formatRelative } from './SearchResultRow';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useVoiceFeed } from '../../hooks/useVoiceFeed';
import { voiceKeys } from '../../hooks/voiceQueryKeys';
import { communityVoiceApi, type VoiceNoteView } from '../../api/communityVoiceApi';
import { describeCommunityFailure } from '../../api/communityErrors';

export interface VoiceNotesSectionProps {
  workspaceId: string | null;
  viewerUserId?: string | null;
  viewerCoachId?: string | null;
  /** Opens the composer (CommunityVoiceComposer, target hall). */
  onRecord: () => void;
  testID?: string;
}

export default function VoiceNotesSection({
  workspaceId,
  viewerUserId,
  viewerCoachId,
  onRecord,
  testID = 'voice-notes-section',
}: VoiceNotesSectionProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  const feed = useVoiceFeed({ workspaceId });

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
          onPress={onRecord}
          accessibilityRole="button"
          accessibilityLabel="Record a voice note"
          testID={`${testID}-record`}
          style={[styles.record, { borderColor: semanticColors.accent }]}
        >
          <Text style={[styles.recordLabel, { color: semanticColors.accentText }]}>Record</Text>
        </HapticPressable>
      </View>

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
      ) : notes.length === 0 ? (
        <Text
          style={[styles.muted, { color: semanticColors.textMuted }]}
          testID={`${testID}-empty`}
        >
          No voice notes yet. Tap Record to share one with your community.
        </Text>
      ) : (
        notes.map((note) => {
          const mine = !!viewerUserId && note.author_id === viewerUserId;
          const when = formatRelative(note.created_at);
          return (
            <View
              key={note.id}
              style={[
                styles.note,
                {
                  backgroundColor: semanticColors.bgSurface,
                  borderColor: semanticColors.border,
                },
              ]}
              testID={`${testID}-note-${note.id}`}
            >
              <View style={styles.noteMeta}>
                <Text style={[styles.who, { color: semanticColors.textMuted }]}>
                  {mine ? 'You' : 'Member'}
                  {when ? ` · ${when}` : ''}
                </Text>
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
  note: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  noteMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  who: { fontSize: 12 },
  more: { minHeight: 44, justifyContent: 'center' },
});
