import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { lessonsApi } from '../../services/api';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { IoniconName, JsonRecord } from '../../types/common';
import {
  getUserProgress,
  markLessonComplete,
} from '../../db/educationDb';
import { lessonFromApi, type EducationLesson } from './educationLesson';
import { radius } from '../../theme/tokens';
import { Screen } from '../../ui';

type ScreenMode = 'list' | 'detail';

const CATEGORY_ICONS: Record<string, string> = {
  'Nutrition Basics': 'nutrition-outline',
  'Muscle Building': 'barbell-outline',
  Fitness: 'fitness-outline',
  Lifestyle: 'heart-outline',
};

export default function EducationScreen() {
  const { colors: base, semanticColors: sc } = useTheme();
  const colors = useMemo(() => ({ ...base, background: sc.bgPrimary, surface: sc.bgPrimary,
    textPrimary: sc.textPrimary, textSecondary: sc.textMuted, textMuted: sc.textMuted,
    primary: sc.accent, primaryPale: sc.border, border: sc.border, textOnPrimary: sc.textOnAccent }), [base, sc]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [mode, setMode] = useState<ScreenMode>('list');
  const [lessons, setLessons] = useState<EducationLesson[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<EducationLesson | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    // Backend completions, derived from the same lessons payload we already
    // fetched — no second round-trip to /lessons. See audit P0-7.
    const backendCompletedIds = new Set<string>();
    setLoading(true);
    setLoadError(null);
    try {
      const res = await lessonsApi.getAll();
      const data = res.data as { lessons?: JsonRecord[] } | JsonRecord[] | undefined;
      const raw: JsonRecord[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.lessons)
          ? data.lessons
          : [];
      const serverLessons = raw.map((l) => {
        const lesson = lessonFromApi(l);
        if (lesson.completed) backendCompletedIds.add(String(l.id));
        return lesson;
      });
      serverLessons.sort((a, b) => a.sortOrder - b.sortOrder);
      // Preserve cached progress while reading real backend completions.
      const userProgress = await getUserProgress(currentUser.id).catch(() => []);
      const localCompletedIds = new Set(
        userProgress.filter((p) => p.completed).map((p) => p.lessonId),
      );
      const completedIds = new Set([...localCompletedIds, ...backendCompletedIds]);
      setLessons(
        serverLessons.map((l) => ({ ...l, completed: completedIds.has(l.id) })),
      );
    } catch {
      setLoadError('Lessons did not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const openLesson = (lesson: EducationLesson) => {
    setDetailError(null);
    setSelectedLesson(lesson);
    setMode('detail');
  };

  const handleComplete = async () => {
    if (!currentUser || !selectedLesson || completing) return;
    setCompleting(true);
    setDetailError(null);
    try {
      await lessonsApi.complete(selectedLesson.id);
      // Only claim completion after the server confirms the save.
      setSelectedLesson({ ...selectedLesson, completed: true });
      setLessons((prev) =>
        prev.map((l) => (l.id === selectedLesson.id ? { ...l, completed: true } : l))
      );
      await markLessonComplete(currentUser.id, selectedLesson.id).catch((error: unknown) => {
        console.warn('Education completion cache did not save', error);
      });
    } catch {
      setDetailError('Lesson completion did not save. Check your connection and try again.');
    } finally {
      setCompleting(false);
    }
  };

  const openLessonLink = async (url: string | null, kind: 'video' | 'article') => {
    setDetailError(null);
    try {
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('Unavailable lesson URL');
      await Linking.openURL(url);
    } catch {
      setDetailError(`The lesson ${kind} could not open. Try the link again.`);
    }
  };

  const goBack = () => {
    setMode('list');
    setSelectedLesson(null);
  };

  const completedCount = lessons.filter((l) => l.completed).length;
  const totalCount = lessons.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const categories = [...new Set(lessons.map((l) => l.category))];
  const filteredLessons = filterCategory
    ? lessons.filter((l) => l.category === filterCategory)
    : lessons;

  // ──────────────────── DETAIL VIEW ────────────────────
  if (mode === 'detail' && selectedLesson) {
    return (
      <Screen edges={['top']} scroll={false} contentStyle={styles.bare}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={goBack} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Back to lessons">
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.detailHeaderCenter}>
            <Text style={styles.detailCategory}>{selectedLesson.category}</Text>
            {selectedLesson.durationMin > 0 ? (
              <Text style={styles.detailDuration}>{selectedLesson.durationMin} min</Text>
            ) : null}
          </View>
          {selectedLesson.completed ? (
            <View style={styles.completedBadge}>
              <Ionicons name="checkmark-circle-outline" size={24} color={sc.accentText} />
            </View>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        <ScrollView
          style={styles.detailScroll}
          contentContainerStyle={styles.detailContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.detailTitle}>{selectedLesson.title}</Text>
          <Text style={styles.detailSubtitle}>{selectedLesson.subtitle}</Text>

          <View style={styles.detailDivider} />
          {selectedLesson.videoUrl ? (
            <TouchableOpacity style={styles.lessonLink} accessibilityRole="link"
              onPress={() => void openLessonLink(selectedLesson.videoUrl, 'video')}>
              <Text style={styles.lessonLinkText}>Watch lesson</Text>
            </TouchableOpacity>
          ) : null}
          {selectedLesson.articleUrl ? (
            <TouchableOpacity style={styles.lessonLink} accessibilityRole="link"
              onPress={() => void openLessonLink(selectedLesson.articleUrl, 'article')}>
              <Text style={styles.lessonLinkText}>Read article</Text>
            </TouchableOpacity>
          ) : null}
          {!selectedLesson.content && !selectedLesson.videoUrl && !selectedLesson.articleUrl ? (
            <Text style={styles.detailParagraph}>No lesson content or links are available.</Text>
          ) : null}
          {detailError ? <Text style={styles.detailParagraph}>{detailError}</Text> : null}

          {selectedLesson.content.split('\n').map((paragraph, idx) => {
            const trimmed = paragraph.trim();
            if (!trimmed) return <View key={idx} style={{ height: 12 }} />;
            if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
              return (
                <Text key={idx} style={styles.detailHeading}>
                  {trimmed.replace(/\*\*/g, '')}
                </Text>
              );
            }
            if (trimmed.startsWith('**') && trimmed.includes(':**')) {
              const match = trimmed.match(/^\*\*(.+?)\*\*(.*)$/);
              if (match) {
                return (
                  <Text key={idx} style={styles.detailParagraph}>
                    <Text style={styles.detailBold}>{match[1]}</Text>
                    {match[2]}
                  </Text>
                );
              }
            }
            if (trimmed.startsWith('•')) {
              return (
                <View key={idx} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{trimmed.substring(1).trim()}</Text>
                </View>
              );
            }
            if (/^\d+\./.test(trimmed)) {
              const num = trimmed.match(/^(\d+\.)/)?.[1] || '';
              return (
                <View key={idx} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>{num}</Text>
                  <Text style={styles.bulletText}>{trimmed.substring(num.length).trim()}</Text>
                </View>
              );
            }
            return (
              <Text key={idx} style={styles.detailParagraph}>
                {trimmed}
              </Text>
            );
          })}

          {!selectedLesson.completed && (
            <TouchableOpacity style={styles.completeBtn} onPress={handleComplete} disabled={completing}
              accessibilityRole="button" accessibilityState={{ disabled: completing }}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnPrimary} />
              <Text style={styles.completeBtnText}>{completing ? 'Saving completion…' : 'Mark as complete'}</Text>
            </TouchableOpacity>
          )}

          {selectedLesson.completed && (
            <View style={styles.completedCard}>
              <Ionicons name="checkmark-circle-outline" size={24} color={sc.accentText} />
              <Text style={styles.completedCardText}>Complete.</Text>
            </View>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      </Screen>

    );
  }

  // ──────────────────── LIST VIEW ────────────────────
  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.bare}>
      <View style={styles.header}>
        <Text style={styles.title}>Learn</Text>
        <Text style={styles.subtitle}>Build your nutrition &amp; fitness knowledge</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading lessons" /> : null}
      {loadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{loadError}</Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => void loadData()} accessibilityRole="button">
            <Text style={styles.completeBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Progress Card */}
      {!loading && !loadError && totalCount > 0 ? <View style={styles.progressCard}>
        <View style={styles.progressInfo}>
          <Text style={styles.progressTitle}>Completed</Text>
          <Text style={styles.progressCount}>
            {completedCount} of {totalCount} lessons
          </Text>
        </View>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{progressPercent}%</Text>
        </View>
      </View> : null}

      {/* Category Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        <TouchableOpacity
          style={[styles.categoryChip, !filterCategory && styles.categoryChipActive]}
          accessibilityRole="button" accessibilityLabel="All" accessibilityState={{ selected: !filterCategory }}
          onPress={() => setFilterCategory(null)}
        >
          <Text style={[styles.categoryChipText, !filterCategory && styles.categoryChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.categoryChip, filterCategory === cat && styles.categoryChipActive]}
            accessibilityRole="button" accessibilityLabel={cat} accessibilityState={{ selected: filterCategory === cat }}
            onPress={() => setFilterCategory(filterCategory === cat ? null : cat)}
          >
            <Ionicons
              name={(CATEGORY_ICONS[cat] || 'book-outline') as IoniconName}
              size={14}
              color={sc.textMuted}
            />
            <Text
              style={[
                styles.categoryChipText,
                filterCategory === cat && styles.categoryChipTextActive,
              ]}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Lessons List */}
      <FlatList
        data={filteredLessons}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loading && !loadError ? <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No lessons yet</Text>
            <Text style={styles.emptyText}>
              No lessons available. Pull down to refresh.
            </Text>
          </View> : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        renderItem={({ item, index }) => {
          const catColor = sc.textMuted;
          return (
            <TouchableOpacity
              style={styles.lessonCard}
              onPress={() => openLesson(item)}
              accessibilityRole="button" accessibilityLabel={item.title}
              activeOpacity={0.7}
            >
              <View style={styles.lessonNumber}>
                <Text style={[styles.lessonNumberText, { color: catColor }]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.lessonInfo}>
                <Text style={styles.lessonTitle}>{item.title}</Text>
                <Text style={styles.lessonSubtitle}>{item.subtitle}</Text>
                <View style={styles.lessonMeta}>
                  <View style={styles.lessonCategoryTag}>
                    <Text style={[styles.lessonCategoryText, { color: catColor }]}>
                      {item.category}
                    </Text>
                  </View>
                  {item.durationMin > 0 ? <Text style={styles.lessonDuration}>{item.durationMin} min</Text> : null}
                </View>
                {item.createdAt ? <Text style={styles.lessonDuration}>{new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text> : null}
              </View>
              {item.completed ? (
                <Ionicons name="checkmark-circle-outline" size={24} color={sc.accentText} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          );
        }}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  // Screen owns the inset top (insets.top + 12); the lists keep their own gutters.
  bare: { paddingHorizontal: 0, paddingBottom: 0 },
  // ── Header ──
  header: { paddingHorizontal: 24, marginBottom: 16 },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 40,
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
  // ── Progress Card ──
  progressCard: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    // A hairline section, not a box: no corners.
    padding: 16,
    marginBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  progressCount: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 24, lineHeight: 30, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  progressBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: colors.primaryPale,
    borderRadius: radius.chip,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.chip },
  progressPercent: { fontFamily: 'Inter_500Medium', fontSize: 13, fontWeight: '500', color: colors.textPrimary, minWidth: 36 },
  // ── Category Filters ──
  categoryRow: { paddingHorizontal: 24, gap: 8, marginBottom: 12 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.chip,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  categoryChipActive: { borderWidth: 1, borderColor: colors.textPrimary },
  categoryChipText: { fontFamily: 'Inter_500Medium', fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  categoryChipTextActive: { color: colors.textPrimary },
  // ── Lesson Cards ──
  listContent: { paddingHorizontal: 24, paddingBottom: 100 },
  lessonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    // A hairline row, not a box: no corners.
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  lessonNumber: {
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lessonNumberText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
  lessonInfo: { flex: 1, gap: 4 },
  lessonTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  lessonSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  lessonMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  lessonCategoryTag: { borderRadius: radius.control, paddingHorizontal: 8, paddingVertical: 2 },
  lessonCategoryText: { fontFamily: 'Inter_500Medium', fontSize: 13, fontWeight: '500' },
  featuredTag: {
    backgroundColor: colors.primaryPale,
    borderRadius: radius.control,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  featuredTagText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  lessonDuration: { fontFamily: 'Inter_400Regular', fontSize: 13, fontVariant: ['tabular-nums'], color: colors.textMuted },
  // ── Detail View ──
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailHeaderCenter: { alignItems: 'center' },
  detailCategory: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: colors.textPrimary,
  },
  detailDuration: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textMuted, marginTop: 4 },
  completedBadge: {},
  detailScroll: { flex: 1 },
  detailContent: { padding: 24 },
  detailTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  detailSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.textSecondary, marginBottom: 8, lineHeight: 22 },
  detailDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  detailHeading: {
    fontFamily: 'Inter_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  detailParagraph: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: 8,
  },
  detailBold: { fontFamily: 'Inter_500Medium', fontWeight: '500' },
  bulletRow: { flexDirection: 'row', paddingLeft: 4, marginBottom: 6, paddingRight: 16 },
  bulletDot: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.textSecondary,
    width: 20,
    lineHeight: 23,
  },
  bulletText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.textPrimary, lineHeight: 23 },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    minHeight: 54,
    paddingVertical: 16,
    marginTop: 24,
  },
  lessonLink: { minHeight: 44, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lessonLinkText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
  completeBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    color: colors.textOnPrimary,
  },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingVertical: 16,
    marginTop: 24,
  },
  completedCardText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textPrimary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },

  });
