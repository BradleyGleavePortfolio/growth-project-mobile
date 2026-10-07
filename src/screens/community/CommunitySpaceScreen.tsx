/**
 * CommunitySpaceScreen — a Space view (product plan §2.1). Renders the post
 * feed for either the Hall (workspace-wide announcements + cohort posts) or a
 * Cohort. The Lab/Hall is a POST feed, not a chat (§2.3).
 *
 * Quiet space: serif name, factual description and unfilled hairline post rows.
 * Empty states use neutral copy and one forest action, without avatar chrome.
 * A feed with posts carries a "New post" button above the list, so the
 * composer stays reachable after the first post (AUDIT-10-125 B-2).
 * Tapping a post opens its thread. Standardized on semanticColors / tokens.ts.
 *
 * The workspace prerequisite (useCommunityMe) is resolved BEFORE any post empty
 * state so a still-loading or failed prerequisite is never shown as "the Hall
 * is quiet". When the Community tab embeds this surface it threads the real
 * `/community/me` truth (loading / error / retry) through props so a load error
 * renders the SAME calm retryable error the route renders instead of collapsing
 * a null workspace id into an inert empty state.
 *
 * B-E2E-1: a SUCCESSFUL `/community/me` with workspace_id null means the
 * member's coach has no community space yet. That renders the Today-style
 * "No cohort yet / Send your coach a message" state, never "Be the first to
 * post" (the composer has no workspace to post to). Opened as a route (no
 * props), the screen resolves the workspace from `/community/me` itself.
 */
import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, typography } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityMe, usePosts, isOptimisticId } from '../../hooks/useCommunity';
import SafetyMenu from '../../components/community/SafetyMenu';
import VoiceNotesSection from '../../components/community/VoiceNotesSection';
import { featureFlags } from '../../config/featureFlags';
import HapticPressable from '../../components/HapticPressable';
import type { CommunityPost } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';
import { COMMUNITY_SUPPORT_EMAIL, describeCommunityFailure } from '../../api/communityErrors';

interface Props {
  embedded?: boolean;
  /** 'hall' | 'cohort' — which Space type this view renders. */
  space?: 'hall' | 'cohort';
  /**
   * Workspace id — posts are workspace-scoped on the backend. When the Community
   * tab embeds this surface it passes the resolved id; an explicit `null` means
   * the parent's prerequisite is still loading or errored and is treated as
   * not-yet-resolved, never as a real empty workspace.
   */
  workspaceId?: string | null;
  /**
   * The embedded prerequisite (`useCommunityMe`) truth, threaded from the parent
   * tab so a real `/community/me` error renders the SAME calm, retryable error
   * state instead of collapsing a load error into a null id that shows an inert
   * empty feed. When these are absent the screen falls back to treating a null
   * id as still-pending (loading), preserving the prior behaviour.
   */
  prerequisiteLoading?: boolean;
  prerequisiteError?: boolean;
  /** Refetches `/community/me`; wired to the error-state retry button. */
  onRetryPrerequisite?: () => void;
}

