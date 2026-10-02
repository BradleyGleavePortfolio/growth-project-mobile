import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { SkeletonCard } from '../../components/SkeletonLoader';
import SafetyMenu from '../../components/community/SafetyMenu';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { IoniconName } from '../../types/common';
import { communityWinsApi, type CommunityWin } from '../../api/communityWinsApi';
import { describeCommunityFailure } from '../../api/communityErrors';

/**
 * CommunityScreen (More > Community) — member wins.
 *
 * A win is user-generated content, so it carries the same App Review 1.2
 * controls as every community surface: the server filters objectionable text
 * before it is stored (422, the draft is kept here), every other member's win
 * has Report and Block, the author can delete their own win, and reports go
 * to the coach's moderation queue (reviewed within 24 hours). Wins are shared
 * only with teammates in the coach's community; there is no public feed.
 * Other members appear by first name only.
 */

/** Query key under ['community'] so a block refetches it with every community surface. */
export const WINS_QUERY_KEY = ['community', 'wins'] as const;

export function formatTimeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((now - t) / 60000));
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
  const viewerId = currentUser?.id ?? null;
  const qc = useQueryClient();
  const [postWinOpen, setPostWinOpen] = useState(false);
  const [winTitle, setWinTitle] = useState('');
  const [winDesc, setWinDesc] = useState('');
  const [postError, setPostError] = useState<string | null>(null);

  const wins = useQuery<CommunityWin[]>({
    queryKey: [...WINS_QUERY_KEY, viewerId],
    queryFn: () => communityWinsApi.getFeed(viewerId),
  });

  const refreshWins = useCallback(() => qc.invalidateQueries({ queryKey: WINS_QUERY_KEY }), [qc]);

  const postWin = useMutation({
    mutationFn: (input: { title: string; description: string }) => communityWinsApi.postWin(input),
    onSuccess: () => refreshWins(),
  });

  const onRefresh = useCallback(async () => {
    await wins.refetch();
  }, [wins]);

  const openComposer = useCallback(() => {
    setPostError(null);
    setPostWinOpen(true);
  }, []);

  const handleSubmitWin = useCallback(async () => {
    const title = winTitle.trim();
    const description = winDesc.trim();
    if (!title || !description) {
      setPostError('Add a title and a few words about what happened, then post.');
      return;
    }
    setPostError(null);
    try {
      await postWin.mutateAsync({ title, description });
      setWinTitle('');
      setWinDesc('');
      setPostWinOpen(false);
    } catch (err) {
      // The draft stays in the fields so the member can rephrase or retry.
      setPostError(describeCommunityFailure(err, 'send_win').message);
    }
  }, [winTitle, winDesc, postWin]);

  const loadFailure = wins.isError ? describeCommunityFailure(wins.error, 'load_wins') : null;

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
          onPress={openComposer}
          accessibilityRole="button"
          accessibilityLabel="Share a win"
          testID="wins-share"
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
          ) : loadFailure ? (
            <View style={styles.emptyContainer} testID="wins-error">
              <Ionicons name="cloud-offline-outline" size={48} color={colors.error} />
              <Text style={[styles.emptyTitle, { color: colors.error }]}>{loadFailure.title}</Text>
              <Text style={styles.emptyText}>{loadFailure.message}</Text>
              <TouchableOpacity
                style={styles.shareWinBtn}
                onPress={onRefresh}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                testID="wins-retry"
              >
                <Text style={styles.shareWinText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <EmptyState
              icon="star-outline"
              title="No wins yet"
              text="Share something you are proud of, like a new personal best or a week you stayed consistent."
            />
          )
        }
        renderItem={({ item }: { item: CommunityWin }) => {
          const isMe = item.isMine || (!!viewerId && item.userId === viewerId);
          return (
            <View style={styles.winCard} testID={`win-${item.id}`}>
              <View style={styles.winIcon}>
                <Ionicons name="star" size={22} color={colors.warning} />
              </View>
              <View style={styles.winInfo}>
                <Text style={styles.winUserName}>{isMe ? 'You' : item.displayName}</Text>
                <Text style={styles.winTitle}>{item.title}</Text>
                {item.description ? <Text style={styles.winDesc}>{item.description}</Text> : null}
              </View>
              <View style={styles.winMeta}>
                <Text style={styles.winTime}>{formatTimeAgo(item.createdAt)}</Text>
                <SafetyMenu
                  targetType="win"
                  targetId={item.id}
                  authorUserId={isMe ? viewerId : item.userId}
                  authorName={item.displayName}
                  viewerUserId={viewerId}
                  viewerCoachId={currentUser?.coach_id}
                  contentNoun="win"
                  onDelete={
                    isMe
                      ? async () => {
                          await communityWinsApi.deleteWin(item.id);
                          await refreshWins();
                        }
                      : undefined
                  }
                  onBlocked={() => {
                    void refreshWins();
                  }}
                  testID={`win-menu-${item.id}`}
                />
              </View>
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
              <TouchableOpacity
                onPress={() => setPostWinOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Teammates in your coach&apos;s community will see this, and can report it if something
              is wrong. If your coach has not opened a community yet, only you will see it.
            </Text>
            <TextInput
              placeholder="Title, for example: Hit a new best on squats"
              placeholderTextColor={colors.textMuted}
              value={winTitle}
              onChangeText={setWinTitle}
              maxLength={80}
              style={styles.modalInput}
              testID="wins-title"
            />
            <TextInput
              placeholder="A few words about what happened"
              placeholderTextColor={colors.textMuted}
              value={winDesc}
              onChangeText={setWinDesc}
              multiline
              maxLength={500}
              style={[styles.modalInput, styles.modalInputMultiline]}
              testID="wins-description"
            />
            {postError ? (
              <Text
                style={styles.modalError}
                accessibilityLiveRegion="polite"
                testID="wins-post-error"
              >
                {postError}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[styles.modalSubmit, postWin.isPending && styles.modalSubmitDisabled]}
              disabled={postWin.isPending}
              onPress={handleSubmitWin}
              accessibilityRole="button"
              testID="wins-submit"
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
      <Ionicons name={icon as IoniconName} size={48} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
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
    winDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    winTime: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textMuted,
    },
    winMeta: { alignItems: 'flex-end', justifyContent: 'space-between' },
    modalError: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.error,
      lineHeight: 19,
    },

  });
