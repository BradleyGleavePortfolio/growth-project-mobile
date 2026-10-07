/**
 * CommunityThreadScreen — single thread / post detail (product plan §3 row 3:
 * threads are first-class full-screen on mobile). Shows the post, a reaction
 * bar, the comment list, and an inline comment composer. Reactions and comments
 * are optimistic with rollback (UX gate §7).
 *
 * Quiet reading: serif title, Inter post/replies and hairline separators.
 * Replies distinguish loading, failure and true empty; the empty action focuses
 * the existing composer. Safety handlers and moderation behaviour stay intact.
 */
import React, { useRef } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import type { ComposerInputHandle } from '../../components/community/ComposerInput';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  usePostComments,
  useAddComment,
  useReactToPost,
  useCommunityMe,
} from '../../hooks/useCommunity';
import { communityApi } from '../../api/communityApi';
import { useQuery } from '@tanstack/react-query';
import { describeCommunityFailure } from '../../api/communityErrors';
import SafetyMenu from '../../components/community/SafetyMenu';
import {
  ReactionBar,
  ComposerInput,
} from '../../components/community';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

const COMMENT_MAX = 2000; // mirror backend CreateCommentDto

export default function CommunityThreadScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityThread'>>();
  const postId = route.params?.postId ?? '';
  const client = useCurrentUser();
  const me = useCommunityMe();

  const post = useQuery({
    queryKey: ['community', 'post', postId],
    queryFn: () => communityApi.getPost(postId),
    enabled: !!postId,
  });
  const comments = usePostComments(postId);
  const addComment = useAddComment(postId, client?.id ?? '');
  const react = useReactToPost(me.data?.workspace_id ?? '');
  const composerRef = useRef<ComposerInputHandle>(null);

  const data = comments.data ?? [];
  const isEmpty = !comments.isLoading && !comments.isError && data.length === 0;

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
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text accessibilityRole="header" testID="community-thread-header"
              style={[styles.title, { color: semanticColors.textPrimary }]}>
              {post.data?.title ?? 'Post'}
            </Text>
          </View>
          {post.data ? (
            <SafetyMenu
              targetType="post"
              targetId={post.data.id}
              authorUserId={post.data.author_user_id}
              viewerUserId={client?.id}
              viewerCoachId={client?.coach_id}
              onBlocked={() => navigation.goBack()}
              testID="community-thread-post-safety"
            />
          ) : null}
        </View>

        {post.data?.body ? (
          <Text style={[styles.body, { color: semanticColors.textPrimary }]}>
            {post.data.body}
          </Text>
        ) : null}

        <ReactionBar
          onToggle={(emoji, active) =>
            react.mutate({ postId, emoji, active })
          }
          testID="community-thread-reactions"
        />

        {comments.isLoading || comments.isError ? (
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
        ) : (
          <FlatList
            data={data}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <View
                style={[styles.comment, { borderBottomColor: semanticColors.border }]}
                testID={`comment-${item.id}`}
              >
                <Text style={[styles.commentBody, { color: semanticColors.textPrimary }]}>
                  {item.body}
                </Text>
                <SafetyMenu
                  targetType="comment"
                  targetId={item.id}
                  authorUserId={item.author_user_id}
                  viewerUserId={client?.id}
                  viewerCoachId={client?.coach_id}
                  testID={`comment-safety-${item.id}`}
                />
              </View>
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

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
  title: { ...typography.h1, padding: spacing.lg },
  replyAction: { minHeight: 44, justifyContent: 'center' },
  body: {
    ...typography.body,
    fontSize: 17,
    lineHeight: 27,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  list: { paddingVertical: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.sm },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentBody: {
    ...typography.body,
    flex: 1,
  },
});
