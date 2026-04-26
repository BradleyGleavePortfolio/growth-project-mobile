import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
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
import { MealType } from '../../types';
import { sendCalorieReminderNotification } from '../../utils/notifications';
import {
  getStartOfWeek,
  getEndOfWeek,
  formatWeekRange,
  formatVolume,
} from '../../utils/weekUtils';
import {
  useHabits,
  useHabitLogs,
  useWeeklyVolumeBreakdown,
  useUnreadMessagesCount,
  useUnreadNudgeCount,
} from '../../hooks/useApi';
import HeroAction from '../../components/HeroAction';
import { usePreferences } from '../../hooks/usePreferences';
import TrustCueRow from '../../components/trust/TrustCueRow';
import IdentityBadge from '../../components/IdentityBadge';
import { useFoundingNumber, useCircleStats } from '../../hooks/useIdentity';
import { resolveIdentityTitle } from '../../lib/identityTitle';
import MilestoneProgress from '../../components/anticipation/MilestoneProgress';
import CountdownTile from '../../components/anticipation/CountdownTile';
import { resolveNextMilestones } from '../../lib/milestones';
import { track } from '../../lib/analytics';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

// ── WeeklyVolumeCard ─────────────────────────────────────────────────────────

// ── Psych #5: Streak Milestone Banner ───────────────────────────────────────
// Shown once per milestone (7 / 30 / 90 day streaks), tappable to TrophyShare.

const STREAK_MILESTONES = [7, 30, 90] as const;
const STREAK_STORAGE_KEY = 'trophy_streak_dismissed';

interface StreakMilestoneBannerProps {
  streakDays: number;
  identityTitle: string;
  isFoundingMember: boolean;
  navigation: any;
}

function StreakMilestoneBanner({
  streakDays,
  identityTitle,
  isFoundingMember,
  navigation,
}: StreakMilestoneBannerProps) {
  const [dismissed, setDismissed] = React.useState<boolean | null>(null);

  // The highest milestone hit so far
  const milestoneDays = STREAK_MILESTONES.filter((m) => streakDays >= m).slice(-1)[0];
  const storageKey = milestoneDays ? `${STREAK_STORAGE_KEY}_${milestoneDays}` : null;

  React.useEffect(() => {
    if (!storageKey) { setDismissed(true); return; }
    AsyncStorage.getItem(storageKey)
      .then((val) => setDismissed(val === 'true'))
      .catch(() => setDismissed(true));
  }, [storageKey]);

  const dismiss = () => {
    if (storageKey) AsyncStorage.setItem(storageKey, 'true').catch(() => {});
    setDismissed(true);
  };

  const openTrophy = () => {
    if (!milestoneDays) return;
    track('trophy_generated', { surface: 'streak', kind: 'streak', is_founding_member: isFoundingMember });
    dismiss();
    navigation.navigate('TrophyShare', {
      kind: 'streak',
      headline: `${milestoneDays}-DAY\nSTREAK`,
      subtitle: `${milestoneDays} days of consistent effort.`,
      identityTitle,
      isFoundingMember,
      surface: 'streak',
    });
  };

  // Loading or no milestone reached or already dismissed
  if (dismissed !== false || !milestoneDays) return null;

  return (
    <HapticPressable intent="success" onPress={openTrophy} style={smStyles.banner}>
      <Text style={smStyles.flame}>{String.fromCodePoint(0x1F525)}</Text>
      <View style={smStyles.text}>
        <Text style={smStyles.title}>{milestoneDays}-Day Streak!</Text>
        <Text style={smStyles.sub}>Tap to claim your trophy</Text>
      </View>
      <HapticPressable intent="light" onPress={dismiss} style={smStyles.close}>
        <Ionicons name="close" size={16} color={Colors.textMuted} />
      </HapticPressable>
    </HapticPressable>
  );
}

const smStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: Spacing.lg,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  flame: { fontSize: 28 },
  text: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  close: { padding: 4 },
});

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

  // Today's date string and week-range — stable derivations, computed once
  // per render. The week-range labels feed both the WeeklyVolume card and
  // the volume hook below.
  const today = getToday();
  const now = new Date();
  const weekStartIso = getStartOfWeek(now).toISOString();
  const weekEndIso = getEndOfWeek(now).toISOString();
  const weekRangeLabel = formatWeekRange(now);

  // React Query reads (Fix #2): habits + logs + weekly volume + unread badges.
  const habitsQ = useHabits();
  const logsQ = useHabitLogs(today);
  const weeklyVolQ = useWeeklyVolumeBreakdown(weekStartIso, weekEndIso);
  const messagesUnreadQ = useUnreadMessagesCount();
  const nudgesUnreadQ = useUnreadNudgeCount();

  // Derive the per-screen view models from the queries above.
  const allHabits = habitsQ.data || [];
  const habitLogs = logsQ.data || [];
  const enrichedHabits: HabitItem[] = allHabits.map((h: any) => ({
    id: h.id,
    name: h.name,
    color: h.color || Colors.primary,
    done: habitLogs.some((l: any) => (l.habit_id || l.habitId) === h.id && l.completed),
  }));
  const habitsData: HabitsData = {
    total: allHabits.length,
    completed: enrichedHabits.filter((h) => h.done).length,
    habits: enrichedHabits.slice(0, 6),
  };

  // Weekly volume: pad to a full 7-day breakdown so the chart bars stay
  // aligned even on quiet weeks.
  const weeklyVolume = weeklyVolQ.data?.total ?? 0;
  const weeklyBreakdown: Array<{ date: string; volume: number }> = (() => {
    const start = getStartOfWeek(now);
    const breakdown = weeklyVolQ.data?.breakdown || [];
    const out: Array<{ date: string; volume: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const found = breakdown.find((b) => b.date === dateStr);
      out.push({ date: dateStr, volume: found?.volume || 0 });
    }
    return out;
  })();

  const messagesUnread = Number(messagesUnreadQ.data?.total ?? 0);
  const nudgesUnread = Number((nudgesUnreadQ.data as any)?.total ?? (nudgesUnreadQ.data as any)?.count ?? 0);

  // ── UX Psych #4: Preference-Controlled Personalization ──
  const { prefs } = usePreferences();

  // ── UX Psych #3: Identity Reinforcement ──
  const foundingQ = useFoundingNumber();
  const circleQ = useCircleStats();

  const foundingData = foundingQ.data ?? null;
  const circleStats = circleQ.data ?? null;

  // Derive identity title from available data (graceful fallback to defaults)
  const identityTitle = resolveIdentityTitle({
    isFoundingMember: foundingData?.isFoundingMember ?? false,
    streakDays: 0,         // streak endpoint not yet wired — safe default
    totalWorkouts: 0,      // workout count not yet wired — safe default
    weeksSinceJoin: 0,
    daysSinceLastWorkout: undefined,
  });

  // ── UX Psych #4: Healthy Anticipation — milestone progress ─────────────────
  // Resolved from local data only (no backend). Uses 0-defaults until streak/
  // workout endpoints are wired; milestone cards still render with meaningful
  // progress bars once those values are available.
  const upNextMilestones = resolveNextMilestones({
    workoutCount:    0,   // safe default — wire to real value when endpoint ready
    streakDays:      0,   // safe default
    identityTitle:   identityTitle.label,
    isFoundingMember: foundingData?.isFoundingMember ?? false,
  });

  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id);
      loadProfile(currentUser.id);
      // Load personalized macro targets from AsyncStorage (saved during onboarding)
      AsyncStorage.getItem('macro_targets').then((raw) => {
        if (raw) {
          try {
            setAsyncTargets(JSON.parse(raw));
          } catch (err) {
            // Malformed JSON: fall back to defaults. A future save will
            // overwrite the bad value.
            console.error('HomeScreen: macro_targets parse failed', err);
          }
        }
      }).catch((err) => {
        console.error('HomeScreen: macro_targets read failed', err);
      });
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
      habitsQ.refetch(),
      logsQ.refetch(),
      weeklyVolQ.refetch(),
      messagesUnreadQ.refetch(),
      nudgesUnreadQ.refetch(),
    ]);
    const raw = await AsyncStorage.getItem('macro_targets');
    if (raw) {
      try {
        setAsyncTargets(JSON.parse(raw));
      } catch (err) {
        // Same malformed-JSON path as the mount-time read above.
        console.error('HomeScreen: macro_targets parse failed on refresh', err);
      }
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
              {/* UX Psych #3: Identity title above secondary copy */}
              <Text style={styles.identityTitle}>{identityTitle.label}</Text>
              <IdentityBadge
                rank={foundingData?.rank ?? 0}
                isFoundingMember={foundingData?.isFoundingMember ?? false}
                hidden={!foundingData}
              />
            </View>
            <View style={styles.headerIcons}>
              <HapticPressable
                intent="light"
                onPress={() => navigation.navigate('Messages')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Messages${messagesUnread > 0 ? `, ${messagesUnread} unread` : ''}`}
                accessibilityHint="Opens your chat with your coach"
                style={styles.headerIconWrap}
              >
                <Ionicons name="chatbubble-outline" size={24} color={Colors.dark} />
                {messagesUnread > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {messagesUnread > 99 ? '99+' : messagesUnread}
                    </Text>
                  </View>
                )}
              </HapticPressable>
              <HapticPressable
                intent="light"
                onPress={() => navigation.navigate('Notifications')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Notifications${nudgesUnread > 0 ? `, ${nudgesUnread} unread` : ''}`}
                accessibilityHint="Opens your notifications"
                style={styles.headerIconWrap}
              >
                <Ionicons name="notifications-outline" size={24} color={Colors.dark} />
                {nudgesUnread > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {nudgesUnread > 99 ? '99+' : nudgesUnread}
                    </Text>
                  </View>
                )}
              </HapticPressable>
            </View>
          </View>
        </View>
      </FadeInView>

      <DaySelector
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />

      {/* ── Psych #5: Streak milestone trophy banner ── */}
      <StreakMilestoneBanner
        streakDays={0}
        identityTitle={identityTitle.label}
        isFoundingMember={foundingData?.isFoundingMember ?? false}
        navigation={navigation}
      />

      {/* ── UX Psych #1: One Dominant Hero Action (prefs: hero module) ── */}
      {prefs.homeModules.includes('hero') && (
        <FadeInView delay={50}>
          <HeroAction motivationalTone={prefs.motivationalTone} />
          {/* UX Psych #3: Social-proof — circle trained today */}
          {circleStats && circleStats.trainedTodayCount > 0 && (
            <Text style={styles.circleSocialProof}>
              {circleStats.trainedTodayCount} of your circle trained today
            </Text>
          )}
        </FadeInView>
      )}

      {/* ── UX Psych #4: Healthy Anticipation — "Up Next" milestone section ─────── */}
      <FadeInView delay={75}>
        <View style={styles.upNextSection}>
          <Text style={styles.upNextLabel}>Up Next</Text>

          {/* Milestone progress cards */}
          {upNextMilestones.map((milestone) => (
            <MilestoneProgress
              key={milestone.slug}
              milestone={milestone}
              isFoundingMember={foundingData?.isFoundingMember ?? false}
              style={styles.milestoneCard}
              onPress={() => {
                track('milestone_unlocked', {
                  slug:     milestone.slug,
                  category: milestone.category,
                  pct:      milestone.targetValue > 0
                    ? Math.round((milestone.currentValue / milestone.targetValue) * 100)
                    : 0,
                });
              }}
            />
          ))}

          {/* Countdown tile — coach check-in: shown if next_coach_date exists in profile.
              Rendered conditionally; skips gracefully when no date is available. */}
          {(() => {
            const nextCoachDate =
              (currentUser?.profile as any)?.next_coach_checkin ||
              (currentUser?.profile as any)?.next_plan_date;
            if (!nextCoachDate) return null;

            const isCoach = !!(currentUser?.profile as any)?.next_coach_checkin;
            return (
              <CountdownTile
                targetDate={nextCoachDate}
                eventType={isCoach ? 'coach_checkin' : 'new_plan'}
                style={styles.countdownTile}
              />
            );
          })()}
        </View>
      </FadeInView>

      {prefs.homeModules.includes('secondary') && <FadeInView delay={100}>
        {/* ── Secondary section: Nutrition ring (demoted below hero) ── */}
        <View style={styles.ringSectionLabel}>
          <Text style={styles.secondarySectionTitle}>Nutrition</Text>
        </View>
        <View style={styles.ringSection}>
          <CalorieRing consumed={dailyTotals.calories} target={calorieTarget} />
          <Text style={styles.targetLabel}>
            Goal: {calorieTarget} kcal
          </Text>
          {(calorieTarget - dailyTotals.calories) > 200 && (
            <HapticPressable
              intent="light"
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
            </HapticPressable>
          )}
        </View>
      </FadeInView>}

      {prefs.homeModules.includes('secondary') && <FadeInView delay={200}>
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
      </FadeInView>}

      {prefs.homeModules.includes('secondary') && (
        <FadeInView delay={250}>
          <WeeklyVolumeCard
            totalVolume={weeklyVolume}
            weekLabel={weekRangeLabel}
            breakdown={weeklyBreakdown}
          />
        </FadeInView>
      )}

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
        <HapticPressable
          intent="light"
          style={styles.habitsCard}
          onPress={() => navigation.navigate('Habits')}
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
        </HapticPressable>
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
              <HapticPressable
                key={item.label}
                intent="light"
                style={styles.quickAccessItem}
                onPress={() =>
                  item.nested
                    ? navigation.navigate(item.tab, { screen: item.nested })
                    : navigation.navigate(item.tab)
                }
                accessible
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityHint={item.a11y}
              >
                <View style={[styles.quickAccessIcon, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={styles.quickAccessLabel}>{item.label}</Text>
              </HapticPressable>
            ))}
          </View>
        </View>
      {/* Psych #2: Trust as Emotion — trust cues below secondary sections, above footer */}
      <TrustCueRow />

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
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIconWrap: {
    position: 'relative',
  },
  headerBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBadgeText: {
    color: Colors.textOnPrimary,
    fontSize: 10,
    fontWeight: '700',
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
  identityTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  circleSocialProof: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
    fontStyle: 'italic',
  },
  ringSectionLabel: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 4,
  },
  secondarySectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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

  // ── UX Psych #4: Healthy Anticipation ─────────────────────────────────────
  upNextSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom:      20,
    gap:               10,
  },
  upNextLabel: {
    fontSize:      12,
    fontWeight:    '700',
    color:         Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom:  2,
  },
  milestoneCard: {
    // flex-child spacing handled by upNextSection gap
  },
  countdownTile: {
    marginTop: 2,
  },
});
