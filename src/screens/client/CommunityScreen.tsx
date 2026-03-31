import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import {
  Challenge,
  ChallengeParticipant,
  WinEntry,
  LeaderboardEntry,
  getChallenges,
  getUserChallenges,
  joinChallenge,
  getWinsFeed,
  getLeaderboard,
  getUserPoints,
  seedCommunityIfNeeded,
} from '../../db/communityDb';

type TabKey = 'challenges' | 'leaderboard' | 'wins';

const WIN_ICONS: Record<string, string> = {
  streak: 'flame',
  challenge: 'trophy',
  weight: 'scale',
  workout: 'barbell',
  habit: 'checkmark-circle',
  lesson: 'book',
};

const WIN_COLORS: Record<string, string> = {
  streak: '#E76F51',
  challenge: '#E9C46A',
  weight: '#2D6A4F',
  workout: '#457B9D',
  habit: '#52B788',
  lesson: '#A78BFA',
};

const CHALLENGE_ICONS: Record<string, string> = {
  nutrition: 'nutrition',
  fitness: 'fitness',
};

export default function CommunityScreen() {
  const currentUser = useCurrentUser();
  const [activeTab, setActiveTab] = useState<TabKey>('challenges');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<(ChallengeParticipant & { challenge: Challenge })[]>([]);
  const [wins, setWins] = useState<WinEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myPoints, setMyPoints] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    await seedCommunityIfNeeded();
    const [allChallenges, userChallenges, winsFeed, board, pts] = await Promise.all([
      getChallenges(),
      getUserChallenges(currentUser.id),
      getWinsFeed(),
      getLeaderboard(),
      getUserPoints(currentUser.id),
    ]);
    setChallenges(allChallenges);
    setMyChallenges(userChallenges);
    setWins(winsFeed);
    setLeaderboard(board);
    setMyPoints(pts);
  }, [currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleJoinChallenge = async (challengeId: string) => {
    if (!currentUser) return;
    try {
      await joinChallenge(currentUser.id, challengeId);
      await loadData();
      Alert.alert('Joined!', 'You\'ve joined the challenge. Good luck!');
    } catch {
      Alert.alert('Already Joined', 'You\'re already in this challenge.');
    }
  };

  const joinedIds = new Set(myChallenges.map((mc) => mc.challengeId));

  const formatTimeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  };

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'challenges', label: 'Challenges', icon: 'trophy' },
    { key: 'leaderboard', label: 'Leaderboard', icon: 'podium' },
    { key: 'wins', label: 'Wins', icon: 'star' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Community</Text>
          <Text style={styles.subtitle}>Compete, connect, celebrate</Text>
        </View>
        <View style={styles.pointsBadge}>
          <Ionicons name="star" size={16} color="#E9C46A" />
          <Text style={styles.pointsText}>{myPoints}</Text>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={16}
              color={activeTab === tab.key ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ──────────── CHALLENGES TAB ──────────── */}
      {activeTab === 'challenges' && (
        <FlatList
          data={challenges}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
          }
          ListHeaderComponent={
            <>
            {myChallenges.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>My Active Challenges</Text>
                {myChallenges.map((mc) => (
                  <View key={mc.id} style={styles.myChallengeCard}>
                    <View style={styles.myChallengeInfo}>
                      <Text style={styles.myChallengeName}>{mc.challenge.title}</Text>
                      <View style={styles.myChallengeProgress}>
                        <View style={styles.progressBarBg}>
                          <View
                            style={[
                              styles.progressBarFill,
                              { width: `${Math.min(100, (mc.currentValue / mc.challenge.targetValue) * 100)}%` },
                            ]}
                          />
                        </View>
                        <Text style={styles.myChallengeCount}>
                          {mc.currentValue}/{mc.challenge.targetValue} {mc.challenge.unit}
                        </Text>
                      </View>
                    </View>
                    {mc.completed && (
                      <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
                    )}
                  </View>
                ))}
              </View>
            )}
            <View style={styles.featuredBanner}>
              <Ionicons name="sparkles" size={14} color={Colors.primary} />
              <Text style={styles.featuredBannerText}>Featured Challenges</Text>
            </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="trophy-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Active Challenges</Text>
              <Text style={styles.emptyText}>Check back soon for new challenges!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const joined = joinedIds.has(item.id);
            const catIcon = CHALLENGE_ICONS[item.category] || 'flag';
            return (
              <View style={styles.challengeCard}>
                <View style={styles.challengeIconContainer}>
                  <Ionicons name={catIcon as any} size={24} color={Colors.primary} />
                </View>
                <View style={styles.challengeInfo}>
                  <Text style={styles.challengeTitle}>{item.title}</Text>
                  <Text style={styles.challengeDesc}>{item.description}</Text>
                  <View style={styles.challengeMeta}>
                    <View style={styles.featuredTag}>
                      <Text style={styles.featuredTagText}>Featured</Text>
                    </View>
                    <Text style={styles.challengeTarget}>
                      {item.targetValue} {item.unit}
                    </Text>
                    <Text style={styles.challengeDuration}>{item.durationDays} days</Text>
                  </View>
                </View>
                {joined ? (
                  <View style={styles.joinedBadge}>
                    <Ionicons name="checkmark" size={14} color={Colors.primary} />
                    <Text style={styles.joinedText}>Joined</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.joinBtn}
                    onPress={() => handleJoinChallenge(item.id)}
                  >
                    <Text style={styles.joinBtnText}>Join</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {/* ──────────── LEADERBOARD TAB ──────────── */}
      {activeTab === 'leaderboard' && (
        <FlatList
          data={leaderboard}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="podium-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Rankings Yet</Text>
              <Text style={styles.emptyText}>Complete challenges and activities to earn points!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.userId === currentUser?.id;
            const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
            return (
              <View style={[styles.leaderRow, isMe && styles.leaderRowMe]}>
                <View style={styles.rankContainer}>
                  {item.rank <= 3 ? (
                    <Ionicons name="medal" size={24} color={medalColors[item.rank - 1]} />
                  ) : (
                    <Text style={styles.rankText}>{item.rank}</Text>
                  )}
                </View>
                <View style={styles.leaderAvatar}>
                  <Text style={styles.leaderAvatarText}>
                    {item.userName.split(' ').map((n) => n[0]).join('')}
                  </Text>
                </View>
                <View style={styles.leaderInfo}>
                  <Text style={[styles.leaderName, isMe && styles.leaderNameMe]}>
                    {item.userName}{isMe ? ' (You)' : ''}
                  </Text>
                </View>
                <View style={styles.leaderPoints}>
                  <Ionicons name="star" size={14} color="#E9C46A" />
                  <Text style={styles.leaderPointsText}>{item.points}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ──────────── WINS TAB ──────────── */}
      {activeTab === 'wins' && (
        <FlatList
          data={wins}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="star-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Wins Yet</Text>
              <Text style={styles.emptyText}>Achievements and milestones will show up here!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const icon = WIN_ICONS[item.type] || 'star';
            const color = WIN_COLORS[item.type] || Colors.primary;
            return (
              <View style={styles.winCard}>
                <View style={[styles.winIcon, { backgroundColor: color + '18' }]}>
                  <Ionicons name={icon as any} size={22} color={color} />
                </View>
                <View style={styles.winInfo}>
                  <Text style={styles.winUserName}>{item.userName}</Text>
                  <Text style={styles.winTitle}>{item.title}</Text>
                  <Text style={styles.winDesc}>{item.description}</Text>
                </View>
                <Text style={styles.winTime}>{formatTimeAgo(item.createdAt)}</Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pointsText: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  // ── Tabs ──
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primaryPale,
    borderColor: Colors.primary,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: Colors.primary },
  // ── Shared ──
  listContent: { paddingHorizontal: 24, paddingBottom: 100 },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 40 },
  // ── My Challenges Section ──
  sectionHeader: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 10 },
  myChallengeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryPale,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  myChallengeInfo: { flex: 1 },
  myChallengeName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  myChallengeProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(45,106,79,0.15)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  myChallengeCount: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, minWidth: 60 },
  // ── Challenge Cards ──
  challengeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  challengeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeInfo: { flex: 1, gap: 4 },
  challengeTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  challengeDesc: { fontSize: 12, color: Colors.textSecondary },
  challengeMeta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  challengeTarget: { fontSize: 11, fontWeight: '600', color: Colors.primary },
  challengeDuration: { fontSize: 11, color: Colors.textMuted },
  joinBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  joinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primaryPale,
  },
  joinedText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  // ── Leaderboard ──
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  leaderRowMe: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  rankContainer: { width: 30, alignItems: 'center' },
  rankText: { fontSize: 16, fontWeight: '800', color: Colors.textMuted },
  leaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderAvatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  leaderNameMe: { fontWeight: '800', color: Colors.primary },
  leaderPoints: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaderPointsText: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  // ── Wins Feed ──
  winCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  winIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  winInfo: { flex: 1, gap: 2 },
  winUserName: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  winTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  winDesc: { fontSize: 13, color: Colors.textSecondary },
  winTime: { fontSize: 11, color: Colors.textMuted },
  featuredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  featuredBannerText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  featuredTag: {
    backgroundColor: Colors.primaryPale,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  featuredTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
});
