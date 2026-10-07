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
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMacroTargets } from '../../hooks/useMacroTargets';
import { useClientStore } from '../../store/clientStore';
import { track } from '../../lib/analytics';
import { typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
// Sprint B-2 — cross-pillar holistic insights tile (component shipped
// in PR #130; this PR places it on HomeScreen).
import HolisticInsightsTile from '../../components/home/HolisticInsightsTile';
import PendingInviteBanner from '../../components/PendingInviteBanner';
import { DunningBanner } from '../../entitlements/dunning/DunningBanner';
import HomeHeaderActions from '../../components/home/HomeHeaderActions';
import PushPermissionCard from '../../components/home/PushPermissionCard';
import CoachIntroductionBanner from '../../components/home/CoachIntroductionBanner';
// A1-COACHLESS: banner, code sheet and scripted Roman card for a client with
// no coach. Renders nothing unless the server flag coachless_home is on.
import CoachlessHomeSlot from '../../components/coachless/CoachlessHomeSlot';
// Clinic tutorial (C08/C09): pinned macro card, Message your coach row and the
// passive re-offer line. Renders nothing unless featureFlags.clientTutorial.
import TutorialHomeSlot from '../../components/tutorial/TutorialHomeSlot';
// Lighter start for never-trackers (clinic contract v1 addition 8): the
// grid shows calories and protein only while the macro display mode is
// 'simple', and a one-time Roman card introduces carbohydrate and fat when
// the simple week ends. 'full' (the existing grid) when the backend is silent.
import FullMacrosIntroCard from '../../components/home/FullMacrosIntroCard';
import { useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { homeCells, type HomeCell } from '../../macros/macroDisplay';
import { workoutApi } from '../../services/api';
import { workoutBuilderApi } from '../../api/workoutBuilderApi';
import { loadActiveWorkoutSession } from '../../storage/activeWorkoutSession';
import {
  getProfileCompletion,
  summarizeMissing,
} from '../../lib/profileCompletion';
import { getTodayString } from '../../utils/date';
import { isWorkoutDoneToday, type WorkoutRowLike } from '../../utils/workout/workoutDoneToday';
import CoachErrorState from '../../components/community/coach/CoachErrorState';

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

function buildProgressLine(mealsLogged: number, workoutDone: boolean, planName: string | null, inProgress: boolean): string {

  const parts: string[] = [];

  if (mealsLogged === 1) parts.push('One meal logged.');
  else if (mealsLogged === 2) parts.push('Two meals logged.');
  else if (mealsLogged === 3) parts.push('Three meals logged.');
  else if (mealsLogged > 3) parts.push(`${mealsLogged} meals logged.`);

  if (inProgress) {
    parts.push('A workout is in progress.');
  } else if (workoutDone) {
    parts.push('Workout complete.');
  } else if (planName) {
    parts.push(`${planName} is ready.`);
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
    selectedDate,
    isLoading,
    loadError,
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
  const [pendingPlanName, setPendingPlanName] = useState<string | null>(null);
  const [hasCoachPlan, setHasCoachPlan] = useState(false);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  // History or a pending coach assignment makes Continue useful. Only show
  // Explore once both reads confirm empty; a failed read keeps workouts reachable.
  const [workoutExists, setWorkoutExists] = useState<boolean | 'loading'>('loading');
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!currentUser) return;
    setWorkoutExists('loading');
    (async () => {
      try {
        const [history, assignments, active] = await Promise.allSettled([
          workoutApi.getAll(5),
          workoutBuilderApi.listMyAssignments(),
          loadActiveWorkoutSession(currentUser.id),
        ]);
        const rows = history.status === 'fulfilled'
          ? (history.value.data as WorkoutRowLike[] | undefined) || []
          : [];
        const done = isWorkoutDoneToday(rows, getTodayString());
        const pending = assignments.status === 'fulfilled'
          ? assignments.value.find((assignment) => !assignment.completed_at) : undefined;
        if (!cancelled) {
          setWorkoutDone(done);
          setPendingPlanName(pending?.workout_plan?.name?.trim() || null);
          setHasCoachPlan(assignments.status === 'fulfilled' && assignments.value.some((assignment) => !!assignment.workout_plan));
          setWorkoutInProgress(active.status === 'fulfilled' && !!active.value);
          setWorkoutExists(
            rows.length > 0 || !!pending
            || history.status === 'rejected' || assignments.status === 'rejected',
          );
        }
      } catch {
        if (!cancelled) {
          setWorkoutDone(false);
          // On error, assume workouts exist so we don’t hide the CTA unnecessarily
          setWorkoutExists(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, refreshing]));

  const datePoetry = buildDateAsPoetry(today);
  const progressLine = buildProgressLine(mealsLogged, workoutDone, pendingPlanName, workoutInProgress);
  const workoutLabel = workoutInProgress ? 'Resume workout' : !workoutDone && pendingPlanName ? `Start ${pendingPlanName}` : 'Open Train';

  // Same unit and logged value as the Food Log.
  const waterValue = `${waterOz} oz`;

  // Macro display: prefer logged value; fall back to "0 of {target}g" when a
  // coach/onboarding target exists; fall back to a "Log to see" prompt only
  // when neither logged data nor a target is present. This is the contract:
  // never render a bare "—" with no path forward — Home always points the
  // user at their next action.
  // Same targets as the Food Log goal line (GET /me/macros/current); the cached
  // profile numbers only cover the first paint.
  const macroTargets = useMacroTargets();
  const proteinTarget = macroTargets?.protein ?? currentUser?.profile?.protein_target;
  const carbsTarget   = macroTargets?.carbs ?? currentUser?.profile?.carbs_target;
  const fatTarget     = macroTargets?.fat ?? currentUser?.profile?.fat_target;

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

  const macroMode = useMacroDisplayMode(currentUser?.id ?? null);
  const calorieTarget = macroTargets?.calories ?? currentUser?.profile?.calorie_target;
  const calories = (() => {
    const logged = dailyTotals?.calories;
    if (logged && logged > 0) {
      return {
        value: `${Math.round(logged)}`,
        hint: calorieTarget ? `of ${Math.round(calorieTarget)} kcal` : 'kcal',
        prompt: false,
      };
    }
    if (calorieTarget && calorieTarget > 0) {
      return { value: '0', hint: `of ${Math.round(calorieTarget)} kcal`, prompt: false };
    }
    return { value: '—', hint: undefined, prompt: true };
  })();
  const macroCells = { CALORIES: calories, PROTEIN: protein, CARBS: carbs, FAT: fat };

  // Home always shows today, even after the Food Log (shared store) moved to another day.
  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id, getTodayString());
      loadProfile(currentUser.id);
    }
  }, [currentUser?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentUser && selectedDate && selectedDate !== getTodayString()) {
        void loadDayData(currentUser.id, getTodayString());
      }
    }, [currentUser?.id, selectedDate]),
  );

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([
      loadDayData(currentUser.id, getTodayString()),
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
    return <SkeletonScreen />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: sc.bgPrimary }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 32, paddingTop: 64, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            testID="home-refresh-control"
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={sc.textPrimary}
          />
        }
      >
        <HomeHeaderActions />
        {loadError ? (
          <CoachErrorState
            message={loadError}
            onRetry={() => void onRefresh()}
            retrying={isLoading || refreshing}
            testID="home-day-data-error"
          />
        ) : null}
        <DunningBanner surface="HomeScreen" />
        <CoachlessHomeSlot />
        <PendingInviteBanner />
        <PushPermissionCard />
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
              {hasCoachPlan ? `Add ${missingSummary} so your plan reflects you.` : `Add ${missingSummary} to set daily targets.`}
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

        {/* Coach introduction banner — shown once, dismissible */}
        <CoachIntroductionBanner />

        <FullMacrosIntroCard carbsG={carbsTarget} fatG={fatTarget} />

        <TutorialHomeSlot />

        {/* Single CTA — conditional on whether workouts exist */}
        {workoutExists === 'loading' ? (
          // Skeleton placeholder while loading — no ActivityIndicator
          <View
            style={{
              height: 60,
              backgroundColor: sc.bgSurface,
              borderRadius: 2,
            }}
            testID="cta-skeleton"
          />
        ) : workoutExists ? (
          <Pressable
            style={({ pressed }) => ({
              backgroundColor: sc.textPrimary,
              paddingVertical: 20,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel={workoutLabel}
            accessibilityHint="Opens Train"
            testID="home-continue-cta"
          >
            <Text style={{ ...typography.eyebrow, color: sc.bgPrimary }}>{workoutLabel}</Text>
          </Pressable>
        ) : (
          // No workout assigned yet — soft explore link instead of disabled CTA
          <Pressable
            onPress={() => navigation.navigate('Log')}
            accessibilityRole="button"
            accessibilityLabel="Log a meal"
            testID="home-explore-cta"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
          >
            <Text style={{ ...typography.body, color: sc.textMuted }}>Log a meal →</Text>
          </Pressable>
        )}

        {/* Below-fold rule + 2×2 numbers grid */}
        <View style={{ height: 1, backgroundColor: sc.border, marginTop: 96, marginBottom: 32 }} />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap' }}
          testID={macroMode === 'simple' ? 'home-number-grid-simple' : 'home-number-grid'}
        >
          {homeCells(macroMode).map((cell: HomeCell) => {
            if (cell === 'WATER') return <NumberCell key={cell} label="WATER" value={waterValue} />;
            const m = macroCells[cell];
            const word = cell.toLowerCase();
            const title = word.charAt(0).toUpperCase() + word.slice(1);
            return (
              <NumberCell
                key={cell}
                label={cell}
                value={m.value}
                hint={m.hint}
                onPress={m.prompt ? goToLog : undefined}
                accessibilityLabel={
                  m.prompt
                    ? `Log a meal to see your ${word}`
                    : `${title}: ${m.value}${m.hint ? `, ${m.hint}` : ''}`
                }
              />
            );
          })}
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
