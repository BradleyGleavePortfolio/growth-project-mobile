/**
 * CommunitySpaceScreen — a Space view (product plan §2.1). Renders the post
 * feed for either the Hall (workspace-wide announcements + cohort posts) or a
 * Cohort. The Lab/Hall is a POST feed, not a chat (§2.3).
 *
 * Empty state uses Roman voice + a primary action ("Be the first to post").
 * Tapping a post opens its thread. Standardized on semanticColors / tokens.ts.
 *
 * The workspace prerequisite (useCommunityMe) is resolved BEFORE any post empty
 * state so a still-loading or failed prerequisite is never shown as "the Hall
 * is quiet". When the Community tab embeds this surface it threads the real
 * `/community/me` truth (loading / error / retry) through props so a load error
 * renders the SAME calm retryable error the route renders instead of collapsing
 * a null workspace id into an inert empty state.
 */
import React from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { usePosts } from '../../hooks/useCommunity';
import { CommunityEmptyState, PostCard } from '../../components/community';
import HapticPressable from '../../components/HapticPressable';
import type { CommunityPost } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';

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
  workspaceId,
  prerequisiteLoading: prerequisiteLoadingProp,
  prerequisiteError: prerequisiteErrorProp,
  onRetryPrerequisite,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const posts = usePosts(workspaceId);

  // The workspace prerequisite must SUCCEED before we can decide "no posts".
  // The parent threads the real `me.isLoading`/`me.isError` truth so a
  // `/community/me` error renders the calm retryable error here instead of an
  // inert empty feed (the null-id fallback covers a parent that has not yet
  // wired the props). A genuine workspace_id=null SUCCESS (no membership) is
  // distinguished from failure: it falls through to the calm empty/onboarding
  // state, never the error state. Uses `isLoading` (not `isFetching`) so a
  // background refetch with existing data does not flash the loading branch.
  const prerequisiteLoading = prerequisiteLoadingProp ?? workspaceId === null;
  const prerequisiteError = prerequisiteErrorProp ?? false;
  const retryPrerequisite = onRetryPrerequisite ?? (() => {});

  const openThread = (post: CommunityPost) =>
    navigation.navigate('CommunityThread', { postId: post.id });

  const compose = () => navigation.navigate('CommunityComposer', { mode: 'post' });

  const data = posts.data ?? [];
  // A post-feed LOAD FAILURE must render a calm retryable error, never the
  // "the Hall is quiet" / "no cohort posts" empty state — collapsing a failed
  // `usePosts` into an empty feed silently hides the failure (R65 #36/#44).
  // True-empty is only a successful query that returned zero posts.
  const isPostsError = !posts.isLoading && posts.isError;
  const isEmpty = !posts.isLoading && !posts.isError && data.length === 0;

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
            We could not load this space. Please try again.
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
            We could not load these posts. Please try again.
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
      {isEmpty ? (
        <View style={styles.center} testID="community-space-screen">
          <CommunityEmptyState
            stem={space === 'cohort' ? 'cohortEmpty' : 'hallEmpty'}
            firstName={client?.firstName ?? client?.name ?? null}
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
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={openThread}
              testID={`post-card-${item.id}`}
            />
          )}
          contentContainerStyle={styles.list}
          style={{ backgroundColor: semanticColors.bgPrimary }}
        />
      )}
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
  list: { paddingVertical: 8 },
});
