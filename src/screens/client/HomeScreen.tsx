/**
 * HomeScreen — Wave 3: Luxury hero rewrite.
 * Phase 11: Migrated to useTheme() semantic tokens for dark-mode support.
 *
 * One thought. Bone background, editorial serif date headline,
 * charcoal progress line, ink "CONTINUE" CTA, hairline rule,
 * 2×2 number grid below the fold.
 *
 * Removed from home: streak banner, calorie ring, macro bar,
 * day selector, community win, trust cue row, identity badge,
 * milestone tiles, weekly volume card, habits section, quick-access grid.
 *
 * The brief: "Home is one thought, not eleven."
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { track } from '../../lib/analytics';
import { typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
// Sprint B-2 — cross-pillar holistic insights tile (component shipped
// in PR #130; this PR places it on HomeScreen).
import HolisticInsightsTile from '../../components/home/HolisticInsightsTile';
import PendingInviteBanner from '../../components/PendingInviteBanner';
import { workoutApi } from '../../services/api';
import {
  getProfileCompletion,
  summarizeMissing,
} from '../../lib/profileCompletion';

// ─── Date-as-poetry helpers ──────────────────────────────────────────────────

const ORDINAL_WORDS: Record<number, string> = {
  1:  'the first',   2:  'the second', 3:  'the third',   4:  'the fourth',
  5:  'the fifth',   6:  'the sixth',  7:  'the seventh',  8:  'the eighth',
  9:  'the ninth',  10:  'the tenth', 11:  'the eleventh', 12: 'the twelfth',
  13: 'the thirteenth', 14: 'the fourteenth', 15: 'the fifteenth',
  16: 'the sixteenth',  17: 'the seventeenth', 18: 'the eighteenth',
  19: 'the nineteenth', 20: 'the twentieth',   21: 'the twenty-first',
  22: 'the twenty-second', 23: 'the twenty-third', 24: 'the twenty-fourth',
  25: 'the twenty-fifth',  26: 'the twenty-sixth', 27: 'the twenty-seventh',
  28: 'the twenty-eighth', 29: 'the twenty-ninth', 30: 'the thirtieth',
  31: 'the thirty-first',
};

function numberToOrdinalWords(day: number): string {
  return ORDINAL_WORDS[day] ?? `the ${day}th`;
}

function buildDateAsPoetry(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const day = date.getDate();
  return `${weekday}, ${numberToOrdinalWords(day)}.`;
}

// ─── Progress line ────────────────────────────────────────────────────────────

function buildProgressLine(mealsLogged: number, workoutDone: boolean): string {
  if (mealsLogged === 0 && !workoutDone) return 'A clean slate.';

  const parts: string[] = [];

  if (mealsLogged === 1) parts.push('One meal logged.');
  else if (mealsLogged === 2) parts.push('Two meals logged.');
  else if (mealsLogged === 3) parts.push('Three meals logged.');
  else if (mealsLogged > 3) parts.push(`${mealsLogged} meals logged.`);

  if (workoutDone) {
    parts.push('Workout complete.');
  } else {
    parts.push('One workout to go.');
  }

  return parts.join(' ');
}

// ─── NumberCell ────────────────────────────────────────────────────────────────

interface NumberCellProps {
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

function NumberCell({ label, value, hint, onPress, accessibilityLabel }: NumberCellProps) {
  const { semanticColors: sc } = useTheme();
  const Inner = (
    <View style={{ width: '100%', paddingVertical: 20 }}>
      <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 6 }}>
        {label}
      </Text>
      <Text style={{ ...typography.h2, color: sc.textPrimary }}>
        {value}
      </Text>
      {hint ? (
        <Text style={{ ...typography.caption, color: sc.textMuted, marginTop: 4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
        style={({ pressed }) => ({ width: '50%', opacity: pressed ? 0.7 : 1 })}
      >
        {Inner}
      </Pressable>
    );
  }
  return <View style={{ width: '50%' }}>{Inner}</View>;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { semanticColors: sc } = useTheme();
  const currentUser = useCurrentUser();
  const {
    foodLogs,
    dailyTotals,
    waterOz,
    loadDayData,
    loadProfile,
  } = useClientStore();

  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [refreshing, setRefreshing] = useState(false);

  // Stable today date
  const today = new Date();

  // Derive state
  const mealsLogged = (() => {
    const mealTypes = new Set(foodLogs.map((f) => f.mealType));
    return mealTypes.size;
  })();

  // B11: workoutDone now comes from /workouts (most recent N sessions). A
  // session with `date` in today's local calendar day satisfies the
  // "workout complete" copy. Falling back to `false` on network error so
  // the home line never claims a workout was done when we couldn't verify.
  const [workoutDone, setWorkoutDone] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    if (!currentUser) return;
    (async () => {
      try {
        const res = await workoutApi.getAll(5);
        const rows = (res.data as Array<{ date?: string; completed?: boolean }> | undefined) || [];
        const todayStr = new Date().toDateString();
        const done = rows.some((r) => {
          if (!r?.date) return false;
          const d = new Date(r.date);
          if (Number.isNaN(d.getTime())) return false;
          // A row counts when it is today AND not explicitly marked incomplete.
          return d.toDateString() === todayStr && r.completed === true;
        });
        if (!cancelled) setWorkoutDone(done);
      } catch {
        if (!cancelled) setWorkoutDone(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, refreshing]);

  const datePoetry = buildDateAsPoetry(today);
  const progressLine = buildProgressLine(mealsLogged, workoutDone);

  // Water in litres
  const waterL = waterOz > 0 ? `${(waterOz * 0.0295735).toFixed(1)}L` : '0.0L';

  // Macro display: prefer logged value; fall back to "0 of {target}g" when a
  // coach/onboarding target exists; fall back to a "Log to see" prompt only
  // when neither logged data nor a target is present. This is the contract:
  // never render a bare "—" with no path forward — Home always points the
  // user at their next action.
  const proteinTarget = currentUser?.profile?.protein_target;
  const carbsTarget   = currentUser?.profile?.carbs_target;
  const fatTarget     = currentUser?.profile?.fat_target;

  const buildMacro = (logged: number | undefined, target: number | undefined) => {
    if (logged && logged > 0) {
      return {
        value: `${Math.round(logged)}g`,
        hint: target ? `of ${Math.round(target)}g` : undefined,
        prompt: false,
      };
    }
    if (target && target > 0) {
      return { value: `0 of ${Math.round(target)}g`, hint: undefined, prompt: false };
    }
    // Dignified placeholder: an em-dash, not "Log to see". After Fix #1
    // (lean→backend wiring), this state is hit only briefly — between
    // an offline-finish of onboarding and the reconcile hook's first
    // successful PUT /profile. The cell stays pressable so the user can
    // navigate to Log and start populating data.
    return { value: '—', hint: undefined, prompt: true };
  };

  const protein = buildMacro(dailyTotals?.protein, proteinTarget);
  const carbs   = buildMacro(dailyTotals?.carbs,   carbsTarget);
  const fat     = buildMacro(dailyTotals?.fat,     fatTarget);

  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id);
      loadProfile(currentUser.id);
    }
  }, [currentUser?.id]);

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([
      loadDayData(currentUser.id),
      loadProfile(currentUser.id),
    ]);
    setRefreshing(false);
  }, [currentUser?.id]);

  const onContinue = () => {
    track('home_continue_tapped', { surface: 'home_hero' });
    // Wire to workout tab — same destination as the old HeroAction log_workout state
    navigation.navigate('WorkoutTab');
  };

  const goToLog = () => {
    track('home_macro_tapped', { surface: 'home_macro_grid' });
    navigation.navigate('Log');
  };

  const completion = getProfileCompletion(currentUser);
  const showProfileNudge = !completion.isComplete && completion.missing.length > 0;
  const missingSummary = showProfileNudge ? summarizeMissing(completion.missing) : '';

  // Fire impression once per user/session combination so we can attribute
  // cold-outbound conversion to nudge exposure later.
  useEffect(() => {
    if (showProfileNudge && currentUser?.id) {
      track('profile_nudge_shown', {
        missing_count: completion.missing.length,
        percent_complete: completion.percentComplete,
      });
    }
  }, [currentUser?.id, showProfileNudge, completion.missing.length, completion.percentComplete]);

  const goToEditProfile = () => {
    track('profile_edit_opened', { source: 'home_nudge' });
    navigation.navigate('MoreTab', { screen: 'EditProfile' });
  };

  if (!currentUser) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: sc.bgPrimary }}>
        <ActivityIndicator size="large" color={sc.textPrimary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: sc.bgPrimary }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 32, paddingTop: 64, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={sc.textPrimary}
          />
        }
      >
        <PendingInviteBanner />
        {showProfileNudge ? (
          <Pressable
            onPress={goToEditProfile}
            accessibilityRole="button"
            accessibilityLabel={`Complete your profile. Missing ${missingSummary}.`}
            style={({ pressed }) => ({
              borderWidth: 0.5,
              borderColor: sc.border,
              backgroundColor: sc.bgSurface,
              paddingHorizontal: 20,
              paddingVertical: 18,
              marginBottom: 24,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 6 }}>
              FINISH YOUR PROFILE
            </Text>
            <Text style={{ ...typography.body, color: sc.textPrimary }}>
              {`Add ${missingSummary} so your plan reflects you.`}
            </Text>
            <Text style={{ ...typography.bodySmall, color: sc.textMuted, marginTop: 6 }}>
              {`${completion.percentComplete}% complete`}
            </Text>
          </Pressable>
        ) : null}

        {/* Hero */}
        <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 24 }}>
          THE GROWTH PROJECT
        </Text>
        <Text style={{ ...typography.h1, color: sc.textPrimary, marginBottom: 20 }}>
          {datePoetry}
        </Text>
        <Text style={{ ...typography.body, color: sc.textMuted, marginBottom: 56 }}>
          {progressLine}
        </Text>

        {/* Single CTA */}
        <Pressable
          style={({ pressed }) => ({
            backgroundColor: sc.textPrimary,
            paddingVertical: 20,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityHint="Opens your workout tracker"
        >
          <Text style={{ ...typography.eyebrow, color: sc.bgPrimary }}>CONTINUE</Text>
        </Pressable>

        {/* Below-fold rule + 2×2 numbers grid */}
        <View style={{ height: 1, backgroundColor: sc.border, marginTop: 96, marginBottom: 32 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <NumberCell
            label="PROTEIN"
            value={protein.value}
            hint={protein.hint}
            onPress={protein.prompt ? goToLog : undefined}
            accessibilityLabel={
              protein.prompt
                ? 'Log a meal to see your protein'
                : `Protein: ${protein.value}${protein.hint ? `, ${protein.hint}` : ''}`
            }
          />
          <NumberCell
            label="CARBS"
            value={carbs.value}
            hint={carbs.hint}
            onPress={carbs.prompt ? goToLog : undefined}
            accessibilityLabel={
              carbs.prompt
                ? 'Log a meal to see your carbs'
                : `Carbs: ${carbs.value}${carbs.hint ? `, ${carbs.hint}` : ''}`
            }
          />
          <NumberCell
            label="FAT"
            value={fat.value}
            hint={fat.hint}
            onPress={fat.prompt ? goToLog : undefined}
            accessibilityLabel={
              fat.prompt
                ? 'Log a meal to see your fat'
                : `Fat: ${fat.value}${fat.hint ? `, ${fat.hint}` : ''}`
            }
          />
          <NumberCell label="WATER" value={waterL} />
        </View>
        {/* Sprint B-2 — cross-pillar holistic insights tile. Rendered
            below the macro numbers; quietly returns null while loading
            and renders honest empty-state copy when there is not yet
            enough data or the finance pillar is unavailable. */}
        <HolisticInsightsTile />
      </ScrollView>
    </SafeAreaView>
  );
}

