import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { lessonsApi } from '../../services/api';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { IoniconName, JsonRecord } from '../../types/common';
import {
  Lesson,
  LessonProgress,
  getUserProgress,
  markLessonComplete,
} from '../../db/educationDb';

type ScreenMode = 'list' | 'detail';

const CATEGORY_ICONS: Record<string, string> = {
  'Nutrition Basics': 'nutrition',
  'Muscle Building': 'barbell',
  Fitness: 'fitness',
  Lifestyle: 'heart',
};

function makeCATEGORY_COLORS(colors: ThemeColors): Record<string, string> {
  return {
  'Nutrition Basics': colors.primary,
  'Muscle Building': colors.info,
  Fitness: colors.warning,
  Lifestyle: colors.streak,
};
}

interface LessonWithProgress extends Lesson {
  completed: boolean;
}

export default function EducationScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const CATEGORY_COLORS = useMemo(() => makeCATEGORY_COLORS(colors), [colors]);
  const currentUser = useCurrentUser();
  const [mode, setMode] = useState<ScreenMode>('list');
  const [lessons, setLessons] = useState<LessonWithProgress[]>([]);
  const [_progress, setProgress] = useState<LessonProgress[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<LessonWithProgress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    let serverLessons: Lesson[] = [];
    try {
      const res = await lessonsApi.getAll();
      const data = res.data as { lessons?: JsonRecord[] } | JsonRecord[] | undefined;
      const raw: JsonRecord[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.lessons)
          ? data.lessons
          : [];
      serverLessons = raw.map((l) => ({
        id: String(l.id),
        title: (l.title as string) || 'Untitled',
        subtitle: (l.subtitle as string) || '',
        category: (l.category as string) || 'Nutrition Basics',
        content: (l.content as string) || (l.body as string) || '',
        durationMin: (l.duration_min as number) ?? (l.durationMin as number) ?? 5,
        sortOrder: (l.sort_order as number) ?? (l.sortOrder as number) ?? 0,
        createdAt: (l.created_at as string) ?? (l.createdAt as string) ?? new Date().toISOString(),
      }));
      serverLessons.sort((a, b) => a.sortOrder - b.sortOrder);
    } catch (err) {
      // Read-only fetch. On failure leave whatever we had (first load = empty
      // list with the honest empty state below).
      console.error('EducationScreen: lessonsApi.getAll failed', err);
    }
    // Completion: backend is source of truth; local SQLite is used as a cache
    // for offline reads. We merge both so lessons marked locally but not yet
    // synced still show as complete.
    const userProgress = await getUserProgress(currentUser.id);
    setProgress(userProgress);
    const localCompletedIds = new Set(
      userProgress.filter((p) => p.completed).map((p) => p.lessonId),
    );
    // Try to pull backend completions (lessons already completed will have
    // completed=true in the lesson list response if the backend tracks it,
    // otherwise we fall back to local SQLite).
    let backendCompletedIds = new Set<string>();
    try {
      const allRes = await lessonsApi.getAll();
      const allData = allRes.data as { lessons?: JsonRecord[] } | JsonRecord[] | undefined;
      const allRaw: JsonRecord[] = Array.isArray(allData)
        ? allData
        : Array.isArray(allData?.lessons)
          ? allData.lessons
          : [];
      allRaw.forEach((l) => {
        if (l.completed || l.is_completed) backendCompletedIds.add(String(l.id));
      });
    } catch {
      // fallback to local only
    }
    const completedIds = new Set([...localCompletedIds, ...backendCompletedIds]);
    setLessons(
      serverLessons.map((l) => ({ ...l, completed: completedIds.has(l.id) })),
    );
  }, [currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const openLesson = (lesson: LessonWithProgress) => {
    setSelectedLesson(lesson);
    setMode('detail');
  };

  const handleComplete = async () => {
    if (!currentUser || !selectedLesson) return;
    // Optimistic update — local SQLite keeps offline cache in sync
    await markLessonComplete(currentUser.id, selectedLesson.id);
    setSelectedLesson({ ...selectedLesson, completed: true });
    setLessons((prev) =>
      prev.map((l) => (l.id === selectedLesson.id ? { ...l, completed: true } : l))
    );
    // Backend is source of truth — fire-and-forget; local state already updated
    try {
      await lessonsApi.complete(selectedLesson.id);
    } catch (err) {
      // Non-blocking: completion is cached locally; backend will sync on next load
      console.warn('EducationScreen: lessonsApi.complete failed', err);
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
      <View style={styles.container}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.detailHeaderCenter}>
            <Text style={styles.detailCategory}>{selectedLesson.category}</Text>
            <Text style={styles.detailDuration}>{selectedLesson.durationMin} min read</Text>
          </View>
          {selectedLesson.completed ? (
            <View style={styles.completedBadge}>
              <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
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
            <TouchableOpacity style={styles.completeBtn} onPress={handleComplete}>
              <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
              <Text style={styles.completeBtnText}>Mark as Complete</Text>
            </TouchableOpacity>
          )}

          {selectedLesson.completed && (
            <View style={styles.completedCard}>
              <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
              <Text style={styles.completedCardText}>Complete.</Text>
            </View>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      </View>
    );
  }

  // ──────────────────── LIST VIEW ────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Learn</Text>
        <Text style={styles.subtitle}>Build your nutrition &amp; fitness knowledge</Text>
      </View>

      {/* Progress Card */}
      <View style={styles.progressCard}>
        <View style={styles.progressInfo}>
          <Text style={styles.progressTitle}>Your Progress</Text>
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
      </View>

      {/* Category Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        <TouchableOpacity
          style={[styles.categoryChip, !filterCategory && styles.categoryChipActive]}
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
            onPress={() => setFilterCategory(filterCategory === cat ? null : cat)}
          >
            <Ionicons
              name={(CATEGORY_ICONS[cat] || 'book') as IoniconName}
              size={14}
              color={filterCategory === cat ? colors.textOnPrimary : CATEGORY_COLORS[cat] || colors.textSecondary}
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
          <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No lessons yet</Text>
            <Text style={styles.emptyText}>
              Your coach hasn't published any lessons. When they do, you'll see them here.
            </Text>
          </View>
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
          const catColor = CATEGORY_COLORS[item.category] || colors.primary;
          return (
            <TouchableOpacity
              style={styles.lessonCard}
              onPress={() => openLesson(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.lessonNumber, { backgroundColor: catColor + '18' }]}>
                <Text style={[styles.lessonNumberText, { color: catColor }]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.lessonInfo}>
                <Text style={styles.lessonTitle}>{item.title}</Text>
                <Text style={styles.lessonSubtitle}>{item.subtitle}</Text>
                <View style={styles.lessonMeta}>
                  <View style={[styles.lessonCategoryTag, { backgroundColor: catColor + '18' }]}>
                    <Text style={[styles.lessonCategoryText, { color: catColor }]}>
                      {item.category}
                    </Text>
                  </View>
                  <View style={styles.featuredTag}>
                    <Text style={styles.featuredTagText}>Featured</Text>
                  </View>
                  <Text style={styles.lessonDuration}>{item.durationMin} min</Text>
                </View>
              </View>
              {item.completed ? (
                <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // ── Header ──
  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 16 },
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
  // ── Progress Card ──
  progressCard: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  progressCount: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  progressBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: colors.primaryPale,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  progressPercent: { fontFamily: 'Inter_500Medium', fontSize: 13, fontWeight: '500', color: colors.primary, minWidth: 36 },
  // ── Category Filters ──
  categoryRow: { paddingHorizontal: 24, gap: 8, marginBottom: 12 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontFamily: 'Inter_500Medium', fontSize: 12, fontWeight: '500', letterSpacing: 0.4, color: colors.textSecondary },
  categoryChipTextActive: { color: colors.textOnPrimary },
  // ── Lesson Cards ──
  listContent: { paddingHorizontal: 24, paddingBottom: 100 },
  lessonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lessonNumber: {
    width: 40,
    height: 40,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
  },
  lessonNumberText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
  lessonInfo: { flex: 1, gap: 4 },
  lessonTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  lessonSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  lessonMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lessonCategoryTag: { borderRadius: 0, paddingHorizontal: 8, paddingVertical: 2 },
  lessonCategoryText: { fontFamily: 'Inter_500Medium', fontSize: 10, fontWeight: '500', letterSpacing: 1.5, textTransform: 'uppercase' },
  featuredTag: {
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
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
  lessonDuration: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  // ── Detail View ──
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailHeaderCenter: { alignItems: 'center' },
  detailCategory: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  detailDuration: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 4 },
  completedBadge: {},
  detailScroll: { flex: 1 },
  detailContent: { padding: 24 },
  detailTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
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
    fontFamily: 'CormorantGaramond_500Medium',
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
    fontSize: 15,
    color: colors.textSecondary,
    width: 20,
    lineHeight: 23,
  },
  bulletText: { flex: 1, fontSize: 15, color: colors.textPrimary, lineHeight: 23 },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
    marginTop: 24,
  },
  completeBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textOnPrimary,
  },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
    marginTop: 24,
  },
  completedCardText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.primary,
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
    lineHeight: 24,
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
