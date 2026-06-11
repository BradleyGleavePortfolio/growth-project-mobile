/**
 * CoachCommunityPostDetailScreen — a single community post and its reply
 * thread (v1-6 fixer R1, gate G2). Consumes the existing backend reads
 * `GET /community/posts/:id` and `GET /community/posts/:id/comments` (Roles
 * include coach) via `useCoachPostDetail`. No new backend endpoint is invented.
 *
 * The screen shows the post title, body, author, and timestamp; a moderation
 * badge when the screen was opened from the moderation queue (the `flagged`
 * route param); and the reply thread beneath. It implements the three distinct
 * branches the rest of the lane uses (UX P0.2): a loading spinner, an honest
 * CoachErrorState on failure (never a calm/empty masquerade), and the post +
 * (possibly empty) reply thread on success.
 *
 * The post view carries no display name (only `author_user_id`), so the author
 * is rendered as a short, honest "Author <id-prefix>" label rather than a
 * fabricated name. Touch targets are >= 44pt; colours come from semanticColors.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, semantic } from '../../theme/tokens';
import { CoachErrorState, relativeAge } from '../../components/community/coach';
import { useCoachPostDetail } from '../../hooks/useCoachCommunity';
import type { CoachPostComment } from '../../api/coachCommunityApi';
import type { CoachCommunityRoute } from './coachCommunityNavTypes';

/** Short, honest author label — the post view has no display name. */
function authorLabel(userId: string): string {
  const prefix = userId.slice(0, 8);
  return `Author ${prefix}`;
}

export default function CoachCommunityPostDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CoachCommunityRoute<'CoachCommunityPostDetail'>>();
  const postId = route.params?.postId ?? '';
  const flagged = route.params?.flagged === true;

  const detail = useCoachPostDetail(postId);

  if (detail.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-post-detail-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-post-detail-loading"
        />
      </View>
    );
  }

  if (detail.isError || detail.data == null) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-post-detail-screen"
      >
        <CoachErrorState
          message="Could not load this post. Pull back and open it again."
          onRetry={() => detail.refetch()}
          retrying={detail.isRefetching}
          testID="coach-community-post-detail-error"
        />
      </View>
    );
  }

  const { post, comments } = detail.data;

  return (
    <ScrollView
      style={{ backgroundColor: semanticColors.bgPrimary }}
      contentContainerStyle={styles.content}
      testID="coach-community-post-detail-screen"
    >
      {flagged ? (
        <View
          style={[
            styles.flagBadge,
            { backgroundColor: semantic.danger.bg, borderColor: semantic.danger.border },
          ]}
          testID="coach-community-post-detail-flagged-badge"
        >
          <Text style={[styles.flagBadgeText, { color: semantic.danger.fg }]}>
            Flagged for review
          </Text>
        </View>
      ) : null}

      {post.title ? (
        <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
          {post.title}
        </Text>
      ) : null}

      <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
        {authorLabel(post.author_user_id)} · {relativeAge(post.created_at)}
      </Text>

      <Text style={[styles.body, { color: semanticColors.textPrimary }]}>
        {post.body ?? 'This post has no body.'}
      </Text>

      <View style={[styles.divider, { backgroundColor: semanticColors.border }]} />

      <Text style={[styles.threadHeading, { color: semanticColors.textPrimary }]}>
        {comments.length === 0
          ? 'No replies yet'
          : `${comments.length} ${comments.length === 1 ? 'reply' : 'replies'}`}
      </Text>

      {comments.map((c) => (
        <CommentRow
          key={c.id}
          comment={c}
          surface={semanticColors.bgSurface}
          border={semanticColors.border}
          nameColor={semanticColors.textPrimary}
          metaColor={semanticColors.textMuted}
        />
      ))}
    </ScrollView>
  );
}

function CommentRow({
  comment,
  surface,
  border,
  nameColor,
  metaColor,
}: {
  comment: CoachPostComment;
  surface: string;
  border: string;
  nameColor: string;
  metaColor: string;
}): React.ReactElement {
  return (
    <View
      style={[styles.comment, { backgroundColor: surface, borderColor: border }]}
      testID={`coach-community-post-comment-${comment.id}`}
    >
      <View style={styles.commentHeader}>
        <Text style={[styles.commentAuthor, { color: nameColor }]} numberOfLines={1}>
          {authorLabel(comment.author_user_id)}
        </Text>
        <Text style={[styles.commentAge, { color: metaColor }]}>
          {relativeAge(comment.created_at)}
        </Text>
      </View>
      <Text style={[styles.commentBody, { color: nameColor }]}>{comment.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing['3xl'],
  },
  flagBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.xs,
  },
  flagBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  threadHeading: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  comment: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  commentAge: {
    fontSize: 12,
  },
  commentBody: {
    fontSize: 15,
    lineHeight: 21,
  },
});
