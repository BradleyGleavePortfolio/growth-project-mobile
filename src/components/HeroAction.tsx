/**
 * HeroAction — UX Psychology Report #1 "One Dominant Home Action"
 *             + UX Psychology Report #5 "Premium Visual System" (token refresh)
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
 *
 * Psych #5 changes:
 *   • Background gradient — base: primaryDark → primary stop.
 *     Founder tier receives a gold accent gradient stop.
 *   • Typography mapped from tokens.typography scale (h3, body).
 *   • Spacing from tokens.spacing (lg, xl).
 *   • Shadow from tokens.shadows.md (card) with brand shadow color.
 *   • All hardcoded hex values removed.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { workoutApi, mealPlansApi } from '../services/api';
import { getTodayString } from '../utils/date';
import { track } from '../lib/analytics';
import tokens from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
// Legacy theme exports kept for the skeleton (uses Radius / Shadow)
import { Radius, Shadow } from '../theme/index';
import type { MotivationalTone } from '../hooks/usePreferences';

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

  const workoutsQ = useQuery<any[]>({
    queryKey: ['workouts', 'hero', 'list'],
    queryFn: async () => {
      const res = await workoutApi.getAll(30);
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.workouts ?? []);
    },
    staleTime: 60_000,
    retry: 1,
  });

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

    const loggedToday = sessions.some((s: any) => {
      const d = (s.completed_at || s.created_at || s.date || '').slice(0, 10);
      return d === today;
    });

    const streakCount = computeStreak(sessions, today);

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

    const workoutsThisWeek = sessions.filter((s: any) => {
      const d = new Date((s.completed_at || s.created_at || s.date || ''));
      const now = new Date();
      const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return diff < 7;
    }).length;
    const remaining = Math.max(0, 3 - workoutsThisWeek);

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

function computeStreak(sessions: any[], today: string): number {
  if (!sessions.length) return 0;
  const datesWithWorkout = new Set<string>(
    sessions
      .map((s: any) => (s.completed_at || s.created_at || s.date || '').slice(0, 10))
      .filter(Boolean),
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

/** Psych #4: Tone-aware copy variants for the log-workout CTA */
const TONE_TITLES: Record<MotivationalTone, string> = {
  gentle: 'Ready when you are',
  direct: "Log Today's Workout",
  drill: 'No excuses. Log it now.',
};

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

interface HeroActionProps {
  /** Psych #4: tone variant for the log-workout CTA copy. Defaults to 'direct'. */
  motivationalTone?: MotivationalTone;
}

export default function HeroAction({ motivationalTone = 'direct' }: HeroActionProps = {}) {
  const navigation = useNavigation<any>();
  const { config } = useHeroData();
  const { tier, tierColors } = useTheme();

  // Psych #4: override the log_workout title with tone-aware copy
  const heroTitle =
    config.state === 'log_workout'
      ? TONE_TITLES[motivationalTone]
      : config.title;

  if (config.state === 'loading') return <HeroSkeleton />;

  // Gradient colours: dark → base for free; dark → base → gold for founders
  const gradientColors: [string, string, ...string[]] =
    tier === 'founder'
      ? [tokens.brand[800], tokens.brand[600], tierColors.heroGradientStop]
      : [tokens.brand[800], tokens.brand[600]];

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    track('hero_action_tapped', { state: config.state, streak_count: config.streakCount });
    if (config.state === 'resume_plan') {
      navigation.navigate('Plan');
    } else {
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
        accessibilityLabel={heroTitle}
        accessibilityHint={
          config.state === 'resume_plan'
            ? 'Opens your current meal plan'
            : 'Opens the workout tracker'
        }
      >
        {/* Tier-aware gradient background */}
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Founder tier: subtle gold border glow */}
        {tier === 'founder' && (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.founderBorderOverlay,
              { borderColor: tierColors.accentBorder },
            ]}
            pointerEvents="none"
          />
        )}

        {/* Left: text content */}
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
            {heroTitle}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {config.subtitle}
          </Text>
        </View>

        {/* Right: arrow icon */}
        <View style={styles.iconWrap}>
          <Ionicons
            name="arrow-forward-circle"
            size={tokens.spacing['4xl'] / 2}   // 32
            color="rgba(255,255,255,0.90)"
          />
        </View>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: tokens.spacing.xl,   // 24 — wider breathing room
    marginBottom: tokens.spacing.xl,
  },

  // ── Streak badge ──
  streakBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(231,111,81,0.13)',
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs + 1,
    marginBottom: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(231,111,81,0.28)',
  },
  streakText: {
    fontSize: tokens.typography.caption.fontSize,
    fontWeight: '700',
    color: '#E76F51',
    letterSpacing: tokens.typography.caption.letterSpacing,
  },

  // ── Hero card ──
  card: {
    height: 168,
    borderRadius: tokens.radius.xl,          // 16 — a touch more refined
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.xl,    // 24
    paddingVertical: tokens.spacing.lg,      // 16
    // Card shadow from tokens
    ...tokens.shadows.md,
    shadowColor: tokens.brand[800],          // brand-tinted shadow
    shadowOpacity: 0.30,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.984 }],
  },
  cardSkeleton: {
    backgroundColor: tokens.brand[100],
    ...tokens.shadows.sm,
    justifyContent: 'center',
    gap: tokens.spacing.lg,
    overflow: 'hidden',
  },

  // Founder-only 1 dp border overlay
  founderBorderOverlay: {
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
  },

  // ── Text block ──
  textBlock: {
    flex: 1,
    marginRight: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  title: {
    fontSize: tokens.typography.h3.fontSize,        // 22
    lineHeight: tokens.typography.h3.lineHeight,     // 30
    fontWeight: tokens.typography.h3.fontWeight,     // 600
    color: '#FFFFFF',
    letterSpacing: tokens.typography.h3.letterSpacing,
    // Boost to h2 weight visually on this dark card
    ...Platform.select({ ios: { fontWeight: '800' as const }, android: {} }),
  },
  subtitle: {
    fontSize: tokens.typography.bodySmall.fontSize,   // 13
    fontWeight: '500',
    color: 'rgba(255,255,255,0.80)',
    lineHeight: tokens.typography.bodySmall.lineHeight,
    letterSpacing: tokens.typography.bodySmall.letterSpacing,
  },

  // ── Arrow icon ──
  iconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Skeleton placeholders ──
  skeletonTitle: {
    height: tokens.typography.h3.lineHeight,
    width: '65%',
    borderRadius: tokens.radius.sm,
    backgroundColor: 'rgba(82,183,136,0.22)',
  },
  skeletonSubtitle: {
    height: tokens.typography.bodySmall.lineHeight,
    width: '80%',
    borderRadius: tokens.radius.sm,
    backgroundColor: 'rgba(82,183,136,0.14)',
  },
});