export default function CommunitySpaceScreen({
  embedded,
  space = 'hall',
  workspaceId: workspaceIdProp,
  prerequisiteLoading: prerequisiteLoadingProp,
  prerequisiteError: prerequisiteErrorProp,
  onRetryPrerequisite,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const rootNavigation = useNavigation<NavigationProp<ParamListBase>>();
  const client = useCurrentUser();
  // Opened as a route (no workspace prop): resolve from `/community/me` here.
  // The query is shared with the tab, so this adds no request.
  const me = useCommunityMe();
  const threaded = workspaceIdProp !== undefined;
  const workspaceId = threaded ? workspaceIdProp : (me.data?.workspace_id ?? null);
  const posts = usePosts(workspaceId);

  // The workspace prerequisite must SUCCEED before we can decide "no posts".
  // The parent threads the real `me.isLoading`/`me.isError` truth so a
  // `/community/me` error renders the calm retryable error here instead of an
  // inert empty feed (the null-id fallback covers a parent that has not yet
  // wired the props). A genuine workspace_id=null SUCCESS (no membership) is
  // distinguished from failure: it falls through to the calm empty/onboarding
  // state, never the error state. Uses `isLoading` (not `isFetching`) so a
  // background refetch with existing data does not flash the loading branch.
  const prerequisiteLoading =
    prerequisiteLoadingProp ?? (threaded ? workspaceId === null : me.isLoading);
  const prerequisiteError = prerequisiteErrorProp ?? (threaded ? false : me.isError);
  const retryPrerequisite = onRetryPrerequisite ?? (() => void me.refetch());
  // The prerequisite resolved and the member has no community space (B-E2E-1).
  const noWorkspace = !prerequisiteLoading && !prerequisiteError && !workspaceId;

  // Coach messages live in the Home stack; jump there from the Community tab.
  const messageCoach = () => rootNavigation.navigate('Home', { screen: 'Messages' });

  const openThread = (post: CommunityPost) =>
    navigation.navigate('CommunityThread', { postId: post.id });

  const compose = () => navigation.navigate('CommunityComposer', { mode: 'post' });

  // Hall voice notes (behind featureFlags.communityVoiceNotes): Record entry
  // point plus the feed, each note with Report / Block / author Delete.
  const showVoice = space === 'hall' && featureFlags.communityVoiceNotes;
  const voiceSection = showVoice ? (
    <VoiceNotesSection
      workspaceId={workspaceId ?? null}
      viewerUserId={client?.id}
      viewerCoachId={client?.coach_id}
      onRecord={() => navigation.navigate('CommunityVoiceComposer', { target: 'hall' })}
      testID="community-space-voice"
    />
  ) : null;

  const data = posts.data ?? [];
  // A post-feed LOAD FAILURE must render a calm retryable error, never the
  // "the Hall is quiet" / "no cohort posts" empty state — collapsing a failed
  // `usePosts` into an empty feed silently hides the failure (R65 #36/#44).
  // True-empty is only a successful query that returned zero posts.
  const isPostsError = !posts.isLoading && posts.isError;
  const isEmpty = !posts.isLoading && !posts.isError && data.length === 0;
  // Described once per error (an unexpected one is reported to Sentry once).
  const postsFailure = useMemo(
    () => (isPostsError ? describeCommunityFailure(posts.error, 'load_posts') : null),
    [isPostsError, posts.error],
  );

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

  // Resolve the prerequisite BEFORE any post state so a still-loading or failed
  // prerequisite is never mistaken for an empty workspace.
  if (prerequisiteLoading) {
    return (
      <Container>
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-space-prereq-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading…
          </Text>
        </View>
      </Container>
    );
  }

  if (prerequisiteError) {
    return (
      <Container>
        <View style={styles.center} testID="community-space-prereq-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            {`This space did not load. Check your connection, then tap Try again. If it keeps happening, email ${COMMUNITY_SUPPORT_EMAIL}.`}
          </Text>
          <HapticPressable
            intent="light"
            onPress={retryPrerequisite}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-space-prereq-retry"
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

  // No space yet: point the member to their coach and offer no composer, so
  // nothing can post to an empty workspace id (B-E2E-1). A client with no
  // coach gets no message button (C-F6-1): there is no one to message.
  if (noWorkspace) {
    return (
      <Container>
        <View style={styles.center} testID="community-space-screen">
          <SpaceEmpty
            title="No community space yet"
            description="No community space is available."
            actionLabel={client?.coach_id ? 'Send your coach a message' : undefined}
            onAction={client?.coach_id ? messageCoach : undefined}
            testID="community-space-no-workspace"
          />
        </View>
      </Container>
    );
  }

  // A post-feed load failure renders a calm retryable error using
  // `posts.refetch()` instead of collapsing into the empty state.
  if (isPostsError) {
    return (
      <Container>
        <View style={styles.center} testID="community-space-posts-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            {postsFailure?.message}
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => posts.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-space-posts-retry"
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

  return (
    <Container>
      <View style={styles.heading}>
        <Text style={[typography.eyebrow, { color: semanticColors.textMuted }]}>Community</Text>
        <Text accessibilityRole="header" style={[typography.h1, { color: semanticColors.textPrimary }]}>{space === 'hall' ? 'Hall' : 'Cohort'}</Text>
        <Text style={[typography.bodySmall, { color: semanticColors.textMuted }]}>Community posts.</Text>
      </View>
      {isEmpty ? (
        <View style={styles.center} testID="community-space-screen">
          {voiceSection}
          <SpaceEmpty
            title={space === 'cohort' ? 'No cohort posts yet' : 'The Hall is quiet'}
            actionLabel="Be the first to post"
            onAction={compose}
            testID="community-space-empty"
          />
        </View>
      ) : (
        <FlatList
          testID="community-space-screen"
          data={data}
          keyExtractor={(p) => p.id}
          ListEmptyComponent={posts.isLoading ? <View style={styles.center} accessibilityState={{ busy: true }}>
            <ActivityIndicator color={semanticColors.accent} accessibilityLabel="Loading posts" />
          </View> : null}
          ListHeaderComponent={
            <>
              {voiceSection}
              <HapticPressable
                intent="light"
                onPress={compose}
                accessibilityRole="button"
                accessibilityLabel="Write a new post"
                testID="community-space-new-post"
                style={[styles.newPost, { backgroundColor: semanticColors.accent }]}
              >
                <Ionicons name="create-outline" size={18} color={semanticColors.textOnAccent} />
                <Text style={[styles.retryLabel, { color: semanticColors.textOnAccent }]}>
                  New post
                </Text>
              </HapticPressable>
            </>
          }
          renderItem={({ item }) => (
            <View style={[styles.postRow, { borderBottomColor: semanticColors.border }]}>
              <HapticPressable onPress={() => openThread(item)} disabled={isOptimisticId(item.id)}
                accessibilityRole="button" accessibilityLabel={`Open post ${item.title ?? 'Untitled post'}`}
                testID={`post-card-${item.id}`} style={styles.postContent}>
                {item.pinned ? <Ionicons name="pin-outline" size={16} color={semanticColors.textMuted} /> : null}
                <Text style={[typography.bodyMd, { color: semanticColors.textPrimary }]} numberOfLines={2}>{item.title ?? 'Untitled post'}</Text>
                {item.body ? <Text style={[typography.bodySmall, { color: semanticColors.textMuted }]} numberOfLines={3}>{item.body.slice(0, 140)}</Text> : null}
                <Text style={[typography.eyebrow, { color: semanticColors.textMuted }]}>{isOptimisticId(item.id) ? 'Sending…' : item.scope === 'hall' ? 'Hall' : 'Cohort'}</Text>
              </HapticPressable>
              {!isOptimisticId(item.id) ? (
                <SafetyMenu
                  targetType="post"
                  targetId={item.id}
                  authorUserId={item.author_user_id}
                  viewerUserId={client?.id}
                  viewerCoachId={client?.coach_id}
                  testID={`post-safety-${item.id}`}
                />
              ) : null}
            </View>
          )}
          contentContainerStyle={styles.list}
          style={{ backgroundColor: semanticColors.bgPrimary }}
        />
      )}
    </Container>
  );
}

function SpaceEmpty({ title, description, actionLabel, onAction, testID }: {
  title: string; description?: string; actionLabel?: string; onAction?: () => void; testID: string;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  return <View testID={testID} style={styles.empty}>
    <Text style={[typography.h2, { color: semanticColors.textPrimary }]}>{title}</Text>
    {description ? <Text style={[typography.bodySmall, { color: semanticColors.textMuted }]}>{description}</Text> : null}
    {actionLabel && onAction ? <HapticPressable onPress={onAction} accessibilityRole="button"
      accessibilityLabel={actionLabel} testID={`${testID}-action`}
      style={[styles.newPost, { backgroundColor: semanticColors.accent }]}>
      <Text style={[typography.bodyMd, { color: semanticColors.textOnAccent }]}>{actionLabel}</Text>
    </HapticPressable> : null}
  </View>;
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
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.md },
  postRow: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  postContent: { flex: 1, minHeight: 48, paddingVertical: spacing.lg, gap: spacing.sm },
  muted: { ...typography.bodySmall, textAlign: 'center' },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { ...typography.bodyMd },
  list: { paddingVertical: 8 },
  newPost: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
});
