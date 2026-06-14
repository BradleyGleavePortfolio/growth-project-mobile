/**
 * CommunityClassroomScreen — the read-only student classroom feed (v3-2). Lists
 * the workspace's published, released lessons as LessonCards (pinned first,
 * then newest — the ordering is decided server-side); tapping a card opens the
 * lesson detail.
 *
 * This is a CONSUMPTION surface: the student cannot author here, so there is no
 * create CTA. Loading / empty / error states are distinct, and the workspace
 * prerequisite (useCommunityMe) is resolved BEFORE any "no lessons" empty state
 * so a still-loading or failed prerequisite is never shown as "no lessons yet".
 * The list is cursor-paginated (useClassroomFeed + onEndReached) so older
 * lessons stay reachable without an unbounded fetch.
 *
 * Registered in CommunityNavigator only when `featureFlags.communityClassroom`
 * is true; a defense-in-depth guard renders a neutral "not available" state if
 * it is somehow reached with the flag off. Tokens only; line Ionicons only.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useClassroomFeed } from '../../hooks/useClassroomFeed';
import { dedupeById } from '../../utils/dedupeById';
import { ThreadHeader } from '../../components/community';
import LessonCard from '../../components/community/LessonCard';
import ClassroomEmptyState from '../../components/community/ClassroomEmptyState';
import HapticPressable from '../../components/HapticPressable';
import type { ClassroomPost } from '../../api/communityClassroomApi';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  embedded?: boolean;
  /**
   * Workspace id — classroom posts are workspace-scoped on the backend. When
   * the Community tab embeds this surface it passes the resolved id; when the
   * route is reached on its own (deep link) the prop is absent and the screen
   * resolves the id itself from `useCommunityMe`.
   *
   * `undefined` means "not provided, resolve it here"; an explicit `null` means
   * "the parent's prerequisite is still loading/errored" and is treated as
   * not-yet-resolved, never as a real empty workspace.
   */
  workspaceId?: string | null;
  /**
   * The embedded prerequisite (`useCommunityMe`) truth, threaded from the
   * parent tab so a real `/community/me` error renders the SAME calm, retryable
   * error state the self-owned route renders — instead of collapsing a load
   * error into a null id that shows loading forever. When this screen owns the
   * `me` query (route path, no `workspaceId` prop) these are absent and the
   * screen reads its own `me` state directly.
   */
  prerequisiteLoading?: boolean;
  prerequisiteError?: boolean;
  /** Refetches `/community/me`; wired to the error-state retry button. */
  onRetryPrerequisite?: () => void;
}

export default function CommunityClassroomScreen({
  embedded,
  workspaceId: workspaceIdProp,
  prerequisiteLoading: prerequisiteLoadingProp,
  prerequisiteError: prerequisiteErrorProp,
  onRetryPrerequisite,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();

  // Resolve the workspace id internally when it was not threaded through props.
  // The hook is always called (Rules of Hooks); an explicit prop, when present,
  // wins so embedded callers avoid a second fetch.
  const me = useCommunityMe();
  const usingOwnMe = workspaceIdProp === undefined;
  const workspaceId = usingOwnMe
    ? (me.data?.workspace_id ?? null)
    : workspaceIdProp;

  // The workspace prerequisite must SUCCEED before we can decide "no lessons".
  const prerequisiteLoading = usingOwnMe
    ? me.isLoading
    : (prerequisiteLoadingProp ?? workspaceIdProp === null);
  const prerequisiteError = usingOwnMe
    ? me.isError
    : (prerequisiteErrorProp ?? false);
  const retryPrerequisite = usingOwnMe
    ? () => void me.refetch()
    : (onRetryPrerequisite ?? (() => {}));

  const feed = useClassroomFeed({ workspaceId });

  const data = useMemo(
    // Dedupe across pages: an overlapping/replayed cursor page must not put a
    // duplicate id into the FlatList (duplicate keys). First occurrence wins.
    () => dedupeById(feed.data?.pages.flatMap((p) => p.posts) ?? []),
    [feed.data],
  );

  const open = (lesson: ClassroomPost) =>
    navigation.navigate('CommunityLessonDetail', { postId: lesson.id });

  const onEndReached = useCallback(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) {
      void feed.fetchNextPage();
    }
  }, [feed]);

  // Announce the loaded count once data lands so a screen-reader user knows the
  // surface populated. A ref tracks the last announced count so only an actual
  // transition speaks.
  const lessonCount = data.length;
  const lastAnnouncedCount = useRef<number | null>(null);
  useEffect(() => {
    if (!feed.isSuccess) return;
    if (lastAnnouncedCount.current === lessonCount) return;
    lastAnnouncedCount.current = lessonCount;
    AccessibilityInfo.announceForAccessibility(
      lessonCount > 0
        ? `Lessons loaded, ${lessonCount} ${lessonCount === 1 ? 'item' : 'items'}`
        : 'Lessons loaded, none yet',
    );
  }, [feed.isSuccess, lessonCount]);

  const Container: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <View style={styles.flex}>{children}</View>
    : ({ children }) => (
        <SafeAreaView
          style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
          edges={['top']}
        >
          {children}
        </SafeAreaView>
      );

  // Defense-in-depth: never reachable with the flag off (the route is not
  // registered), but render a neutral state rather than a blank screen.
  if (!featureFlags.communityClassroom) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            The classroom is not available right now.
          </Text>
        </View>
      </Container>
    );
  }

  // The workspace prerequisite is resolved BEFORE any lesson state so a
  // still-loading or failed prerequisite is never mistaken for an empty
  // workspace. Loading shows a busy state; an error shows a calm retry.
  if (prerequisiteLoading) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-classroom-prereq-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading lessons"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading lessons…
          </Text>
        </View>
      </Container>
    );
  }

  if (prerequisiteError) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <View style={styles.center} testID="community-classroom-prereq-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load the classroom. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={retryPrerequisite}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-classroom-prereq-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  if (feed.isLoading) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-classroom-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading lessons"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading lessons…
          </Text>
        </View>
      </Container>
    );
  }

  if (feed.isError) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <View style={styles.center} testID="community-classroom-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load the classroom. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void feed.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-classroom-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  if (data.length === 0) {
    return (
      <Container>
        <ThreadHeader title="Classroom" testID="community-classroom-header" />
        <ClassroomEmptyState testID="community-classroom-empty" />
      </Container>
    );
  }

  return (
    <Container>
      <ThreadHeader title="Classroom" testID="community-classroom-header" />
      <FlatList
        data={data}
        accessibilityRole="list"
        accessibilityLabel={
          data.length > 0
            ? `Lessons, ${data.length} ${data.length === 1 ? 'item' : 'items'}`
            : 'Lessons, empty'
        }
        accessibilityLiveRegion="polite"
        renderItem={({ item }) => (
          <View role="listitem" testID={`community-lesson-listitem-${item.id}`}>
            <LessonCard
              lesson={item}
              onPress={open}
              testID={`community-lesson-card-${item.id}`}
            />
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <View style={styles.loadMore} testID="community-classroom-load-more">
              <ActivityIndicator
                color={semanticColors.accent}
                accessibilityRole="progressbar"
                accessibilityLabel="Loading more lessons"
              />
            </View>
          ) : null
        }
        testID="community-classroom-list"
      />
    </Container>
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
  listContent: { padding: spacing.lg, gap: spacing.sm },
  loadMore: { paddingVertical: spacing.lg, alignItems: 'center' },
});
