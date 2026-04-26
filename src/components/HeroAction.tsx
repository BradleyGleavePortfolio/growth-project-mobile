/**
 * HeroAction — UX Psychology Report #1 "One Dominant Home Action"
 *
 * A full-width, visually dominant card that surfaces the single most
 * important action for the user right now:
 *
 *   1. Not logged a workout today → "Log Today's Workout"
 *   2. Already logged today      → "Resume Your Plan"
 *   3. 3+ day streak             → streak badge above hero
 *   4. Dynamic subtitle          → contextual coach copy
 *
 * Queries only endpoints that already exist in api.ts / useApi.ts.
 * Gracefully degrades to a sensible CTA on 401 / empty / error states.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, Radius, Shadow, colors } from '../theme/index';
import { useQuery } from '@tanstack/react-query';
import { workoutApi, mealPlansApi } from '../services/api';
import { getTodayString } from '../utils/date';
import { track } from '../lib/analytics';

// ─── Types ────────────────────────────────────────────────────────────────────

type HeroState =
  | 'loading'
  | 'log_workout'    // default: no workout today
  | 'resume_plan';   // already logged today → push to plan/next workout

interface HeroConfig {
  state: HeroState;
  title: string;
  subtitle: string;
  streakCount: number; // 0 = no badge
}

// ─── Data layer ───────────────────────────────────────────────────────────────

/** Lightweight hook: fetches recent workouts + active meal plan to derive hero state */
function useHeroData() {
  const today = getTodayString();

  // Recent workouts (limit 30 to cover a decent streak window)
  const workoutsQ = useQuery<any[]>({
    queryKey: ['workouts', 'hero', 'list'],
    queryFn: async () => {
      const res = await workoutApi.getAll(30);
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.workouts ?? []);
    },
    // Don't block render — stale data is fine for hero state
    staleTime: 60_000,
    retry: 1,
  });

  // Meal plans (for subtitle copy when resuming plan)
  const plansQ = useQuery<any[]>({
    queryKey: ['meal-plans', 'hero'],
    queryFn: async () => {
      const res = await mealPlansApi.list();
      const raw = res.data;
      return Array.isArray(raw) ? raw : [];
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const isLoading = workoutsQ.isLoading;

  const config: HeroConfig = useMemo(() => {
    if (isLoading) return { state: 'loading', title: '', subtitle: '', streakCount: 0 };

    const sessions: any[] = workoutsQ.data ?? [];

    // Did the user log a workout today?
    const loggedToday = sessions.some((s: any) => {
      const d = (s.completed_at || s.created_at || s.date || '').slice(0, 10);
      return d === today;
    });

    // Compute consecutive-day streak (counting back from today)
    const streakCount = computeStreak(sessions, today);
    // TODO(psych-4): streak_extended event — fire when streakCount increases
    // from the previous session. Requires persisting last-known streak in
    // AsyncStorage and comparing on each data refresh. Skip for now to avoid
    // over-engineering the data layer in this PR.

    // Active meal plan title for subtitle
    const activePlan: any = (plansQ.data ?? [])[0];
    const planTitle: string = activePlan?.title ?? '';

    if (loggedToday) {
      return {
        state: 'resume_plan',
        title: 'Resume Your Plan',
        subtitle: planTitle
          ? `Up next: ${planTitle}`
          : "You're on track — keep the momentum going",
        streakCount,
      };
    }

    // No workout today
    const workoutsThisWeek = sessions.filter((s: any) => {
      const d = new Date((s.completed_at || s.created_at || s.date || ''));
      const now = new Date();
      const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return diff < 7;
    }).length;
    const remaining = Math.max(0, 3 - workoutsThisWeek); // assume 3x/week goal

    const subtitle =
      remaining > 0
        ? `You're ${remaining} workout${remaining === 1 ? '' : 's'} from your weekly goal`
        : "Great week — keep it going!";

    return {
      state: 'log_workout',
      title: "Log Today's Workout",
      subtitle,
      streakCount,
    };
  }, [isLoading, workoutsQ.data, plansQ.data, today]);

  return { config, workoutsQ, plansQ };
}

/**
 * Count how many consecutive calendar days (ending today) the user
 * has logged at least one workout.
 */
function computeStreak(sessions: any[], today: string): number {
  if (!sessions.length) return 0;

  const datesWithWorkout = new Set<string>(
    sessions.map((s: any) =>
      (s.completed_at || s.created_at || s.date || '').slice(0, 10),
    ).filter(Boolean),
  );

  let streak = 0;
  const cursor = new Date(today + 'T00:00:00');

  for (let i = 0; i < 365; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (datesWithWorkout.has(dateStr)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function HeroSkeleton() {
  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, styles.cardSkeleton]}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSubtitle} />
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HeroAction() {
  const navigation = useNavigation<any>();
  const { config } = useHeroData();

  if (config.state === 'loading') return <HeroSkeleton />;

  const handlePress = () => {
    // Fire medium haptic on press — feels substantial and intentional
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Psych Report #4: Analytics — hero_action_tapped with current state
    track('hero_action_tapped', { state: config.state, streak_count: config.streakCount });

    if (config.state === 'resume_plan') {
      // Navigate to the Plan tab
      navigation.navigate('Plan');
    } else {
      // Navigate to the Workout tab → WorkoutMain
      navigation.navigate('WorkoutTab');
    }
  };

  return (
    <View style={styles.wrapper}>
      {/* Streak badge — only shown when streak ≥ 3 days */}
      {config.streakCount >= 3 && (
        <View style={styles.streakBadge}>
          <Text style={styles.streakText}>
            🔥 {config.streakCount}-day streak — keep it alive
          </Text>
        </View>
      )}

      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={config.title}
        accessibilityHint={
          config.state === 'resume_plan'
            ? 'Opens your current meal plan'
            : 'Opens the workout tracker'
        }
      >
        {/* Left: text content */}
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
            {config.title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {config.subtitle}
          </Text>
        </View>

        {/* Right: arrow icon */}
        <View style={styles.iconWrap}>
          <Ionicons
            name="arrow-forward-circle"
            size={36}
            color="rgba(255,255,255,0.9)"
          />
        </View>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 24,
  },

  // ── Streak badge ──
  streakBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.data.streak + '22', // 13% opacity tint
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.data.streak + '44',
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.data.streak,
  },

  // ── Hero card ──
  card: {
    height: 160,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary, // brand deep green — #2D6A4F
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    // Prominent shadow — makes it feel "lifted" above secondary content
    ...Shadow.button,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  cardSkeleton: {
    backgroundColor: Colors.primaryPale,
    ...Shadow.card,
    justifyContent: 'center',
    gap: 14,
  },

  // ── Text block ──
  textBlock: {
    flex: 1,
    marginRight: 12,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.80)',
    lineHeight: 20,
  },

  // ── Arrow icon ──
  iconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Skeleton placeholders ──
  skeletonTitle: {
    height: 28,
    width: '65%',
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryLight + '55',
  },
  skeletonSubtitle: {
    height: 16,
    width: '80%',
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryLight + '33',
  },
});
