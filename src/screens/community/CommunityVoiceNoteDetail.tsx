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
 * Safety (Apple 1.2): audio cannot be text-filtered, so the note carries the
 * SafetyMenu: Report (reason list, reviewed within 24 hours) and Block for
 * other members' notes, Delete for the viewer's own note. The workspace coach (or owner) also gets
 * "Remove for everyone" on other members' notes, asked in the same sheet (owner #174-4). Once reported,
 * the note folds into the VN-07 row for this viewer and its player unmounts (GOAL B-06b), the same fold
 * as the Hall feed; the menu stays, Report shown as done ("Reported") with Block still there. A note the
 * coach removed reads as one quiet line (removed/VoiceRemovedPlaceholder): no player, menu or transcript.
 *
 * Look (FR-865R4, Sol R3 #865 B7, Opus R3 #865 C3/N6): Voice B Studio's page (GOAL B-09a in frame 05b's shell). ONE
 * header in every state, the deep forest bar with Back (StudioPage), the status band above it in the same forest; the
 * note named as the Hall names it (square identity tile, name, Coach mark, time) with the card under the name; the
 * player told when the phone is offline, so Play is off (GOAL B-10a) instead of a load that fails.
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
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, spacing, radius, voiceFaces } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useVoiceCatchUp } from '../../hooks/useVoiceFeed';
import { voiceKeys } from '../../hooks/voiceQueryKeys';
import { ThreadHeader } from '../../components/community';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { isEffectivelyOnline, useNetworkStatus } from '../../hooks/useNetworkStatus';
import VoiceNotePlayer from '../../components/community/VoiceNotePlayer';
import { formatRelative } from '../../components/community/SearchResultRow';
import HapticPressable from '../../components/HapticPressable';
import { communityVoiceApi, type VoiceNoteView } from '../../api/communityVoiceApi';
import VoiceRemovedPlaceholder, {
  voiceRemovedLine,
} from '../../components/community/removed/VoiceRemovedPlaceholder';
import SafetyMenu from '../../components/community/SafetyMenu';
import VoiceReportedFold, {
  markVoiceNoteReported,
  useReportedVoiceNotes,
} from '../../components/community/VoiceReportedFold';
import { formatDuration } from '../../components/community/voiceFormat';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { describeCommunityFailure } from '../../api/communityErrors';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

/**
 * Frame 05b's shell: the deep forest bar is the page's one header (Back, the title, an empty 44 pt slot), the app's
 * status band takes the same forest with light icons while the page is in front (as the community DM), and the bone
 * page sits below. Both stacks mount this page with no bar of their own.
 */
function StudioPage({ onBack, children }: { onBack: () => void; children: React.ReactNode }): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: fp.deep }]} edges={['top']}>
      <ForestStatusBar />
      <ThreadHeader tone="deep" title="Voice note" onBack={onBack} testID="community-voice-detail-header" />
      <View style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}>{children}</View>
    </SafeAreaView>
  );
}

