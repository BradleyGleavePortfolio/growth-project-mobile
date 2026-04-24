import React, { useEffect, useState, useCallback } from 'react';
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
import { Colors } from '../../constants/colors';
import { lessonsApi } from '../../services/api';
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

const CATEGORY_COLORS: Record<string, string> = {
  'Nutrition Basics': Colors.primary,
  'Muscle Building': Colors.info,
  Fitness: Colors.warning,
  Lifestyle: Colors.streak,
};

interface LessonWithProgress extends Lesson {
  completed: boolean;
}

export default function EducationScreen() {
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
      const raw: any[] = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.lessons)
          ? res.data.lessons
          : [];
      serverLessons = raw.map((l: any) => ({
        id: String(l.id),
        title: l.title || 'Untitled',
        subtitle: l.subtitle || '',
        category: l.category || 'Nutrition Basics',
        content: l.content || l.body || '',
        durationMin: l.duration_min ?? l.durationMin ?? 5,
        sortOrder: l.sort_order ?? l.sortOrder ?? 0,
        createdAt: l.created_at ?? l.createdAt ?? new Date().toISOString(),
      }));
      serverLessons.sort((a, b) => a.sortOrder - b.sortOrder);
    } catch (err) {
      // Read-only fetch. On failure leave whatever we had (first load = empty
      // list with the honest empty state below).
      console.error('EducationScreen: lessonsApi.getAll failed', err);
    }
    // Completion tracking stays local for now — the backend endpoint exists
    // (`POST /lessons/:id/complete`) but the coach-side read has no UI yet,
    // so we don't want to advertise progress that no one sees. Revisit when
    // a "lesson completions" surface lands for the coach.
    const userProgress = await getUserProgress(currentUser.id);
    setProgress(userProgress);
    const completedIds = new Set(
      userProgress.filter((p) => p.completed).map((p) => p.lessonId),
    );
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
    await markLessonComplete(currentUser.id, selectedLesson.id);
    setSelectedLesson({ ...selectedLesson, completed: true });
    setLessons((prev) =>
      prev.map((l) => (l.id === selectedLesson.id ? { ...l, completed: true } : l))
    );
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
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.detailHeaderCenter}>
            <Text style={styles.detailCategory}>{selectedLesson.category}</Text>
            <Text style={styles.detailDuration}>{selectedLesson.durationMin} min read</Text>
          </View>
          {selectedLesson.completed ? (
            <View style={styles.completedBadge}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
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
              <Ionicons name="checkmark-circle" size={20} color={Colors.textOnPrimary} />
              <Text style={styles.completeBtnText}>Mark as Complete</Text>
            </TouchableOpacity>
          )}

          {selectedLesson.completed && (
            <View style={styles.completedCard}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
              <Text style={styles.completedCardText}>Lesson completed!</Text>
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
              name={(CATEGORY_ICONS[cat] || 'book') as any}
              size={14}
              color={filterCategory === cat ? Colors.textOnPrimary : CATEGORY_COLORS[cat] || Colors.textSecondary}
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
            <Ionicons name="book-outline" size={40} color={Colors.textMuted} />
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
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
        renderItem={({ item, index }) => {
          const catColor = CATEGORY_COLORS[item.category] || Colors.primary;
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
                <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // ── Header ──
  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  // ── Progress Card ──
  progressCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  progressCount: { fontSize: 13, color: Colors.textSecondary },
  progressBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: Colors.primaryPale,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 4 },
  progressPercent: { fontSize: 14, fontWeight: '700', color: Colors.primary, minWidth: 36 },
  // ── Category Filters ──
  categoryRow: { paddingHorizontal: 24, gap: 8, marginBottom: 12 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  categoryChipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  categoryChipTextActive: { color: Colors.textOnPrimary },
  // ── Lesson Cards ──
  listContent: { paddingHorizontal: 24, paddingBottom: 100 },
  lessonCard: {
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
  lessonNumber: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lessonNumberText: { fontSize: 16, fontWeight: '800' },
  lessonInfo: { flex: 1, gap: 4 },
  lessonTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  lessonSubtitle: { fontSize: 12, color: Colors.textSecondary },
  lessonMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lessonCategoryTag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  lessonCategoryText: { fontSize: 11, fontWeight: '600' },
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
  lessonDuration: { fontSize: 11, color: Colors.textMuted },
  // ── Detail View ──
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailHeaderCenter: { alignItems: 'center' },
  detailCategory: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  detailDuration: { fontSize: 12, color: Colors.textMuted },
  completedBadge: {},
  detailScroll: { flex: 1 },
  detailContent: { padding: 24 },
  detailTitle: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  detailSubtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 8 },
  detailDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  detailHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  detailParagraph: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 23,
    marginBottom: 8,
  },
  detailBold: { fontWeight: '700' },
  bulletRow: { flexDirection: 'row', paddingLeft: 4, marginBottom: 6, paddingRight: 16 },
  bulletDot: {
    fontSize: 15,
    color: Colors.textSecondary,
    width: 20,
    lineHeight: 23,
  },
  bulletText: { flex: 1, fontSize: 15, color: Colors.textPrimary, lineHeight: 23 },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
  },
  completeBtnText: { fontSize: 16, fontWeight: '700', color: Colors.textOnPrimary },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primaryPale,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
  },
  completedCardText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
