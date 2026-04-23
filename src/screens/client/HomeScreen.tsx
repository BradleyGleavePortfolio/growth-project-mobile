import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { getGreeting, getTodayString as getToday } from '../../utils/date';
import CalorieRing from '../../components/CalorieRing';
import MacroBar from '../../components/MacroBar';
import MealCard from '../../components/MealCard';
import WaterTracker from '../../components/WaterTracker';
import DaySelector from '../../components/DaySelector';
import FadeInView from '../../components/FadeInView';
import { SkeletonCard, SkeletonLine } from '../../components/SkeletonLoader';
// All colors from central theme — never hardcode hex values here
// Round 3: added semantic `colors` import for chart/macro/info tokens
import { Colors, Spacing, Radius, colors } from '../../theme/index';
import { habitsApi } from '../../services/api';
import { MealType } from '../../types';
import { sendCalorieReminderNotification } from '../../utils/notifications';
import {
  getStartOfWeek,
  getEndOfWeek,
  formatWeekRange,
  formatVolume,
} from '../../utils/weekUtils';
import {
  getWeeklyVolume,
  getDailyVolumeBreakdown,
} from '../../db/workoutDb';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

// ── WeeklyVolumeCard ─────────────────────────────────────────────────────────

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CHART_HEIGHT = 48;
const BAR_WIDTH = 28;

interface WeeklyVolumeCardProps {
  totalVolume: number;
  weekLabel: string;
  breakdown: Array<{ date: string; volume: number }>;
}

