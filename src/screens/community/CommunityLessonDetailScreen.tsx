/**
 * CommunityLessonDetailScreen — a single classroom lesson (v3-2), read-only.
 *
 * Shows the lesson title, body, a release-lock badge when the lesson is
 * published-but-not-yet-released, and its media as a calm list of tiles. The
 * mobile surface does NOT play media inline (that is a later lane); each tile
 * surfaces the media kind, an optional duration, and whether a signed URL is
 * currently available — a tile whose `url` is null renders DISABLED (a missing
 * signed URL is a transient/unconfigured-storage condition, not a tap target),
 * rather than a broken link (DESIGN_INTELLIGENCE §3.4 — no dead/broken
 * affordances).
 *
 * A release-locked lesson suppresses media entirely and explains it will unlock
 * later, so the student is never handed playback they cannot use.
 *
 * Registered in CommunityNavigator only when `featureFlags.communityClassroom`
 * is true, so when the flag is OFF the screen never enters the tree. As a
 * defense-in-depth guard the body still renders a neutral "not available"
 * state. Tokens only; line Ionicons only.
 */
import React, { useEffect, useMemo, useRef } from 'react';
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
import { ThreadHeader } from '../../components/community';
import LessonReleaseLockBadge from '../../components/community/LessonReleaseLockBadge';
import HapticPressable from '../../components/HapticPressable';
import {
  communityClassroomApi,
  type ClassroomMedia,
  type ClassroomMediaKind,
} from '../../api/communityClassroomApi';
import type { CommunityRoute } from './communityNavTypes';

const MEDIA_ICON: Record<ClassroomMediaKind, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam-outline',
  audio: 'headset-outline',
  pdf: 'document-text-outline',
  image: 'image-outline',
};

const MEDIA_NOUN: Record<ClassroomMediaKind, string> = {
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  image: 'Image',
};

/** "3:04" / "1:02:09" / null when no duration is known. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function MediaTile({
  media,
  testID,
}: {
  media: ClassroomMedia;
  testID: string;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const available = media.url !== null;
  const duration = formatDuration(media.duration_sec);
  const noun = MEDIA_NOUN[media.kind];
  const detail = available
    ? duration
      ? `${noun} · ${duration}`
      : noun
    : `${noun} · preparing`;

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: available
            ? semanticColors.bgSurface
            : semanticColors.disabledBg,
          borderColor: semanticColors.border,
        },
      ]}
      // A tile is informational here (no inline playback yet). When the signed
      // URL is missing it reads as "preparing" and is explicitly disabled.
      accessibilityRole="text"
      accessibilityState={{ disabled: !available }}
      accessibilityLabel={detail}
      testID={testID}
    >
      <Ionicons
        name={MEDIA_ICON[media.kind]}
        size={20}
        color={available ? semanticColors.accent : semanticColors.textOnDisabled}
      />
      <Text
        style={[
          styles.tileLabel,
          {
            color: available
              ? semanticColors.textPrimary
              : semanticColors.textOnDisabled,
          },
        ]}
        numberOfLines={1}
      >
        {detail}
      </Text>
    </View>
  );
}

export default function CommunityLessonDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CommunityRoute<'CommunityLessonDetail'>>();
  const postId = route.params?.postId ?? '';

  const lesson = useQuery({
    queryKey: ['community', 'classroom', 'lesson', postId],
    queryFn: () => communityClassroomApi.getLesson(postId),
    enabled: !!postId && featureFlags.communityClassroom,
  });

  const locked = lesson.data?.release_locked ?? false;
  const media = useMemo(
    // A locked lesson suppresses media entirely (the student cannot use it
    // yet); an unlocked lesson shows its tiles in server order.
    () => (locked ? [] : (lesson.data?.media ?? [])),
    [locked, lesson.data],
  );

  // Announce the lesson title once it loads so a screen-reader user gets a
  // landmark for the detail they navigated into.
  const announced = useRef(false);
  const title = lesson.data?.title;
  useEffect(() => {
    if (!lesson.isSuccess || announced.current || !title) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility(`Lesson, ${title}`);
  }, [lesson.isSuccess, title]);

  // Defense-in-depth: never reachable with the flag off (route not registered).
  if (!featureFlags.communityClassroom) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Lesson" testID="community-lesson-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            This lesson is not available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (lesson.isLoading) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Lesson" testID="community-lesson-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-lesson-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading lesson"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading lesson…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (lesson.isError || !lesson.data) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Lesson" testID="community-lesson-header" />
        <View style={styles.center} testID="community-lesson-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load this lesson. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void lesson.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-lesson-retry"
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

  const post = lesson.data;

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
    >
      <ThreadHeader title="Lesson" testID="community-lesson-header" />
      <ScrollView
        contentContainerStyle={styles.content}
        testID="community-lesson-scroll"
      >
        <Text
          style={[styles.title, { color: semanticColors.textPrimary }]}
          accessibilityRole="header"
        >
          {post.title}
        </Text>

        {locked ? (
          <LessonReleaseLockBadge
            releaseAt={post.release_at}
            testID="community-lesson-lock"
          />
        ) : null}

        {post.body_markdown ? (
          // Plain-text rendering for now: the body is shown verbatim (no
          // markdown engine in this lane), so untrusted markup is never
          // interpreted as rich text. A dedicated renderer is a later lane.
          <Text
            style={[styles.body, { color: semanticColors.textPrimary }]}
            testID="community-lesson-body"
          >
            {post.body_markdown}
          </Text>
        ) : null}

        {locked ? (
          <Text
            style={[styles.muted, styles.lockedNote, { color: semanticColors.textMuted }]}
            testID="community-lesson-locked-note"
          >
            This lesson unlocks later. Check back soon to see the rest.
          </Text>
        ) : media.length > 0 ? (
          <View style={styles.mediaList} testID="community-lesson-media">
            {media.map((m, idx) => (
              <MediaTile
                key={m.id}
                media={m}
                testID={`community-lesson-media-${idx}`}
              />
            ))}
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
  lockedNote: { textAlign: 'left', marginTop: spacing.sm },
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
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  body: { fontSize: 15, lineHeight: 22 },
  mediaList: { gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 48,
  },
  tileLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
});
