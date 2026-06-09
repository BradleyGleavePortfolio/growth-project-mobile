/**
 * CommunitySpaceScreen — a Space view (product plan §2.1). Renders the post
 * feed for either the Hall (workspace-wide announcements + cohort posts) or a
 * Cohort. The Lab/Hall is a POST feed, not a chat (§2.3).
 *
 * Empty state uses Roman voice + a primary action ("Be the first to post").
 * Tapping a post opens its thread. Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { usePosts } from '../../hooks/useCommunity';
import { CommunityEmptyState, PostCard } from '../../components/community';
import type { CommunityPost } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  embedded?: boolean;
  /** 'hall' | 'cohort' — which Space type this view renders. */
  space?: 'hall' | 'cohort';
  /** Workspace id (Hall). Posts are workspace-scoped on the backend. */
  workspaceId?: string | null;
}

export default function CommunitySpaceScreen({
  embedded,
  space = 'hall',
  workspaceId,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const posts = usePosts(workspaceId);

  const openThread = (post: CommunityPost) =>
    navigation.navigate('CommunityThread', { postId: post.id });

  const compose = () => navigation.navigate('CommunityComposer', { mode: 'post' });

  const data = posts.data ?? [];
  const isEmpty = !posts.isLoading && (posts.isError || data.length === 0);

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
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingVertical: 8 },
});