function WeeklyVolumeCard({ totalVolume, weekLabel, breakdown }: WeeklyVolumeCardProps) {
  const maxVol = Math.max(...breakdown.map((d) => d.volume), 1);
  // Determine today's index in the week (Monday=0)
  const todayDay = new Date().getDay();
  const todayIdx = todayDay === 0 ? 6 : todayDay - 1;

  return (
    <View style={wvStyles.card}>
      <View style={wvStyles.headerRow}>
        {/* Round 3: hex → theme token */}
        <Ionicons name="barbell-outline" size={20} color={Colors.primary} />
        <View style={wvStyles.headerText}>
          <Text style={wvStyles.title}>Total Weight Moved This Week</Text>
          <Text style={wvStyles.weekLabel}>{weekLabel}</Text>
        </View>
      </View>

      <Text style={wvStyles.volumeNumber}>
        {formatVolume(Math.round(totalVolume))} lbs
      </Text>

      {/* 7-day mini bar chart */}
      <View style={wvStyles.chartContainer}>
        {breakdown.slice(0, 7).map((d, i) => {
          const barH = d.volume > 0 ? Math.max(4, (d.volume / maxVol) * CHART_HEIGHT) : 4;
          const isToday = i === todayIdx;
          const hasVolume = d.volume > 0;
          return (
            <View key={d.date || i} style={wvStyles.barColumn}>
              <View style={[wvStyles.barTrack, { height: CHART_HEIGHT }]}>
                <View
                  style={[
                    wvStyles.bar,
                    {
                      height: barH,
                      // Round 3: hex → theme tokens (primary / primaryLight / primaryPale)
                      backgroundColor: hasVolume
                        ? isToday ? Colors.primary : Colors.primaryLight
                        : Colors.primaryPale,
                    },
                  ]}
                />
              </View>
              <Text style={[wvStyles.dayLabel, isToday && wvStyles.dayLabelToday]}>
                {DAY_LABELS[i]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const wvStyles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.lg,
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  headerText: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
  },
  weekLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  volumeNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary, // Round 3: hex → token
    marginBottom: 14,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  barTrack: {
    justifyContent: 'flex-end',
    width: BAR_WIDTH,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 4,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  dayLabelToday: {
    color: Colors.primary, // Round 3: hex → token
    fontWeight: '700',
  },
});

// ─────────────────────────────────────────────────────────────────────────────

interface HabitItem {
  id: string;
  name: string;
  color: string;
  done: boolean;
}

interface HabitsData {
  total: number;
  completed: number;
  habits: HabitItem[];
}

export default function HomeScreen() {
  const currentUser = useCurrentUser();
  const {
    selectedDate,
    foodLogs,
    dailyTotals,
    waterOz,
    isLoading,
    setSelectedDate,
    loadDayData,
    loadProfile,
    logWater,
  } = useClientStore();

  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [asyncTargets, setAsyncTargets] = useState<{
    calories: number; protein: number; carbs: number; fat: number;
  } | null>(null);
  const [habitsData, setHabitsData] = useState<HabitsData>({
    total: 0,
    completed: 0,
    habits: [],
  });

  // Weekly volume state
  const [weeklyVolume, setWeeklyVolume] = useState<number>(0);
  const [weeklyBreakdown, setWeeklyBreakdown] = useState<Array<{ date: string; volume: number }>>([]);
  const [weekRangeLabel, setWeekRangeLabel] = useState<string>('');

  // Load habits from REST API instead of SQLite
  const loadHabits = useCallback(async () => {
    if (!currentUser) return;
    try {
      const today = getToday();
      const [habitsRes, logsRes] = await Promise.all([
        habitsApi.getAll(),
        habitsApi.getLogs(today),
      ]);
      const allHabits: any[] = habitsRes.data || [];
      const logs: any[] = logsRes.data || [];
      const enriched: HabitItem[] = allHabits.map((h: any) => ({
        id: h.id,
        name: h.name,
        color: h.color || Colors.primary,
        done: logs.some((l: any) => l.habitId === h.id && l.completed),
      }));
      setHabitsData({
        total: allHabits.length,
        completed: enriched.filter((h) => h.done).length,
        habits: enriched.slice(0, 6),
      });
    } catch {
      // Habits API unavailable — silently degrade, no SQLite fallback needed
      setHabitsData({ total: 0, completed: 0, habits: [] });
    }
  }, [currentUser]);

  const loadWeeklyVolumeData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const now = new Date();
      const start = getStartOfWeek(now);
      const end = getEndOfWeek(now);
      const weekStart = start.toISOString();
      const weekEnd = end.toISOString();
      setWeekRangeLabel(formatWeekRange(now));
      const [total, breakdown] = await Promise.all([
        getWeeklyVolume(currentUser.id, weekStart, weekEnd),
        getDailyVolumeBreakdown(currentUser.id, weekStart, weekEnd),
      ]);
      setWeeklyVolume(total);
      // Build a full 7-day breakdown (fill zeros for missing days)
      const fullBreakdown: Array<{ date: string; volume: number }> = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const found = breakdown.find((b) => b.date === dateStr);
        fullBreakdown.push({ date: dateStr, volume: found?.volume || 0 });
      }
      setWeeklyBreakdown(fullBreakdown);
    } catch (err) {
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id);
      loadProfile(currentUser.id);
      loadHabits();
      loadWeeklyVolumeData();
      // Load personalized macro targets from AsyncStorage (saved during onboarding)
      AsyncStorage.getItem('macro_targets').then((raw) => {
        if (raw) {
          try { setAsyncTargets(JSON.parse(raw)); } catch {}
        }
      }).catch(() => {});
    }
  }, [currentUser?.id]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    if (currentUser) {
      loadDayData(currentUser.id, date);
    }
  };

  const handleAddWater = (oz: number) => {
    if (currentUser) {
      logWater(currentUser.id, '', oz);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([
      loadDayData(currentUser.id, selectedDate),
      loadProfile(currentUser.id),
      loadHabits(),
      loadWeeklyVolumeData(),
    ]);
    const raw = await AsyncStorage.getItem('macro_targets');
    if (raw) {
      try { setAsyncTargets(JSON.parse(raw)); } catch {}
    }
    setRefreshing(false);
  }, [currentUser?.id, selectedDate]);

  const calorieTarget = currentUser?.profile?.calorie_target || asyncTargets?.calories || 2000;
  const proteinTarget = currentUser?.profile?.protein_target || asyncTargets?.protein || 150;
  const carbTarget = currentUser?.profile?.carbs_target || asyncTargets?.carbs || 200;
  const fatTarget = currentUser?.profile?.fat_target || asyncTargets?.fat || 65;

  const getMealFoods = (mealType: MealType) =>
    foodLogs.filter((f) => f.mealType === mealType);

  if (!currentUser) {
    return (
      <View style={styles.loadingContainer}>
        {/* Round 3: stale teal hex → brand primary */}
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (isLoading && foodLogs.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <View style={{ paddingHorizontal: Spacing.lg, paddingTop: 80, gap: 16 }}>
          <SkeletonLine width="60%" height={24} />
          <SkeletonLine width="40%" height={14} />
          <View style={{ marginTop: 20 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
          colors={[Colors.primary]}
        />
      }
    >
      <FadeInView>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.greeting}>
                {getGreeting()}, {currentUser?.name || 'there'}
              </Text>
              <Text style={styles.subtitle}>Track your nutrition today</Text>
            </View>
            {/* Round 3: a11y on header notifications bell */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Notifications')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              accessibilityHint="Opens your notifications"
            >
              <Ionicons name="notifications-outline" size={24} color={Colors.dark} />
            </TouchableOpacity>
          </View>
        </View>
      </FadeInView>

      <DaySelector
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />

      <FadeInView delay={100}>
        <View style={styles.ringSection}>
          <CalorieRing consumed={dailyTotals.calories} target={calorieTarget} />
          <Text style={styles.targetLabel}>
            Goal: {calorieTarget} kcal
          </Text>
          {(calorieTarget - dailyTotals.calories) > 200 && (
            <TouchableOpacity
              style={styles.remindBtn}
              onPress={() => {
                const remaining = calorieTarget - dailyTotals.calories;
                const snacks: string[] = JSON.parse(
                  (currentUser?.profile as any)?.preferredSnacks || '[]',
                );
                sendCalorieReminderNotification(remaining, snacks);
              }}
              accessibilityRole="button"
              accessibilityLabel="Remind me to eat"
              accessibilityHint="Schedules a calorie reminder notification"
            >
              <Ionicons name="notifications-outline" size={14} color={Colors.primary} />
              <Text style={styles.remindBtnText}>Remind me to eat</Text>
            </TouchableOpacity>
          )}
        </View>
      </FadeInView>

      <FadeInView delay={200}>
        <View style={styles.macroSection}>
          {/* Round 3: macro hex colors → theme data tokens (protein/carbs/fat kept
              with domain-specific accents; habit purple for fat per existing palette) */}
          <MacroBar
            label="Protein"
            current={dailyTotals.protein}
            target={proteinTarget}
            color={colors.data.streak}
          />
          <MacroBar
            label="Carbs"
            current={dailyTotals.carbs}
            target={carbTarget}
            color={Colors.gold}
          />
          <MacroBar
            label="Fat"
            current={dailyTotals.fat}
            target={fatTarget}
            color={colors.data.habit}
          />
        </View>
      </FadeInView>

      <FadeInView delay={250}>
        <WeeklyVolumeCard
          totalVolume={weeklyVolume}
          weekLabel={weekRangeLabel}
          breakdown={weeklyBreakdown}
        />
      </FadeInView>

      <FadeInView delay={300}>
        <View style={styles.mealsSection}>
          <Text style={styles.sectionTitle}>Meals</Text>
          <View style={styles.mealCards}>
            {MEAL_ORDER.map((meal) => (
              <MealCard
                key={meal}
                mealType={meal}
                foods={getMealFoods(meal)}
              />
            ))}
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={400}>
        <View style={styles.waterSection}>
          <WaterTracker
            currentOz={waterOz}
            onAdd={handleAddWater}
          />
        </View>
      </FadeInView>

      <FadeInView delay={500}>
        <TouchableOpacity
          style={styles.habitsCard}
          onPress={() => navigation.navigate('Habits')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Daily habits, ${habitsData.completed} of ${habitsData.total} complete`}
          accessibilityHint="Opens the habits tracker"
        >
          <View style={styles.habitsCardHeader}>
            <View style={styles.habitsCardLeft}>
              <Ionicons name="leaf" size={20} color={Colors.primary} />
              <Text style={styles.habitsCardTitle}>Daily Habits</Text>
            </View>
            <View style={styles.habitsCardRight}>
              <Text style={styles.habitsCardCount}>
                {habitsData.completed}/{habitsData.total}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </View>
          </View>
          <View style={styles.habitsPreview}>
            {habitsData.habits.map((h) => (
              <View key={h.id} style={styles.habitDot}>
                <View
                  style={[
                    styles.habitDotCircle,
                    {
                      backgroundColor: h.done ? h.color : 'transparent',
                      borderColor: h.done ? h.color : Colors.border,
                    },
                  ]}
                >
                  {h.done && <Ionicons name="checkmark" size={12} color={Colors.white} />}
                </View>
                <Text style={styles.habitDotLabel} numberOfLines={1}>{h.name}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </FadeInView>

      <FadeInView delay={600}>
        <View style={styles.quickAccessSection}>
          <Text style={styles.sectionTitle}>Explore</Text>
          <View style={styles.quickAccessGrid}>
            {/* Round 3: quick-access targets rewired after 9→5 tab consolidation.
                Plan + (non-existent) AI stay as sibling tabs; Recipes / Fasting /
                Community / Learn now live inside MoreTab and are reached with a
                nested `{ screen: 'MoreTab', params: { screen: '…' } }` nav. */}
            {([
              { tab: 'Plan', icon: 'calendar', label: 'Meal Plan', color: Colors.primary, a11y: 'Open meal plan' },
              { tab: 'MoreTab', nested: 'Recipes', icon: 'restaurant-outline', label: 'Recipes', color: Colors.orange, a11y: 'Browse recipes' },
              { tab: 'MoreTab', nested: 'Fast', icon: 'timer-outline', label: 'Fasting', color: colors.feedback.info, a11y: 'Open fasting tracker' },
              { tab: 'MoreTab', nested: 'Learn', icon: 'book-outline', label: 'Learn', color: Colors.gold, a11y: 'Open learning content' },
              { tab: 'MoreTab', nested: 'Community', icon: 'people-outline', label: 'Community', color: Colors.primary, a11y: 'Open community' },
            ] as { tab: string; nested?: string; icon: string; label: string; color: string; a11y: string }[]).map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.quickAccessItem}
                onPress={() =>
                  item.nested
                    ? navigation.navigate(item.tab, { screen: item.nested })
                    : navigation.navigate(item.tab)
                }
                activeOpacity={0.7}
                accessible
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityHint={item.a11y}
              >
                <View style={[styles.quickAccessIcon, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={styles.quickAccessLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </FadeInView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 60,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  ringSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  targetLabel: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 8,
  },
  macroSection: {
    paddingHorizontal: Spacing.lg,
    gap: 14,
    marginBottom: 28,
  },
  mealsSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark,
    marginBottom: 12,
  },
  mealCards: {
    gap: 10,
  },
  waterSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },
  habitsCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  habitsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  habitsCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  habitsCardTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark },
  habitsCardRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  habitsCardCount: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  habitsPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  habitDot: { alignItems: 'center', width: 52, gap: 4 },
  habitDotCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  habitDotLabel: { fontSize: 10, color: Colors.textMuted, textAlign: 'center' },
  quickAccessSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },
  quickAccessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickAccessItem: {
    width: '30%',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  quickAccessIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickAccessLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark,
    textAlign: 'center',
  },
  remindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.full,
    alignSelf: 'center',
  },
  remindBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
});
