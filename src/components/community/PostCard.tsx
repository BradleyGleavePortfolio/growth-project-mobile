/**
 * PostCard — a single Lab/Hall or cohort post in a feed (product plan §2.3:
 * The Lab is a POST, not a chat). Shows the post title, a body preview, a
 * pinned indicator, and routes to the thread on tap. A >= 48dp touch target.
 *
 * Optimistic posts (temp ids) render with a subtle "sending" treatment until
 * the server reconciles. Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { isOptimisticId } from '../../hooks/useCommunity';
import type { CommunityPost } from '../../api/communityApi';

export interface PostCardProps {
  post: CommunityPost;
  onPress: (post: CommunityPost) => void;
  testID?: string;
}

export default function PostCard({
  post,
  onPress,
  testID,
}: PostCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const sending = isOptimisticId(post.id);
  const title = post.title ?? 'Untitled post';
  const preview = (post.body ?? '').slice(0, 140);

  return (
    <HapticPressable
      intent="light"
      onPress={() => onPress(post)}
      accessibilityRole="button"
      accessibilityLabel={`Open post ${title}`}
      testID={testID}
      disabled={sending}
      style={[
        styles.card,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
          opacity: sending ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        {post.pinned ? (
          <Ionicons
            name="pin"
            size={14}
            color={semanticColors.accent}
            style={styles.pin}
          />
        ) : null}
        <Text
          style={[styles.title, { color: semanticColors.textPrimary }]}
          numberOfLines={2}
        >
          {title}
        </Text>
      </View>
      {preview ? (
        <Text
          style={[styles.preview, { color: semanticColors.textMuted }]}
          numberOfLines={3}
        >
          {preview}
        </Text>
      ) : null}
      <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
        {sending ? 'Sending…' : post.scope === 'hall' ? 'Hall' : 'Cohort'}
      </Text>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pin: {
    marginRight: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  preview: {
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
