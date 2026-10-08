import { useCallback, useEffect, useRef, useState } from 'react';
import { coachApi } from '../../../services/api';
import { errorMessage } from '../../../types/common';
import { bucketDateLocal, getTodayString } from '../../../utils/date';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientProfile, FoodLog, WeightLog } from '../../../types';
import {
  normaliseServerPlans,
  type CoachMealPlan,
  type TimelineEvent,
  type WeekSummary,
  type WorkoutSession,
} from './types';
import { mapCoachWorkoutSessions, workoutTimelineSubtitle } from '../../../utils/workout/workoutLogging';

export function useClientDetailData(clientId: string, colors: ThemeColors) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [foodShared, setFoodShared] = useState(true);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Mirror `refreshing` into a ref so loadData can read the latest value
  // without listing it as a useCallback dep. Including it in deps re-identifies
  // loadData on every pull-to-refresh tick, which refires the screen's
  // [clientId, loadData] effect and produces 2–3x duplicate fetches.
  const refreshingRef = useRef(refreshing);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  const [isArchived, setIsArchived] = useState(false);

  const [serverMealPlans, setServerMealPlans] = useState<CoachMealPlan[]>([]);
  const [mealPlansLoading, setMealPlansLoading] = useState(false);
  const [mealPlansError, setMealPlansError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      if (!refreshingRef.current) setIsLoading(true);
      setLoadError(null);
      const today = getTodayString();

      const res = await coachApi.getClientSummary(clientId, today);
      const data = res.data;
      if (data.error) return;
      setFoodShared(data.consent?.food_macros !== false);
      // Reflect archived status from summary (client.archived_at)
      if (data.client) setIsArchived(!!data.client.archived_at);

      // Set profile
      setProfile(data.profile ? {
        ...data.profile,
        name: data.client_name,
      } : null);

      // Set food logs (map API response to expected shape)
      type Entry = {
        id: string;
        food_item?: { name?: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
        quantity_multiplier?: number;
        meal_type?: string;
      };
      const logs = ((data.today?.entries as Entry[] | undefined) || []).map((e) => ({
        id: e.id,
        foodName: e.food_item?.name || '',
        calories: Math.round((e.food_item?.calories || 0) * (e.quantity_multiplier || 1)),
        protein: Math.round((e.food_item?.protein_g || 0) * (e.quantity_multiplier || 1)),
        carbs: Math.round((e.food_item?.carbs_g || 0) * (e.quantity_multiplier || 1)),
        fat: Math.round((e.food_item?.fat_g || 0) * (e.quantity_multiplier || 1)),
        mealType: e.meal_type,
        date: today,
      }));
      // Display-only projection — the full FoodLog shape (userId, coachId,
      // etc.) is not needed by ClientDetailScreen's read-only meal list.
      setFoodLogs(logs as unknown as FoodLog[]);

      // Set totals
      setTotals({
        calories: data.today?.total_calories || 0,
        protein: data.today?.total_protein_g || 0,
        carbs: data.today?.total_carbs_g || 0,
        fat: data.today?.total_fat_g || 0,
      });

      // Weight logs
      type WeightRow = { id: string; weight_lbs: number; date: string | number; notes?: string };
      const weights = ((data.weight_logs as WeightRow[] | undefined) || []).map((w) => ({
        id: w.id,
        weight: w.weight_lbs,
        unit: 'lbs',
        date: typeof w.date === 'string' ? w.date.slice(0, 10) : bucketDateLocal(new Date(w.date)),
        notes: w.notes || '',
      }));
      setWeightLogs(weights as unknown as WeightLog[]);

      // Workout sessions. The server sends WorkoutSession rows
      // (workout_name, created_at, duration_minutes, exercises[] with
      // weight_per_set / reps_per_set). The mapping used to read name /
      // completed_at / sets_data, which do not exist, so the coach saw every
      // client workout as "Workout", "In progress", 0/0 sets and 0 lbs.
      setWorkoutSessions(
        mapCoachWorkoutSessions(data.recent_workouts) as unknown as WorkoutSession[],
      );

    } catch (err) {
      // If we have no profile yet, expose the failure so the screen can render
      // an explicit error/retry block instead of leaving the user staring at
      // the skeleton header forever.
      console.error('ClientDetailScreen: load failed', err);
      setLoadError(errorMessage(err, 'Could not load this client. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  const loadServerMealPlans = useCallback(async () => {
    setMealPlansLoading(true);
    setMealPlansError(null);
    try {
      const res = await coachApi.listClientMealPlans(clientId);
      setServerMealPlans(normaliseServerPlans(res.data));
    } catch (err) {
      console.error('ClientDetailScreen: listClientMealPlans failed', err);
      setMealPlansError(errorMessage(err, 'Could not load meal plans.'));
    } finally {
      setMealPlansLoading(false);
    }
  }, [clientId]);

  const loadTimeline = useCallback(async (selectedDays: 7 | 30 | 90) => {
    try {
      const res = await coachApi.getClientTimeline(clientId, selectedDays);
      const data = res.data;
      if (data.error) return;

      const events: TimelineEvent[] = [];

      // Food events grouped by date
      const mealsByDate = new Map<string, { count: number; totalCals: number }>();
      for (const meal of (data.meals || [])) {
        const dateStr = (meal.date || meal.logged_at || '').slice(0, 10);
        if (!dateStr) continue;
        const existing = mealsByDate.get(dateStr) || { count: 0, totalCals: 0 };
        existing.count += 1;
        existing.totalCals += (meal.food_item?.calories || 0) * (meal.quantity_multiplier || 1);
        mealsByDate.set(dateStr, existing);
      }
      for (const [dateStr, info] of mealsByDate) {
        events.push({
          id: `food_${dateStr}`,
          type: 'food',
          title: `${info.count} meals logged`,
          subtitle: `${Math.round(info.totalCals)} kcal total`,
          date: dateStr + 'T12:00:00',
          icon: 'restaurant',
          iconColor: colors.primary,
        });
      }

      // Weight events
      for (const w of (data.weights || [])) {
        const dateStr = (w.date || '').slice(0, 10);
        events.push({
          id: `weight_${w.id}`,
          type: 'weight',
          title: `Weight: ${w.weight_lbs} lbs`,
          subtitle: w.notes || 'Weight logged',
          date: dateStr + 'T08:00:00',
          icon: 'scale',
          iconColor: colors.info,
        });
      }

      // Workout events
      for (const s of (data.workouts || [])) {
        events.push({
          id: `workout_${s.id}`,
          type: 'workout',
          // WorkoutSession rows carry workout_name (no name / completed_at).
          title: s.workout_name || s.name || 'Workout',
          // FU-WORKLOG2-126: what was done, not "Logged" on every row.
          subtitle: workoutTimelineSubtitle(s),
          date: s.created_at || s.date,
          icon: 'barbell',
          iconColor: colors.primaryDark, // Round 3: hex → token (workout event icon)
        });
      }

      // Check-in events
      for (const c of (data.checkIns || [])) {
        events.push({
          id: `checkin_${c.id}`,
          type: 'checkin',
          title: 'Check-in',
          // CheckIn rows carry `mood` (1-5, optional) and an ISO `date`
          // ("YYYY-MM-DDT00:00:00.000Z"): `mood_rating` read undefined and
          // appending a time to the ISO string made an Invalid Date.
          subtitle: checkInSubtitle(c),
          date: String(c.date || '').slice(0, 10) + 'T09:00:00',
          icon: 'chatbubble-ellipses',
          iconColor: colors.primary,
          checkIn: {
            id: String(c.id),
            coachId: typeof c.coach_id === 'string' ? c.coach_id : null,
            reviewed: c.reviewed_by_coach === true,
          },
        });
      }

      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimeline(events);
    } catch (err) {
      // Timeline is a read-only aggregate — empty state is acceptable here.
      console.error('ClientDetailScreen: loadTimeline failed', err);
    }
  }, [clientId, colors]);

  // Coach marks one check-in reviewed. The Timeline row flips to "Reviewed"
  // and the Clients list "N to review" count drops on its next load.
  const markCheckInReviewed = useCallback(async (checkInId: string) => {
    await coachApi.markCheckInReviewed(clientId, checkInId);
    setTimeline((prev) =>
      prev.map((e) =>
        e.checkIn && e.checkIn.id === checkInId
          ? { ...e, checkIn: { ...e.checkIn, reviewed: true } }
          : e,
      ),
    );
  }, [clientId]);

  // ── Weekly Summary ────────────────────────────────────────────────────────────
  const loadWeeklySummaries = useCallback(async (selectedDays: 7 | 30 | 90) => {
    try {
      // Use the backend API to get timeline data for the selected period
      const res = await coachApi.getClientTimeline(clientId, selectedDays);
      const data = res.data;

      if (data.error) return;

      const { meals, workouts, weights } = data;

      // Helper: get Monday of the week for a given date string
      const getMondayOf = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return bucketDateLocal(d);
      };

      const getSundayOf = (mondayStr: string): string => {
        const d = new Date(mondayStr + 'T00:00:00');
        d.setDate(d.getDate() + 6);
        return bucketDateLocal(d);
      };

      const formatWeekLabel = (startStr: string, endStr: string): string => {
        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${fmt(start)} – ${fmt(end)}`;
      };

      // Build a map of weekStart -> WeekSummary
      const weekMap = new Map<string, WeekSummary>();

      const ensureWeek = (dateStr: string): WeekSummary => {
        const monday = getMondayOf(dateStr);
        if (!weekMap.has(monday)) {
          const sunday = getSundayOf(monday);
          weekMap.set(monday, {
            weekStart: monday,
            weekEnd: sunday,
            weekLabel: formatWeekLabel(monday, sunday),
            totalCalories: 0,
            totalProtein: 0,
            totalWeightMoved: 0,
            latestWeight: null,
            workoutCount: 0,
          });
        }
        return weekMap.get(monday)!;
      };

      // Aggregate food logs
      if (Array.isArray(meals)) {
        for (const meal of meals) {
          const dateStr = (meal.date || meal.logged_at || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          const quantity = meal.quantity_multiplier ?? 1;
          week.totalCalories += (meal.food_item?.calories || 0) * quantity;
          week.totalProtein += (meal.food_item?.protein_g || 0) * quantity;
        }
      }

      // Aggregate workout sessions
      if (Array.isArray(workouts)) {
        for (const session of workouts) {
          const dateStr = (session.created_at || session.date || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          week.workoutCount += 1;
          // Saved workouts carry only recorded sets in these parallel arrays.
          if (Array.isArray(session.exercises)) {
            for (const ex of session.exercises) {
              const weights = ex.weight_per_set || [];
              const reps = ex.reps_per_set || [];
              for (let i = 0; i < weights.length; i++) {
                week.totalWeightMoved += (weights[i] || 0) * (reps[i] || 0);
              }
            }
          }
        }
      }

      // Latest weight per week
      if (Array.isArray(weights)) {
        for (const w of weights) {
          const dateStr = (w.date || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          // weights are ordered desc, so first one per week is the latest
          if (week.latestWeight === null) {
            week.latestWeight = w.weight_lbs || w.weight || null;
          }
        }
      }

      // Sort weeks newest first
      const sorted = Array.from(weekMap.values()).sort(
        (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
      );

      setWeekSummaries(sorted);
    } catch (err) {
      // Read-only summary aggregation — partial state is acceptable.
      console.error('ClientDetailScreen: loadWeeklySummaries failed', err);
    }
  }, [clientId]);

  return {
    profile,
    foodLogs,
    totals,
    foodShared,
    weightLogs,
    workoutSessions,
    timeline,
    weekSummaries,
    isLoading,
    loadError,
    refreshing,
    isArchived,
    setIsArchived,
    setTimeline,
    setWeekSummaries,
    setRefreshing,
    serverMealPlans,
    mealPlansLoading,
    mealPlansError,
    loadData,
    loadServerMealPlans,
    loadTimeline,
    loadWeeklySummaries,
    markCheckInReviewed,
  };
}

/** Coach timeline line for one check-in: the client's note, else the scores. */
export function checkInSubtitle(c: {
  notes?: string | null;
  mood?: number | null;
  energy?: number | null;
  sleep_hours?: number | null;
}): string {
  if (c.notes) return c.notes;
  const parts: string[] = [];
  if (typeof c.mood === 'number') parts.push(`Mood ${c.mood}/5`);
  if (typeof c.energy === 'number') parts.push(`Energy ${c.energy}/5`);
  if (typeof c.sleep_hours === 'number') parts.push(`Sleep ${c.sleep_hours} h`);
  return parts.length > 0 ? parts.join(' · ') : 'Check-in submitted';
}
