/**
 * CommunityFeedScreen — Contribution Loops (UX Psych #5)
 *
 * Full-screen community feed with:
 * - "Share a win" composer at the top (textarea, visibility toggle Circle/Public)
 * - FlatList of CommunityWinCards with live reaction counts
 *
 * Analytics events fired:
 *   community_feed_opened     — on mount
 *   community_win_posted      — after successful win post
 *   community_win_reacted     — after successful reaction (props: kind)
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { track } from '../../lib/analytics';
import {
  useCommunityFeed,
  usePostWin,
  useReactToWin,
  ApiCommunityWin,
} from '../../hooks/useApi';
import CommunityWinCard from '../../components/community/CommunityWinCard';
import { SkeletonCard } from '../../components/SkeletonLoader';
import { Colors } from '../../constants/colors';
import HapticPressable from '../../components/HapticPressable';

type Visibility = 'circle' | 'public';

export default function CommunityFeedScreen() {
  const feed = useCommunityFeed();
  const postWin = usePostWin();
  const reactToWin = useReactToWin();

  const [winText, setWinText] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('circle');

  // Analytics: feed opened
  useEffect(() => {
    track('community_feed_opened');
  }, []);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    await feed.refetch();
  }, [feed]);

  // Post a win
  const handlePost = useCallback(async () => {
    const text = winText.trim();
    if (!text) {
      Alert.alert('Add a note', 'Tell the community what you accomplished.');
      return;
    }
    try {
      await postWin.mutateAsync({ title: text, description: text, visibility });
      track('community_win_posted');
      setWinText('');
    } catch (err: any) {
      Alert.alert('Could not post', err?.response?.data?.message ?? 'Please try again.');
    }
  }, [winText, visibility, postWin]);

  // React to a win
  const handleReact = useCallback(
    (winId: string, kind: 'fire' | 'clap') => {
      reactToWin.mutate(
        { winId, kind },
        {
          onSuccess: () => track('community_win_reacted', { kind }),
          onError: () => {
            // Silently swallow — optimistic update already shown in card
          },
        },
      );
    },
    [reactToWin],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList<ApiCommunityWin>
        data={feed.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={feed.isFetching && !feed.isLoading}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Inner Circle Wins</Text>
              <Text style={styles.subtitle}>Cheer on your teammates</Text>
            </View>

            {/* Composer */}
            <View style={styles.composer}>
              <TextInput
                placeholder="What did you accomplish today?"
                placeholderTextColor={Colors.textMuted}
                value={winText}
                onChangeText={setWinText}
                multiline
                maxLength={280}
                style={styles.composerInput}
              />

              {/* Visibility toggle */}
              <View style={styles.visibilityRow}>
                <TouchableOpacity
                  style={[
                    styles.visibilityBtn,
                    visibility === 'circle' && styles.visibilityBtnActive,
                  ]}
                  onPress={() => setVisibility('circle')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === 'circle' }}
                >
                  <Ionicons
                    name="people"
                    size={14}
                    color={visibility === 'circle' ? Colors.primary : Colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.visibilityLabel,
                      visibility === 'circle' && styles.visibilityLabelActive,
                    ]}
                  >
                    Circle only
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.visibilityBtn,
                    visibility === 'public' && styles.visibilityBtnActive,
                  ]}
                  onPress={() => setVisibility('public')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === 'public' }}
                >
                  <Ionicons
                    name="globe"
                    size={14}
                    color={visibility === 'public' ? Colors.primary : Colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.visibilityLabel,
                      visibility === 'public' && styles.visibilityLabelActive,
                    ]}
                  >
                    Public
                  </Text>
                </TouchableOpacity>

                <HapticPressable
                  style={[
                    styles.postBtn,
                    (postWin.isPending || !winText.trim()) && styles.postBtnDisabled,
                  ]}
                  onPress={handlePost}
                  disabled={postWin.isPending || !winText.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Post win"
                >
                  <Text style={styles.postBtnText}>
                    {postWin.isPending ? 'Posting…' : 'Post'}
                  </Text>
                </HapticPressable>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Recent wins</Text>
          </>
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <View>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : feed.isError ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-offline-outline" size={40} color={Colors.error} />
              <Text style={styles.emptyTitle}>Couldn't load wins</Text>
              <Text style={styles.emptyBody}>Pull down to try again.</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="star-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No wins yet</Text>
              <Text style={styles.emptyBody}>Nothing yet. Write the first entry.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <CommunityWinCard
            win={item}
            onReact={handleReact}
            isPending={reactToWin.isPending}
          />
        )}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
    paddingTop: 60,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },

  // Composer
  composer: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  composerInput: {
    fontSize: 15,
    color: Colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
    lineHeight: 21,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  visibilityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  visibilityBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryPale,
  },
  visibilityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  visibilityLabelActive: {
    color: Colors.primary,
  },
  postBtn: {
    marginLeft: 'auto',
    backgroundColor: Colors.primary,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  postBtnDisabled: {
    opacity: 0.5,
  },
  postBtnText: {
    color: Colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '500',
  },

  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  // Empty / error
  emptyContainer: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  emptyBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
});
