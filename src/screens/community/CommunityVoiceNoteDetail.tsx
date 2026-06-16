/**
 * CommunityVoiceNoteDetail — the detail surface a `voice_note_transcript`
 * community-search hit opens into (v3-4). Search returns a transcript EXCERPT
 * only (never the body), so this screen pairs that matched excerpt with the
 * voice note's own metadata + playback control.
 *
 * Data posture:
 *   - The voice-note id (NOT a postId) is the route param; metadata is fetched
 *     with `communityVoiceApi.getOne(voiceNoteId)`. A non-visible note is a 404
 *     server-side (existence never leaks) and renders here as a calm not-found.
 *   - The transcript `excerpt` rides in on the route param from the search row
 *     (the search backend already PII-stripped it); the voice-note metadata
 *     endpoint does NOT return a transcript body, so we show the excerpt we were
 *     handed rather than inventing a second transcript round-trip.
 *   - Playback degrades honestly: when the signed `url` is null the player is
 *     disabled, never a broken control (mirrors VoiceNotePlayer's own contract).
 *
 * Flag posture (D5=B+γ): the route is only REGISTERED behind the static
 * `featureFlags.communitySearch` build-time kill switch (navigator + F3 pin),
 * and the RUNTIME visibility is additionally gated by the server-evaluated
 * `useFeatureFlags().flags.community_search` (fail-safe OFF). A defense-in-depth
 * body guard renders a neutral "not available" state if reached with either off.
 *
 * Tokens only (no raw hex); line Ionicons only (no emoji); fontWeight <= '600'.
 */
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { ThreadHeader } from '../../components/community';
import VoiceNotePlayer from '../../components/community/VoiceNotePlayer';
import { formatRelative } from '../../components/community/SearchResultRow';
import HapticPressable from '../../components/HapticPressable';
import { communityVoiceApi } from '../../api/communityVoiceApi';
import type { CommunityRoute } from './communityNavTypes';

export default function CommunityVoiceNoteDetail(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CommunityRoute<'CommunityVoiceNoteDetail'>>();
  const voiceNoteId = route.params?.voiceNoteId ?? '';
  const excerpt = route.params?.excerpt ?? '';

  // Server-evaluated runtime gate (fail-safe OFF). The static flag below still
  // controls route REGISTRATION; this is the inner, server-authoritative gate.
  const { flags } = useFeatureFlags();
  const runtimeEnabled = flags.community_search;

  const note = useQuery({
    queryKey: ['community', 'voice-note', voiceNoteId],
    queryFn: () => communityVoiceApi.getOne(voiceNoteId),
    enabled: !!voiceNoteId && featureFlags.communitySearch && runtimeEnabled,
  });

  // Announce the surface once metadata loads so a screen-reader user gets a
  // landmark for the detail they navigated into.
  const announced = useRef(false);
  const loaded = note.isSuccess;
  useEffect(() => {
    if (!loaded || announced.current) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility('Voice note');
  }, [loaded]);

  // Defense-in-depth: never reachable with the flag off (route not registered),
  // and additionally hidden if the server flag resolves OFF at runtime.
  if (!featureFlags.communitySearch || !runtimeEnabled) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Voice note" testID="community-voice-detail-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            This voice note is not available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (note.isLoading) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Voice note" testID="community-voice-detail-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-voice-detail-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading voice note"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading voice note…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (note.isError || !note.data) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Voice note" testID="community-voice-detail-header" />
        <View style={styles.center} testID="community-voice-detail-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load this voice note. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void note.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-voice-detail-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </SafeAreaView>
    );
  }

  const data = note.data;
  const when = formatRelative(data.created_at);

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
    >
      <ThreadHeader title="Voice note" testID="community-voice-detail-header" />
      <ScrollView
        contentContainerStyle={styles.content}
        testID="community-voice-detail-scroll"
      >
        <View style={styles.metaRow}>
          <Ionicons
            name="mic-outline"
            size={18}
            color={semanticColors.textMuted}
          />
          <Text
            style={[styles.kind, { color: semanticColors.textMuted }]}
            accessibilityRole="header"
          >
            Voice note
          </Text>
          {when.length > 0 ? (
            <Text style={[styles.when, { color: semanticColors.textMuted }]}>
              {when}
            </Text>
          ) : null}
        </View>

        <VoiceNotePlayer
          url={data.url}
          durationMs={data.duration_ms}
          testID="community-voice-detail-player"
        />

        {excerpt.length > 0 ? (
          <View style={styles.transcriptWrap}>
            <Text
              style={[styles.transcriptLabel, { color: semanticColors.textMuted }]}
            >
              Matched in transcript
            </Text>
            <Text
              style={[styles.transcript, { color: semanticColors.textPrimary }]}
              testID="community-voice-detail-excerpt"
            >
              {excerpt}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kind: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, flex: 1 },
  when: { fontSize: 12 },
  transcriptWrap: { gap: spacing.xs, marginTop: spacing.sm },
  transcriptLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  transcript: { fontSize: 15, lineHeight: 22 },
});
