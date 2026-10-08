/**
 * CommunityThreadScreen — single thread / post detail (product plan §3 row 3:
 * threads are first-class full-screen on mobile). Shows the post, a reaction
 * bar, the comment list, and an inline comment composer. Comments are
 * optimistic with rollback (UX gate §7).
 *
 * Quiet reading: a Back row, serif title, Inter post/replies and hairline
 * separators. Post and replies carry an author/time line: "You" and "Your
 * coach" come from ids, any other name only when the server sends one,
 * otherwise only the time. Reactions show the server's summary (the post's
 * own, else the one the last tap returned) and flip while a tap is in flight.
 * The author can delete their own post. Replies distinguish loading, failure
 * and true empty, pull to refresh, and the empty action focuses the composer.
 * Safety handlers and moderation behaviour stay intact.
 */
import React, { useRef, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import type { ComposerInputHandle } from '../../components/community/ComposerInput';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  usePostComments,
  useAddComment,
  useReactToPost,
  useDeletePost,
  useCommunityMe,
  isOptimisticId,
} from '../../hooks/useCommunity';
import {
  communityApi,
  type CommunityReactionEmoji,
  type CommunityReactionSummary,
} from '../../api/communityApi';
import { useQuery } from '@tanstack/react-query';
import { describeCommunityFailure } from '../../api/communityErrors';
import SafetyMenu from '../../components/community/SafetyMenu';
import { formatRelative } from '../../components/community/SearchResultRow';
import {
  ReactionBar,
  ComposerInput,
} from '../../components/community';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

const COMMENT_MAX = 2000; // mirror backend CreateCommentDto

/** "You" or "Your coach" from ids, else the server's first name, else null. */
export function authorLabel(
  authorUserId: string | null | undefined,
  authorName: string | null | undefined,
  viewerUserId: string | null | undefined,
  viewerCoachId: string | null | undefined,
): string | null {
  if (authorUserId && authorUserId === viewerUserId) return 'You';
  const name = authorName?.trim() || null;
  if (authorUserId && authorUserId === viewerCoachId) {
    return name ? `${name}, your coach` : 'Your coach';
  }
  return name;
}

