import React, { useState, useCallback } from 'react';
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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import {
  useLeaderboard,
  useCommunityFeed,
  usePostWin,
  ApiCommunityWin,
  ApiLeaderboardEntry,
} from '../../hooks/useApi';
import { SkeletonCard } from '../../components/SkeletonLoader';

/**
 * CommunityScreen — API-first.
 *
 * Source-of-truth migration (Fix #2):
 *   Wins        → real CommunityWin rows on the backend (Fix #9). When a
 *                 client posts a win it's persisted server-side, scoped to
 *                 the coach roster, and visible to teammates and the coach.
 *   Leaderboard → real workout-volume groupBy on the backend (community.
 *                 service.getLeaderboard). Same scope rules.
 *   Challenges  → no backend module exists yet; tab renders as Coming Soon.
 *                 Previously this tab was driven by a SQLite-only
 *                 `seedCommunityIfNeeded` (theatrical seed of two fake
 *                 challenges with hard-coded participants). That seed has
 *                 been removed entirely; we will not show a feature that
 *                 only exists per-device.
 *
 * Cache:
 *   The two real queries (feed + leaderboard) are persisted via the
 *   PersistQueryClientProvider so cold starts paint last-known data while
 *   the network call refreshes in the background.
 */

type TabKey = 'wins' | 'leaderboard' | 'challenges';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'wins', label: 'Wins', icon: 'star' },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'podium' },
  { key: 'challenges', label: 'Challenges', icon: 'trophy' },
];

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
  const currentUser = useCurrentUser();
  const [activeTab, setActiveTab] = useState<TabKey>('wins');
  const [postWinOpen, setPostWinOpen] = useState(false);
  const [winTitle, setWinTitle] = useState('');
  const [winDesc, setWinDesc] = useState('');

  const wins = useCommunityFeed();
  const leaderboard = useLeaderboard('week');
  const postWin = usePostWin();

  const onRefresh = useCallback(async () => {
    await Promise.all([wins.refetch(), leaderboard.refetch()]);
  }, [wins, leaderboard]);

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
          <Text style={styles.subtitle}>Wins, rankings, your team</Text>
        </View>
        <TouchableOpacity
          style={styles.shareWinBtn}
          onPress={() => setPostWinOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Share a win"
        >
          <Ionicons name="add" size={18} color={Colors.textOnPrimary} />
          <Text style={styles.shareWinText}>Share a win</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={active ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* WINS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'wins' && (
        <FlatList
          data={wins.data || []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={wins.isFetching && !wins.isLoading}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
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
                  <Ionicons name="star" size={22} color={Colors.warning} />
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
      )}

      {/* LEADERBOARD TAB ──────────────────────────────────────────────── */}
      {activeTab === 'leaderboard' && (
        <FlatList
          data={leaderboard.data || []}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={leaderboard.isFetching && !leaderboard.isLoading}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.featuredBanner}>
              <Ionicons name="sparkles" size={14} color={Colors.primary} />
              <Text style={styles.featuredBannerText}>This week — workouts logged</Text>
            </View>
          }
          ListEmptyComponent={
            leaderboard.isLoading ? (
              <View>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : leaderboard.isError ? (
              <ErrorState
                icon="cloud-offline-outline"
                title="Couldn't load leaderboard"
                text="Pull down to try again."
              />
            ) : (
              <EmptyState
                icon="podium-outline"
                title="No rankings yet"
                text="Log a workout this week to land on the board."
              />
            )
          }
          renderItem={({ item, index }: { item: ApiLeaderboardEntry; index: number }) => {
            const rank = index + 1;
            const isMe = item.user_id === currentUser?.id;
            const initials = item.name
              ? item.name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()
              : '?';
            const medalColor =
              rank === 1
                ? Colors.medalGold
                : rank === 2
                ? Colors.medalSilver
                : rank === 3
                ? Colors.medalBronze
                : Colors.textMuted;
            return (
              <View style={[styles.leaderRow, isMe && styles.leaderRowMe]}>
                <View style={styles.rankContainer}>
                  {rank <= 3 ? (
                    <Ionicons name="medal" size={24} color={medalColor} />
                  ) : (
                    <Text style={styles.rankText}>{rank}</Text>
                  )}
                </View>
                <View style={styles.leaderAvatar}>
                  <Text style={styles.leaderAvatarText}>{initials}</Text>
                </View>
                <View style={styles.leaderInfo}>
                  <Text style={[styles.leaderName, isMe && styles.leaderNameMe]}>
                    {item.name}
                    {isMe ? ' (You)' : ''}
                  </Text>
                </View>
                <View style={styles.leaderPoints}>
                  <Ionicons name="barbell-outline" size={14} color={Colors.primary} />
                  <Text style={styles.leaderPointsText}>{item.workouts_completed}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* CHALLENGES TAB — coming-soon placeholder ────────────────────── */}
      {activeTab === 'challenges' && (
        <ScrollView contentContainerStyle={styles.comingSoonContainer}>
          <View style={styles.comingSoonCard}>
            <Ionicons name="trophy-outline" size={36} color={Colors.primary} />
            <Text style={styles.comingSoonEyebrow}>Coming soon</Text>
            <Text style={styles.comingSoonTitle}>Team challenges</Text>
            <Text style={styles.comingSoonBody}>
              Coach-launched group challenges with shared progress and a real leaderboard are
              being built. We removed the old version because the challenges only existed on
              your device — we'd rather wait and ship it right.
            </Text>
          </View>
        </ScrollView>
      )}

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
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Your coach and your teammates will see this.
            </Text>
            <TextInput
              placeholder="Title — e.g. Hit a PR on squats"
              placeholderTextColor={Colors.textMuted}
              value={winTitle}
              onChangeText={setWinTitle}
              maxLength={80}
              style={styles.modalInput}
            />
            <TextInput
              placeholder="A few words about what happened"
              placeholderTextColor={Colors.textMuted}
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
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name={icon as any} size={48} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ErrorState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name={icon as any} size={48} color={Colors.error} />
      <Text style={[styles.emptyTitle, { color: Colors.error }]}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: 8,
  },
  shareWinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareWinText: {
    fontFamily: 'Inter_500Medium',
    color: Colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  tabBar: { flexDirection: 'row', marginHorizontal: 24, marginBottom: 12, gap: 8 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 2, // radius.md
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primaryPale, borderColor: Colors.primary },
  tabText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: Colors.textMuted,
  },
  tabTextActive: { color: Colors.primary },

  listContent: { paddingHorizontal: 24, paddingBottom: 100 },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 22,
  },

  featuredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  featuredBannerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: Colors.primary,
  },

  // Leaderboard
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  leaderRowMe: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  rankContainer: { width: 30, alignItems: 'center' },
  rankText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  leaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderAvatarText: {
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  leaderInfo: { flex: 1 },
  leaderName: { fontFamily: 'Inter_500Medium', fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
  leaderNameMe: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: Colors.primary },
  leaderPoints: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaderPointsText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: Colors.textPrimary,
  },

  // Wins
  winCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.primary,
  },
  winTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  winDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  winTime: { fontFamily: 'Inter_400Regular', fontSize: 11, color: Colors.textMuted },

  // Coming soon for challenges
  comingSoonContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  comingSoonCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  comingSoonEyebrow: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.98,
    marginTop: 4,
  },
  comingSoonTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: Colors.textPrimary,
  },
  comingSoonBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,26,24,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
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
    color: Colors.textPrimary,
  },
  modalSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textSecondary, marginTop: -4 },
  modalInput: {
    backgroundColor: Colors.background,
    borderRadius: 2, // radius.md
    padding: 14,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalInputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  modalSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  modalSubmitDisabled: { opacity: 0.6 },
  modalSubmitText: {
    fontFamily: 'Inter_500Medium',
    color: Colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
