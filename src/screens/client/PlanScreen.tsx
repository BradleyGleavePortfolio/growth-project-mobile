import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { radius, typography, type SemanticTokens } from '../../theme/tokens';
import { SafeAreaView } from 'react-native-safe-area-context';
import FadeInView from '../../components/FadeInView';
import HapticPressable from '../../components/HapticPressable';
import LogPlannedMealButton, { plannedMealFromFoods } from '../../components/mealplan/LogPlannedMealButton';
import { mealPlansApi } from '../../services/api';
import {
  mealTemplatesApi,
  type ClientTodayResponse,
  type DailyMealPlanAssignmentWithPlan,
  type SlotLabel,
} from '../../api/mealTemplatesApi';
import { useTheme } from '../../theme/ThemeProvider';
import { type JsonRecord } from '../../types/common';

// ── Types ─────────────────────────────────────────────────────────────────
//
// The server shape is whatever the backend returns — it may nest items or
// return a flat array of { name, calories?, protein?, notes?, time_of_day? }.
// We read it defensively and fall back to an empty list when fields are
// missing so a malformed plan never blanks the screen.
//
// H2 fix: when the server returns `days` (AI-generated plans), we render
// meals grouped by day. Legacy plans without `days` continue to use the
// flat `items` + `groupItems()` path.

interface MealItem {
  name: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  notes?: string | null;
  time_of_day?: string | null;
}

// Structured per-day shape stored in MealPlan.days (AI plans only).
interface MealDayItem {
  name: string;
  serving?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}
interface MealDayMeal {
  slot: string;
  items: MealDayItem[];
}
interface MealDay {
  day: number;
  meals: MealDayMeal[];
  daily_totals?: {
    calories?: number | null;
    protein_g?: number | null;
  } | null;
}

interface MealPlan {
  id: string;
  title: string;
  notes?: string | null;
  items: MealItem[];
  // Present only for AI-generated plans (H2 fix).
  days?: MealDay[] | null;
  created_at?: string | null;
  // Canonical DailyMealPlan id when this row is a canonical plan (today
  // response, or the `/meal-plans` fallback row marked
  // `source: 'real-meal-plans'`); null for genuine legacy rows. Used to
  // show a canonical plan once when both sources return it.
  canonical_plan_id?: string | null;
}

const CANONICAL_ID_PREFIX = 'canonical:';

const TIME_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

function groupItems(items: MealItem[]): { key: string; label: string; rows: MealItem[] }[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const buckets = new Map<string, MealItem[]>();
  for (const it of items) {
    const key = (it.time_of_day || '').toLowerCase().trim() || 'other';
    const arr = buckets.get(key) || [];
    arr.push(it);
    buckets.set(key, arr);
  }
  const ordered: { key: string; label: string; rows: MealItem[] }[] = [];
  for (const k of TIME_ORDER) {
    if (buckets.has(k)) {
      ordered.push({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), rows: buckets.get(k)! });
      buckets.delete(k);
    }
  }
  for (const [k, rows] of buckets) {
    ordered.push({ key: k, label: k === 'other' ? 'Other' : k.charAt(0).toUpperCase() + k.slice(1), rows });
  }
  return ordered;
}