/** "Sam · 2h", or only the time when the author is unknown. */
export function metaLine(label: string | null, when: string): string {
  const line = [label, when].filter(Boolean).join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The summary with an in-flight tap applied, so the chip flips at once. */
export function withPendingTap(
  reactions: CommunityReactionSummary[],
  pending: { emoji: CommunityReactionEmoji; active: boolean } | null,
): CommunityReactionSummary[] {
  if (!pending) return reactions;
  const on = !pending.active;
  const current = reactions.find((r) => r.emoji === pending.emoji);
  if (!current) {
    return on
      ? [...reactions, { emoji: pending.emoji, count: 1, reacted_by_me: true }]
      : reactions;
  }
  if (current.reacted_by_me === on) return reactions;
  return reactions.map((r) =>
    r.emoji === pending.emoji
      ? { ...r, reacted_by_me: on, count: Math.max(0, r.count + (on ? 1 : -1)) }
      : r,
  );
}

export default function CommunityThreadScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityThread'>>();
  const postId = route.params?.postId ?? '';
  const client = useCurrentUser();
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? '';

  const post = useQuery({
    queryKey: ['community', 'post', postId],
    queryFn: () => communityApi.getPost(postId),
    enabled: !!postId,
  });
  const comments = usePostComments(postId);
  const addComment = useAddComment(postId, client?.id ?? '');
  const react = useReactToPost(workspaceId);
  const deletePost = useDeletePost(workspaceId);
  const composerRef = useRef<ComposerInputHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  const data = comments.data ?? [];
  const isEmpty = !comments.isLoading && !comments.isError && data.length === 0;
  const p = post.data;
  const isOwnPost = !!p && !!client?.id && p.author_user_id === client.id;
  const pendingTap =
    react.isPending && react.variables?.postId === postId ? react.variables : null;
  const reactions = withPendingTap(p?.reactions ?? react.data?.reactions ?? [], pendingTap);
  const postMeta = p
    ? metaLine(
        authorLabel(p.author_user_id, p.author_name, client?.id, client?.coach_id),
        p.created_at ? formatRelative(p.created_at) : '',
      )
    : '';
  // A deep link can open the thread with nothing beneath it on the stack.
  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('CommunityTab');
  };
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([post.refetch(), comments.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-thread-screen"
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <HapticPressable
          intent="light"
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="community-thread-back"
        >
          <Ionicons name="chevron-back" size={22} color={semanticColors.accent} />
          <Text style={[styles.backLabel, { color: semanticColors.accent }]}>Back</Text>
        </HapticPressable>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text accessibilityRole="header" testID="community-thread-header"
              style={[styles.title, { color: semanticColors.textPrimary }]}>
              {p?.title ?? 'Post'}
            </Text>
            {postMeta ? (
              <Text testID="community-thread-post-meta"
                style={[styles.meta, styles.postMeta, { color: semanticColors.textMuted }]}>
                {postMeta}
              </Text>
            ) : null}
          </View>
          {p ? (
            <SafetyMenu
              targetType="post"
              targetId={p.id}
              authorUserId={p.author_user_id}
              authorName={p.author_name}
              viewerUserId={client?.id}
              viewerCoachId={client?.coach_id}
              onBlocked={() => navigation.goBack()}
              onDelete={isOwnPost ? async () => {
                await deletePost.mutateAsync(p.id);
                leave();
              } : undefined}
              contentNoun="post"
              testID="community-thread-post-safety"
            />
          ) : null}
        </View>

        {p?.body ? (
          <Text style={[styles.body, { color: semanticColors.textPrimary }]}>
            {p.body}
          </Text>
        ) : null}

        <ReactionBar
          reactions={reactions}
          onToggle={(emoji, active) =>
            react.mutate({ postId, emoji, active })
          }
          testID="community-thread-reactions"
        />

        <FlatList
          testID="community-thread-replies"
          data={data}
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              tintColor={semanticColors.textMuted} colors={[semanticColors.accent]} />
          }
          ListEmptyComponent={comments.isLoading || comments.isError ? (
            <View style={styles.center} accessibilityState={{ busy: comments.isLoading }}>
              <Text style={[typography.bodySmall, { color: semanticColors.textMuted }]}>
                {comments.isLoading ? 'Loading replies…' : 'Replies did not load. Check your connection, then try again.'}
              </Text>
              {comments.isError ? <HapticPressable onPress={() => void comments.refetch()}
                accessibilityRole="button" accessibilityLabel="Try again" testID="community-thread-retry" style={styles.replyAction}>
                <Text style={[typography.bodySmall, { color: semanticColors.accentText }]}>Try again</Text>
              </HapticPressable> : null}
            </View>
          ) : isEmpty ? (
            <View style={styles.center}>
              <Text testID="community-thread-empty" style={[typography.bodySmall, { color: semanticColors.textMuted }]}>No replies yet</Text>
              <HapticPressable onPress={() => composerRef.current?.focus()} style={styles.replyAction}
                accessibilityRole="button" accessibilityLabel="Be the first to reply" testID="community-thread-empty-action">
                <Text style={[typography.bodySmall, { color: semanticColors.accentText }]}>Be the first to reply</Text>
              </HapticPressable>
            </View>
          ) : null}
          renderItem={({ item }) => {
            const meta = metaLine(
              authorLabel(item.author_user_id, item.author_name, client?.id, client?.coach_id),
              isOptimisticId(item.id) ? 'Sending…' : formatRelative(item.created_at),
            );
            return (
              <View
                style={[styles.comment, { borderBottomColor: semanticColors.border }]}
                testID={`comment-${item.id}`}
              >
                <View style={styles.flex}>
                  {meta ? (
                    <Text testID={`comment-meta-${item.id}`}
                      style={[styles.meta, { color: semanticColors.textMuted }]}>
                      {meta}
                    </Text>
                  ) : null}
                  <Text style={[styles.commentBody, { color: semanticColors.textPrimary }]}>
                    {item.body}
                  </Text>
                </View>
                <SafetyMenu
                  targetType="comment"
                  targetId={item.id}
                  authorUserId={item.author_user_id}
                  authorName={item.author_name}
                  viewerUserId={client?.id}
                  viewerCoachId={client?.coach_id}
                  testID={`comment-safety-${item.id}`}
                />
              </View>
            );
          }}
          contentContainerStyle={styles.list}
          style={styles.flex}
        />

        <ComposerInput
          ref={composerRef}
          placeholder="Add a reply"
          maxLength={COMMENT_MAX}
          sending={addComment.isPending}
          onSubmit={(body) =>
            addComment.mutateAsync(body).then(
              () => undefined,
              (err: unknown) => {
                // Apple 1.2 content filter: keep the draft (the composer
                // restores it on rejection) and say why. Every other failure
                // gets specific copy or a support reference.
                const failure = describeCommunityFailure(err, 'send_reply');
                Alert.alert(failure.title, failure.message);
                throw err;
              },
            )
          }
          testID="community-thread-composer"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  back: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  backLabel: { ...typography.bodyMd },
  title: { ...typography.h1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  meta: { ...typography.bodySmall, fontVariant: ['tabular-nums'] },
  postMeta: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  replyAction: { minHeight: 44, justifyContent: 'center' },
  body: {
    ...typography.body,
    fontSize: 17,
    lineHeight: 27,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  list: { paddingVertical: spacing.sm, flexGrow: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: spacing.sm },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentBody: {
    ...typography.body,
  },
});
