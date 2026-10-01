/**
 * CommunityThreadScreen — single thread / post detail (product plan §3 row 3:
 * threads are first-class full-screen on mobile). Shows the post, a reaction
 * bar, the comment list, and an inline comment composer. Reactions and comments
 * are optimistic with rollback (UX gate §7).
 *
 * Empty comments → Roman-voiced empty state with a primary action. Standardized
 * on semanticColors / tokens.ts.
 */
import React from 'react';
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
import { spacing } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  usePostComments,
  useAddComment,
  useReactToPost,
  useCommunityMe,
} from '../../hooks/useCommunity';
import { communityApi } from '../../api/communityApi';
import { useQuery } from '@tanstack/react-query';
import { contentRejectedMessage } from '../../api/communitySafetyApi';
import SafetyMenu from '../../components/community/SafetyMenu';
import {
  CommunityEmptyState,
  ThreadHeader,
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

  const data = comments.data ?? [];
  const isEmpty = !comments.isLoading && (comments.isError || data.length === 0);

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
            <ThreadHeader
              title={post.data?.title ?? 'Post'}
              testID="community-thread-header"
            />
          </View>
          {post.data ? (
            <SafetyMenu
              targetType="post"
              targetId={post.data.id}
              authorUserId={post.data.author_user_id}
              viewerUserId={client?.id}
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

        {isEmpty ? (
          <View style={styles.center}>
            <CommunityEmptyState
              stem="threadEmpty"
              firstName={client?.firstName ?? client?.name ?? null}
              title="No replies yet"
              actionLabel="Be the first to reply"
              onAction={() => {
                /* focus handled by the composer below; the CTA simply scrolls
                   intent here — the inline composer is always present */
              }}
              testID="community-thread-empty"
            />
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
                  testID={`comment-safety-${item.id}`}
                />
              </View>
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

        <ComposerInput
          placeholder="Add a reply"
          maxLength={COMMENT_MAX}
          sending={addComment.isPending}
          onSubmit={(body) =>
            addComment.mutateAsync(body).then(
              () => undefined,
              (err: unknown) => {
                // Apple 1.2 content filter: keep the draft (the composer
                // restores it on rejection) and say why.
                const rejected = contentRejectedMessage(err);
                Alert.alert(
                  rejected ? 'Please rephrase' : 'Reply not sent',
                  rejected ?? 'Could not send your reply. Please try again.',
                );
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
  center: { flex: 1, justifyContent: 'center' },
  body: {
    fontSize: 15,
    lineHeight: 22,
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
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
});