// Normalise whatever the backend returns into a MealPlan[]. Handles both
// `{ plans: [...] }` and bare arrays; tolerates camelCase or snake_case keys
// on items. When the backend returns a `days` field (AI plans, H2 fix), it
// is preserved so the render path can group by day.
function normalisePlans(payload: unknown): MealPlan[] {
  const root = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? (payload as JsonRecord)
    : null;
  const raw: JsonRecord[] = Array.isArray(payload)
    ? (payload as JsonRecord[])
    : Array.isArray(root?.plans)
      ? (root.plans as JsonRecord[])
      : Array.isArray(root?.meal_plans)
        ? (root.meal_plans as JsonRecord[])
        : [];
  return raw.map((p) => {
    // The `/meal-plans` canonical fallback row carries the assignment's
    // effective start in `created_at` and the plan's real creation time in
    // `updated_at` (backend meal-plans.service.ts, `source:
    // 'real-meal-plans'`). Only a real creation time is labelled Created.
    const isCanonicalFallback = p.source === 'real-meal-plans';
    const rawId = String(p.id);
    const itemsRaw: JsonRecord[] = Array.isArray(p.items)
      ? (p.items as JsonRecord[])
      : Array.isArray(p.meal_items)
        ? (p.meal_items as JsonRecord[])
        : [];
    const items: MealItem[] = itemsRaw.map((it) => ({
      name: typeof it.name === 'string' ? it.name : '',
      calories: (it.calories as number | null | undefined) ?? (it.kcal as number | null | undefined) ?? null,
      protein: (it.protein as number | null | undefined) ?? (it.protein_g as number | null | undefined) ?? null,
      notes: (it.notes as string | null | undefined) ?? null,
      time_of_day: (it.time_of_day as string | null | undefined) ?? (it.timeOfDay as string | null | undefined) ?? null,
    }));
    // H2: read structured days[] when present (AI-generated plans).
    const daysRaw = Array.isArray(p.days) ? (p.days as JsonRecord[]) : null;
    const days: MealDay[] | null = daysRaw
      ? daysRaw.map((d) => ({
          day: typeof d.day === 'number' ? d.day : 1,
          meals: Array.isArray(d.meals)
            ? (d.meals as JsonRecord[]).map((m) => ({
                slot: typeof m.slot === 'string' ? m.slot : 'meal',
                items: Array.isArray(m.items)
                  ? (m.items as JsonRecord[]).map((it) => ({
                      name: typeof it.name === 'string' ? it.name : '',
                      serving: (it.serving as string | null | undefined) ?? null,
                      calories: (it.calories as number | null | undefined) ?? null,
                      protein_g: (it.protein_g as number | null | undefined) ?? null,
                      carbs_g: (it.carbs_g as number | null | undefined) ?? null,
                      fat_g: (it.fat_g as number | null | undefined) ?? null,
                    }))
                  : [],
              }))
            : [],
          daily_totals: d.daily_totals && typeof d.daily_totals === 'object'
            ? {
                calories: ((d.daily_totals as JsonRecord).calories as number | null | undefined) ?? null,
                protein_g: ((d.daily_totals as JsonRecord).protein_g as number | null | undefined) ?? null,
              }
            : null,
        }))
      : null;
    return {
      id: rawId,
      title: typeof p.title === 'string' && p.title ? p.title : 'Meal plan',
      notes: (p.notes as string | null | undefined) ?? null,
      items,
      days,
      created_at: isCanonicalFallback
        ? (p.updated_at as string | null | undefined) ?? null
        : (p.created_at as string | null | undefined) ?? (p.createdAt as string | null | undefined) ?? null,
      canonical_plan_id: isCanonicalFallback && rawId.startsWith(CANONICAL_ID_PREFIX)
        ? rawId.slice(CANONICAL_ID_PREFIX.length)
        : null,
    };
  });
}

// Adapter: convert a Sprint-B `ClientTodayResponse` (slot-grouped server
// payload) into the same `MealPlan[]` shape this screen already renders.
// Doing the adaptation here — rather than diverging the render path —
// means one screen, one render tree, and a coach who pushes a plan via
// EITHER the Sprint-A `/meal-plans` endpoint or the Sprint-B
// `/me/meal-plan/today` endpoint shows up identically to the client.
function todayAssignmentsToPlans(today: ClientTodayResponse): MealPlan[] {
  if (!today || !Array.isArray(today.assignments) || today.assignments.length === 0) {
    return [];
  }
  // Sort by starts_on DESC defensively — the API does not document the
  // ordering, so the client picks the most-recent first.
  const sorted = [...today.assignments].sort((a, b) =>
    a.starts_on < b.starts_on ? 1 : a.starts_on > b.starts_on ? -1 : 0,
  );
  return sorted.map((assignment) => assignmentToMealPlan(assignment));
}

