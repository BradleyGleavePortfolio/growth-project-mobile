import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import {
  useCommunityFeed,
  usePostWin,
  ApiCommunityWin,
} from '../../hooks/useApi';
import { SkeletonCard } from '../../components/SkeletonLoader';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

/**
 * CommunityScreen — API-first.
 *
 * Source-of-truth migration (Fix #2):
 *   Wins → real CommunityWin rows on the backend (Fix #9). When a client posts
 *   a win it's persisted server-side, scoped to the coach roster, and visible
 *   to teammates and the coach.
 *
 * Wave 5b: the Challenges tab is gone. There is no backend module behind it,
 * and the quiet-luxury doctrine forbids "Coming Soon" placeholder UI.
 *
 * Doctrine excise: the rankings tab has been removed. Ranked competition is
 * not part of the quiet-luxury voice; the Wins feed is the only social surface.
 *
 * Cache:
 *   The feed query is persisted via the PersistQueryClientProvider so cold
 *   starts paint last-known data while the network call refreshes in the
 *   background.
 */

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export default function CommunityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [postWinOpen, setPostWinOpen] = useState(false);
  const [winTitle, setWinTitle] = useState('');
  const [winDesc, setWinDesc] = useState('');

  const wins = useCommunityFeed();
  const postWin = usePostWin();

  const onRefresh = useCallback(async () => {
    await wins.refetch();
  }, [wins]);

  const handleSubmitWin = useCallback(async () => {
    const title = winTitle.trim();
    const description = winDesc.trim();
    if (!title || !description) {
      Alert.alert('Almost there', 'Add a title and a quick description before posting.');
      return;
    }
    try {
      await postWin.mutateAsync({ title, description });
      setWinTitle('');
      setWinDesc('');
      setPostWinOpen(false);
    } catch (err: any) {
      Alert.alert('Could not post', err?.response?.data?.message || 'Please try again in a moment.');
    }
  }, [winTitle, winDesc, postWin]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Community</Text>
          <Text style={styles.subtitle}>Wins from your team</Text>
        </View>
        <TouchableOpacity
          style={styles.shareWinBtn}
          onPress={() => setPostWinOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Share a win"
        >
          <Ionicons name="add" size={18} color={colors.textOnPrimary} />
          <Text style={styles.shareWinText}>Share a win</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={wins.data || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={wins.isFetching && !wins.isLoading}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          wins.isLoading ? (
            <View>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : wins.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title="Couldn't load wins"
              text="Pull down to try again."
            />
          ) : (
            <EmptyState
              icon="star-outline"
              title="No wins yet"
              text="Be the first — tap Share a win at the top."
            />
          )
        }
        renderItem={({ item }: { item: ApiCommunityWin }) => {
          const isMe = item.user_id === currentUser?.id;
          const authorName = item.user?.name || (isMe ? 'You' : 'Teammate');
          return (
            <View style={styles.winCard}>
              <View style={styles.winIcon}>
                <Ionicons name="star" size={22} color={colors.warning} />
              </View>
              <View style={styles.winInfo}>
                <Text style={styles.winUserName}>
                  {authorName}
                  {isMe ? ' (You)' : ''}
                </Text>
                <Text style={styles.winTitle}>{item.title}</Text>
                <Text style={styles.winDesc}>{item.description}</Text>
              </View>
              <Text style={styles.winTime}>{formatTimeAgo(item.created_at)}</Text>
            </View>
          );
        }}
      />

      {/* POST-A-WIN MODAL ─────────────────────────────────────────────── */}
      <Modal
        visible={postWinOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPostWinOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share a win</Text>
              <TouchableOpacity onPress={() => setPostWinOpen(false)} accessibilityRole="button">
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Your coach and your teammates will see this.
            </Text>
            <TextInput
              placeholder="Title — e.g. Hit a PR on squats"
              placeholderTextColor={colors.textMuted}
              value={winTitle}
              onChangeText={setWinTitle}
              maxLength={80}
              style={styles.modalInput}
            />
            <TextInput
              placeholder="A few words about what happened"
              placeholderTextColor={colors.textMuted}
              value={winDesc}
              onChangeText={setWinDesc}
              multiline
              maxLength={500}
              style={[styles.modalInput, styles.modalInputMultiline]}
            />
            <TouchableOpacity
              style={[styles.modalSubmit, postWin.isPending && styles.modalSubmitDisabled]}
              disabled={postWin.isPending}
              onPress={handleSubmitWin}
              accessibilityRole="button"
            >
              <Text style={styles.modalSubmitText}>
                {postWin.isPending ? 'Posting…' : 'Post win'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Small subcomponents kept local for cohesion ─────────────────────────

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name={icon as any} size={48} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ErrorState({ icon, title, text }: { icon: string; title: string; text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name={icon as any} size={48} color={colors.error} />
      <Text style={[styles.emptyTitle, { color: colors.error }]}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 12,
  },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: 8,
  },
  shareWinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareWinText: {
    fontFamily: 'Inter_500Medium',
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  listContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 100 },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 22,
  },

  // Wins
  winCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  winIcon: {
    width: 44,
    height: 44,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(233, 196, 106, 0.15)',
  },
  winInfo: { flex: 1, gap: 2 },
  winUserName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  winTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  winDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  winTime: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,26,24,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  modalSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, marginTop: -4 },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: 2, // radius.md
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalInputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  modalSubmit: {
    backgroundColor: colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  modalSubmitDisabled: { opacity: 0.6 },
  modalSubmitText: {
    fontFamily: 'Inter_500Medium',
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  });