export default function CommunityVoiceNoteDetail(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CommunityRoute<'CommunityVoiceNoteDetail'>>();
  const navigation = useNavigation<CommunityNav>();
  const goBack = () => navigation.goBack();
  // Opus R3 #865 N6: no connection, no new Play (the player's grey disc), the same reading as the coach inbox.
  const online = isEffectivelyOnline(useNetworkStatus());
  const qc = useQueryClient();
  const viewer = useCurrentUser();
  const voiceNoteId = route.params?.voiceNoteId ?? '';
  const excerpt = route.params?.excerpt ?? '';
  const reported = useReportedVoiceNotes();
  const me = useCommunityMe().data;
  const role = me?.membership?.role;
  const viewerModerates = role === 'coach' || role === 'owner';

  // Server-evaluated runtime gate (fail-safe OFF). The static flag below still
  // controls route REGISTRATION; this is the inner, server-authoritative gate.
  const { flags } = useFeatureFlags();
  const runtimeEnabled = flags.community_search;
  // VOICE-INBOX: the coach inbox opens a client's note here too; that route is
  // registered only behind the build-time `communityVoiceNotes` flag.
  const open =
    featureFlags.communityVoiceNotes ||
    (featureFlags.communitySearch && runtimeEnabled);

  // The coach inbox route (communityVoiceNotes) loads the note too, not only search (else Loading forever).
  const noteEnabled = !!voiceNoteId && open;
  const note = useQuery({
    queryKey: voiceKeys.note(voiceNoteId),
    queryFn: () => communityVoiceApi.getOne(voiceNoteId),
    enabled: noteEnabled,
    meta: { persist: false }, // like the feed: never saved to the phone, so a restart cannot replay a banned author's note
  });
  // A removal ping re-reads this page (useCommunityBadge); a missed one heals on the way back (#1165).
  useVoiceCatchUp(note, noteEnabled);

  // VUX-B2: losing the community while this page is open (a ban, a removal) asks the server for the
  // note again; the page shows Loading, with the player unloaded, until the server says it may be heard.
  const meWorkspace = me ? me.workspace_id : undefined;
  const meMembership = me ? (me.membership?.id ?? null) : undefined;
  const admitted = useRef<[string | null, string | null] | null>(null);
  useEffect(() => {
    if (meWorkspace === undefined || meMembership === undefined) return;
    const before = admitted.current;
    admitted.current = [meWorkspace, meMembership];
    const lost =
      !!before &&
      ((before[0] !== null && before[0] !== meWorkspace) || (before[1] !== null && before[1] !== meMembership));
    if (lost) void qc.resetQueries({ queryKey: voiceKeys.note(voiceNoteId), exact: true });
  }, [meWorkspace, meMembership, qc, voiceNoteId]);

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
  if (!open) {
    return (
      <StudioPage onBack={goBack}>
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            This voice note is not available right now.
          </Text>
        </View>
      </StudioPage>
    );
  }

  if (note.isLoading) {
    return (
      <StudioPage onBack={goBack}>
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
      </StudioPage>
    );
  }

  if (note.isError || !note.data) {
    return (
      <StudioPage onBack={goBack}>
        <View style={styles.center} testID="community-voice-detail-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            {note.isError
              ? describeCommunityFailure(note.error, 'load_voice').message
              : 'This voice note is no longer available. Go back and refresh.'}
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
      </StudioPage>
    );
  }

  const data = note.data;
  const when = formatRelative(data.created_at);
  const mine = !!viewer?.id && viewer.id === data.author_id;
  const folded = reported.has(data.id);
  // Owner #174-4: a coach-removed note shows one quiet line, no player, menu or transcript.
  const removedLine = voiceRemovedLine(data, viewer?.id);
  const noteKey = voiceKeys.note(voiceNoteId);
  const remove = async () => {
    await communityVoiceApi.remove(data.id);
    await qc.invalidateQueries({ queryKey: ['community'] });
    navigation.goBack();
  };
  // The coach stays on the page and reads "You removed this voice note" at once: the note becomes the
  // placeholder row the server now reads back (backend #1165 CONTRACT §1); every other list re-reads.
  const removeForEveryone = async () => {
    await communityVoiceApi.remove(data.id);
    qc.setQueryData<VoiceNoteView>(noteKey, {
      ...data,
      url: null,
      duration_ms: 0,
      bytes: 0,
      has_waveform: false,
      waveform_peaks: null,
      removed_at: new Date().toISOString(),
      removed_by: { role: 'coach', user_id: viewer?.id ?? '', name: '' },
    });
    await qc.invalidateQueries({
      queryKey: ['community'],
      predicate: (q) => !(q.queryKey[1] === 'voice-note' && q.queryKey[2] === voiceNoteId),
    });
  };

  const name = data.author_name?.trim() || 'Voice note';
  const coach = data.author_is_coach === true;
  const initial = data.author_name?.trim()?.[0]?.toUpperCase() ?? '';

  return (
    <StudioPage onBack={goBack}>
      <ScrollView
        contentContainerStyle={styles.content}
        testID="community-voice-detail-scroll"
      >
        {/* Sol R3 #865 B7 (GOAL B-09a): named as the Hall names a note, the square identity tile (decorative: the name
            beside it says who), the name, the coach's Coach mark and the time in the Hall's type, the menu at the end. */}
        <View style={styles.metaRow}>
          {initial ? (
            <View
              style={[styles.tile, coach ? styles.tileCoach : styles.tileMember]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="community-voice-detail-tile"
            >
              <Text style={coach ? styles.initialCoach : styles.initial} allowFontScaling={false}>
                {initial}
              </Text>
            </View>
          ) : null}
          <Text style={styles.who} numberOfLines={1} accessibilityRole="header">
            {name}
          </Text>
          {coach ? <Text style={[styles.coachMark, styles.keep]} numberOfLines={1}>Coach</Text> : null}
          {when.length > 0 ? <Text style={[styles.when, styles.keep]} numberOfLines={1}>{when}</Text> : null}
          <View style={styles.spacer} />
          {/* Owner #174-4: a reported note keeps its menu (Reported, Block, the coach's Remove). */}
          {removedLine ? null : (
            <SafetyMenu
              targetType="voice_note"
              targetId={data.id}
              authorUserId={data.author_id}
              viewerUserId={viewer?.id}
              viewerCoachId={viewer?.coach_id}
              contentNoun="voice note"
              context={{
                name: mine ? 'You' : (data.author_name ?? 'Member'),
                detail: `voice note · ${formatDuration(data.duration_ms)}`,
              }}
              reported={folded}
              onDelete={mine ? remove : undefined}
              onRemove={!mine && viewerModerates ? removeForEveryone : undefined}
              onReported={() => markVoiceNoteReported(data.id)}
              onBlocked={() => navigation.goBack()}
              testID="community-voice-detail-safety"
            />
          )}
        </View>

        {/* GOAL B-09a: the card sits under the name, not under the tile. */}
        <View style={initial ? styles.underName : undefined}>
          {removedLine ? (
            <VoiceRemovedPlaceholder line={removedLine} testID="community-voice-detail-removed" />
          ) : folded ? (
            <VoiceReportedFold testID="community-voice-detail-reported" />
          ) : (
            <VoiceNotePlayer
              url={data.url}
              durationMs={data.duration_ms}
              peaks={data.waveform_peaks ?? []}
              // Sol R5-B3: a coach's note is the deep card here too, as in the Hall (GOAL B-01b).
              tone={coach ? 'coach' : 'light'}
              offline={!online}
              onPlaybackError={() => void note.refetch()}
              testID="community-voice-detail-player"
            />
          )}
        </View>

        {excerpt.length > 0 && !folded && !removedLine ? (
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
    </StudioPage>
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
  muted: { fontFamily: voiceFaces.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { fontFamily: voiceFaces.semibold, fontSize: 14, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md },
  // The Hall's voice row (VoiceNotesSection): name, Coach mark and time; the name gives way first at 130% on 360 pt.
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  who: { fontFamily: voiceFaces.semibold, fontSize: 17, fontWeight: '600', color: fp.ink, flexShrink: 1 },
  coachMark: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.chip,
    backgroundColor: fp.deep, color: fp.gold, fontFamily: voiceFaces.semibold, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  when: { fontFamily: voiceFaces.regular, fontSize: 15, color: fp.n700 },
  keep: { flexShrink: 0 },
  spacer: { flex: 1 },
  // GOAL B-09a's small identity tile: a member's leaf tile with a moss edge and an ink initial; the coach's deep tile
  // with a gold serif initial. The card below starts under the name (tile 32 + gap 8, + 4 as the frame).
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tileMember: { backgroundColor: fp.leaf, borderColor: fp.moss, borderWidth: 1 },
  tileCoach: { backgroundColor: fp.deep },
  initial: { fontFamily: voiceFaces.semibold, fontSize: 14, fontWeight: '600', color: fp.ink },
  initialCoach: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 18, lineHeight: 23, color: fp.gold },
  underName: { paddingLeft: 32 + spacing.sm + 4 },
  transcriptWrap: { gap: spacing.xs, marginTop: spacing.sm },
  transcriptLabel: { fontFamily: voiceFaces.semibold, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  transcript: { fontFamily: voiceFaces.regular, fontSize: 15, lineHeight: 22 },
});