function assignmentToMealPlan(
  assignment: DailyMealPlanAssignmentWithPlan,
): MealPlan {
  const slotToTimeOfDay = (slot: SlotLabel): string => {
    switch (slot) {
      case 'preworkout':
        return 'pre-workout';
      case 'postworkout':
        return 'post-workout';
      default:
        return slot;
    }
  };
  const slots = [...assignment.daily_meal_plan.slots].sort(
    (a, b) => a.order - b.order,
  );
  const items: MealItem[] = slots.map((s) => ({
    name: s.meal_template.name,
    calories: s.meal_template.calories_kcal,
    protein: s.meal_template.protein_g,
    carbs: s.meal_template.carbs_g,
    fat: s.meal_template.fats_g,
    notes: s.meal_template.description,
    time_of_day: slotToTimeOfDay(s.slot_label),
  }));
  return {
    id: `today-${assignment.id}`,
    title: `Today · ${assignment.daily_meal_plan.name}`,
    notes: assignment.daily_meal_plan.notes,
    items,
    days: null,
    created_at: assignment.daily_meal_plan.created_at,
    canonical_plan_id: assignment.daily_meal_plan.id,
  };
}

export default function PlanScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [plans, setPlans] = useState<MealPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    try {
      // P0-1 unification: read from BOTH the legacy Sprint-A `/meal-plans`
      // surface AND the canonical Sprint-B `/me/meal-plan/today` surface so
      // a coach who assigned a plan via either path shows up here. Whichever
      // request fails alone is tolerated — we merge what we have and warn.
      const [legacyRes, todayRes] = await Promise.allSettled([
        mealPlansApi.list(),
        mealTemplatesApi.todayForClient(),
      ]);

      const todayPlans =
        todayRes.status === 'fulfilled' ? todayAssignmentsToPlans(todayRes.value.data) : [];
      // `/meal-plans` also returns the newest canonical plan; when today's
      // response already shows that same plan, keep only the today row.
      const todayPlanIds = new Set(todayPlans.map((p) => p.canonical_plan_id));
      const legacyPlans = (
        legacyRes.status === 'fulfilled' ? normalisePlans(legacyRes.value.data) : []
      ).filter((p) => !p.canonical_plan_id || !todayPlanIds.has(p.canonical_plan_id));

      // Sprint-B today assignment goes first — it's the most actionable view
      // for the client right now.
      const merged: MealPlan[] = [...todayPlans, ...legacyPlans];

      // Surface an error banner only if BOTH sources failed; one missing is
      // not user-visible because the other still rendered.
      if (legacyRes.status === 'rejected' && todayRes.status === 'rejected') {
        console.error(
          'PlanScreen: both meal-plan sources failed',
          legacyRes.reason,
          todayRes.reason,
        );
        setError('Could not load your meal plans. Pull to retry.');
        if (plans === null) setPlans([]);
      } else {
        if (legacyRes.status === 'rejected') {
          console.warn('PlanScreen: legacy mealPlansApi.list failed', legacyRes.reason);
        }
        if (todayRes.status === 'rejected') {
          console.warn('PlanScreen: mealTemplatesApi.todayForClient failed', todayRes.reason);
        }
        setPlans(merged);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, [plans]);

  // Hold the latest `loadPlans` in a ref so callbacks with stable `[]` deps
  // always call the freshest closure. Without this, `useFocusEffect` below
  // would capture the very first `loadPlans` (where `plans === null`) and
  // on every later focus the `if (plans === null) setPlans([])` branch could
  // blank prior data after a dual-source failure. R31/audit-P1 stale-closure.
  const loadPlansRef = useRef(loadPlans);
  useEffect(() => {
    loadPlansRef.current = loadPlans;
  }, [loadPlans]);

  useEffect(() => {
    loadPlansRef.current();
  }, []);

  // Refetch on focus so coach-side changes show up without a full reload.
  useFocusEffect(
    useCallback(() => {
      loadPlansRef.current();
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPlans();
    setRefreshing(false);
  }, [loadPlans]);

  if (loading && plans === null) {
    return <SkeletonScreen count={6} />;
  }

  const hasPlans = (plans?.length || 0) > 0;

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl testID="meal-plan-refresh" refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        <FadeInView>
          <View style={styles.header}>
            <View>
              <Text style={styles.subtitle}>MEAL PLAN</Text>
              <Text style={styles.title}>Your meal plan</Text>
            </View>
          </View>
        </FadeInView>

        {error && (
          <View style={styles.errorBanner} accessibilityLiveRegion="polite">
            <Ionicons name="cloud-offline-outline" size={16} color={colors.textMuted} />
            <Text style={styles.errorText}>{error}</Text>
            <HapticPressable onPress={onRefresh} disabled={refreshing} accessibilityRole="button"
              accessibilityLabel="Try again" style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </HapticPressable>
          </View>
        )}

        {!hasPlans ? (
          !error && <FadeInView>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No meal plans to show.
              </Text>
              <Text style={styles.emptyBody}>
                Pull to check for assigned meals.
              </Text>
            </View>
          </FadeInView>
        ) : (
          <View style={styles.planList}>
            {plans!.map((plan, index) => {
              // H2: prefer structured per-day rendering when days[] is available.
              const hasDays = Array.isArray(plan.days) && plan.days.length > 0;
              const groups = hasDays ? [] : groupItems(plan.items);
              const totalCals = hasDays
                ? 0
                : plan.items.reduce((s, it) => s + (Number(it.calories) || 0), 0);
              const totalProtein = hasDays
                ? 0
                : plan.items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
              const hasTotalCals = totalCals > 0 && plan.items.every((it) => it.calories != null);
              const hasTotalProtein = totalProtein > 0 && plan.items.every((it) => it.protein != null);
              return (
                <FadeInView key={plan.id}>
                  <View style={styles.planCard}>
                    <View style={styles.planHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={index === 0 ? styles.planHero : styles.planTitle}>{plan.title}</Text>
                        {plan.created_at && (
                          <Text style={styles.planMeta}>
                            Created {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                        {hasDays && (
                          <Text style={styles.planMeta}>
                            {plan.days!.length}-day program
                          </Text>
                        )}
                      </View>
                    </View>

                    {plan.notes ? (
                      <View style={styles.notesBox}>
                        <Text style={styles.notesText}>{plan.notes}</Text>
                      </View>
                    ) : null}

                    {hasDays ? (
                      // Per-day rendering for AI-generated plans.
                      plan.days!.map((dayData) => (
                        <View key={`day-${dayData.day}`} style={styles.daySection}>
                          <View style={styles.dayHeaderRow}>
                            <Text style={styles.dayLabel}>Day {dayData.day}</Text>
                            {dayData.daily_totals && (
                              <Text style={styles.dayTotals}>
                                {dayData.daily_totals.calories != null
                                  ? `${Math.round(dayData.daily_totals.calories)} kcal`
                                  : ''}
                                {dayData.daily_totals.calories != null &&
                                dayData.daily_totals.protein_g != null
                                  ? ' · '
                                  : ''}
                                {dayData.daily_totals.protein_g != null
                                  ? `P ${Math.round(dayData.daily_totals.protein_g)}g`
                                  : ''}
                              </Text>
                            )}
                          </View>
                          {dayData.meals.map((meal, mIdx) => (
                            <View key={mIdx} style={styles.group}>
                              <Text style={styles.groupLabel}>
                                {meal.slot.toUpperCase()}
                              </Text>
                              {meal.items.map((it, iIdx) => (
                                <View key={iIdx} style={styles.itemRow}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.itemName}>{it.name || '—'}</Text>
                                    {it.serving ? (
                                      <Text style={styles.itemNotes}>{it.serving}</Text>
                                    ) : null}
                                  </View>
                                  <View style={styles.itemMacros}>
                                    {it.calories != null && (
                                      <Text style={styles.itemCal}>{Math.round(Number(it.calories))} kcal</Text>
                                    )}
                                    {it.protein_g != null && (
                                      <Text style={styles.itemProtein}>P {Math.round(Number(it.protein_g))}g</Text>
                                    )}
                                  </View>
                                </View>
                              ))}
                              <LogPlannedMealButton meal={plannedMealFromFoods(meal.items)} slot={meal.slot} />
                            </View>
                          ))}
                        </View>
                      ))
                    ) : plan.items.length === 0 ? (
                      <Text style={styles.emptyItemsText}>No meals listed in this plan.</Text>
                    ) : (
                      // Legacy flat-items rendering.
                      <>
                        {groups.map((g) => (
                          <View key={g.key} style={styles.group}>
                            <Text style={styles.groupLabel}>
                              {g.label.toUpperCase()}
                            </Text>
                            {g.rows.map((it, idx) => (
                              <View key={idx} style={styles.itemRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.itemName}>{it.name || '—'}</Text>
                                  {it.notes ? (
                                    <Text style={styles.itemNotes}>
                                      {it.notes}
                                    </Text>
                                  ) : null}
                                  <LogPlannedMealButton meal={it} slot={g.key} />
                                </View>
                                <View style={styles.itemMacros}>
                                  {it.calories != null && (
                                    <Text style={styles.itemCal}>{Math.round(Number(it.calories))} kcal</Text>
                                  )}
                                  {it.protein != null && (
                                    <Text style={styles.itemProtein}>P {Math.round(Number(it.protein))}g</Text>
                                  )}
                                </View>
                              </View>
                            ))}
                          </View>
                        ))}

                        {(hasTotalCals || hasTotalProtein) && (
                          <View style={styles.totalsRow}>
                            <Text style={styles.totalsLabel}>Daily total</Text>
                            <Text style={styles.totalsValue}>
                              {hasTotalCals ? `${Math.round(totalCals)} kcal` : ''}
                              {hasTotalCals && hasTotalProtein ? ' · ' : ''}
                              {hasTotalProtein ? `${Math.round(totalProtein)}g protein` : ''}
                            </Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                </FadeInView>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 20, // the stack header owns the status-bar inset on both platforms
    paddingBottom: 16,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 12,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 10,
    borderRadius: radius.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.textMuted,
  },
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 40,
    padding: 24,
    borderRadius: radius.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 12,
  },
  emptyTitle: {
    ...typography.h2,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  planList: {
    paddingHorizontal: 20,
    gap: 32,
  },
  planCard: {
    borderRadius: radius.card,
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  planTitle: {
    ...typography.h4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  planHero: { ...typography.h2, color: colors.textPrimary },
  planMeta: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  notesBox: {
    borderRadius: radius.input,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  notesText: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  group: {
    marginTop: 12,
  },
  groupLabel: {
    ...typography.eyebrow,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  itemName: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  itemNotes: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 22,
  },
  itemMacros: {
    alignItems: 'flex-end',
    gap: 2,
  },
  itemCal: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
    color: colors.textMuted,
  },
  itemProtein: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
    color: colors.textMuted,
  },
  emptyItemsText: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    paddingVertical: 10,
    textAlign: 'center',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 4,
  },
  totalsLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  totalsValue: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  // H2: per-day section styles
  daySection: {
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 20,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dayLabel: {
    ...typography.h4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  dayTotals: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
  },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16,
    borderRadius: radius.button, backgroundColor: colors.accent },
  retryText: { ...typography.bodySmall, color: colors.textOnAccent },
  });
