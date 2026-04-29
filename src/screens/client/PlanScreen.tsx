import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Shadow } from '../../constants/theme';
import FadeInView from '../../components/FadeInView';
import { mealPlansApi } from '../../services/api';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage, type JsonRecord } from '../../types/common';

// ── Types ─────────────────────────────────────────────────────────────────
//
// The server shape is whatever the backend returns — it may nest items or
// return a flat array of { name, calories?, protein?, notes?, time_of_day? }.
// We read it defensively and fall back to an empty list when fields are
// missing so a malformed plan never blanks the screen.

interface MealItem {
  name: string;
  calories?: number | null;
  protein?: number | null;
  notes?: string | null;
  time_of_day?: string | null;
}

interface MealPlan {
  id: string;
  title: string;
  notes?: string | null;
  items: MealItem[];
  created_at?: string | null;
}

const TIME_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

function timeIcon(tod?: string | null): string {
  const t = (tod || '').toLowerCase();
  if (t.startsWith('break')) return 'AM';
  if (t.startsWith('lunch')) return 'MID';
  if (t.startsWith('din')) return 'PM';
  if (t.startsWith('snack')) return '+';
  return '·';
}

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
// on items.
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
    return {
      id: String(p.id),
      title: typeof p.title === 'string' && p.title ? p.title : 'Meal plan',
      notes: (p.notes as string | null | undefined) ?? null,
      items,
      created_at: (p.created_at as string | null | undefined) ?? (p.createdAt as string | null | undefined) ?? null,
    };
  });
}

export default function PlanScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [plans, setPlans] = useState<MealPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    try {
      const res = await mealPlansApi.list();
      setPlans(normalisePlans(res.data));
      setError(null);
    } catch (err) {
      // Read-only fetch. Surface a friendly message; leave any prior plans
      // visible so a transient network blip doesn't empty the screen.
      console.error('PlanScreen: mealPlansApi.list failed', err);
      setError(errorMessage(err, 'Could not load your meal plans.'));
      if (plans === null) setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [plans]);

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch on focus so coach-side changes show up without a full reload.
  useFocusEffect(
    useCallback(() => {
      loadPlans();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPlans();
    setRefreshing(false);
  }, [loadPlans]);

  if (loading && plans === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const hasPlans = (plans?.length || 0) > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <FadeInView>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Your Meal Plan</Text>
              <Text style={styles.subtitle}>
                {hasPlans ? 'Assigned by your coach' : 'Nothing here yet'}
              </Text>
            </View>
          </View>
        </FadeInView>

        {error && hasPlans && (
          <View style={styles.errorBanner} accessibilityLiveRegion="polite">
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!hasPlans ? (
          <FadeInView>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="restaurant-outline" size={32} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>
                Your coach hasn't assigned a meal plan yet.
              </Text>
              <Text style={styles.emptyBody}>
                Ask your coach in Messages — they can create one for you and it'll show up here automatically.
              </Text>
            </View>
          </FadeInView>
        ) : (
          <View style={styles.planList}>
            {plans!.map((plan) => {
              const groups = groupItems(plan.items);
              const totalCals = plan.items.reduce((s, it) => s + (Number(it.calories) || 0), 0);
              const totalProtein = plan.items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
              return (
                <FadeInView key={plan.id}>
                  <View style={styles.planCard}>
                    <View style={styles.planHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                        {plan.created_at && (
                          <Text style={styles.planMeta}>
                            Assigned {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                      </View>
                    </View>

                    {plan.notes ? (
                      <View style={styles.notesBox}>
                        <Text style={styles.notesText}>{plan.notes}</Text>
                      </View>
                    ) : null}

                    {plan.items.length === 0 ? (
                      <Text style={styles.emptyItemsText}>No meals listed in this plan.</Text>
                    ) : (
                      <>
                        {groups.map((g) => (
                          <View key={g.key} style={styles.group}>
                            <Text style={styles.groupLabel}>
                              {timeIcon(g.key)} {g.label.toUpperCase()}
                            </Text>
                            {g.rows.map((it, idx) => (
                              <View key={idx} style={styles.itemRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.itemName}>{it.name || '—'}</Text>
                                  {it.notes ? (
                                    <Text style={styles.itemNotes} numberOfLines={2}>
                                      {it.notes}
                                    </Text>
                                  ) : null}
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

                        {(totalCals > 0 || totalProtein > 0) && (
                          <View style={styles.totalsRow}>
                            <Text style={styles.totalsLabel}>Daily total</Text>
                            <Text style={styles.totalsValue}>
                              {totalCals > 0 ? `${Math.round(totalCals)} kcal` : ''}
                              {totalCals > 0 && totalProtein > 0 ? ' · ' : ''}
                              {totalProtein > 0 ? `${Math.round(totalProtein)}g protein` : ''}
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '500',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 10,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.noticeCriticalBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.noticeCriticalText,
  },
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 40,
    padding: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 12,
    ...Shadow.small,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  planList: {
    paddingHorizontal: 20,
    gap: 16,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...Shadow.small,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  planMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  notesBox: {
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    padding: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  notesText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  group: {
    marginTop: 12,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  itemNotes: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  itemMacros: {
    alignItems: 'flex-end',
    gap: 2,
  },
  itemCal: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  itemProtein: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.primary,
  },
  emptyItemsText: {
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
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  totalsValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },

  });
