/** MEALBUILD: Programs > Meal plans and Meals (MOCK-K5 C "plans") on coach/daily-meal-plans and coach/meal-templates. */
import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import HapticPressable from '../../../components/HapticPressable';
import { useMealPlanRuns, useMealTemplates } from '../../../hooks/useMealTemplates';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import type { DailyMealPlan } from '../../../api/mealTemplatesApi';
import type { ProgramsNav } from '../programs/types';
import {
  FirstCard, LoadFailed, Loading, Masthead, OfflineNote, ProgramsTabs, clientsOn, count, dayTotals, macroLine,
  mealStyles as ms, num, type ProgramsHalf,
} from './mealUi';

export default function MealPlansHome({ tab, onTab }: { tab: 'plans' | 'meals'; onTab: (h: ProgramsHalf) => void }) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<ProgramsNav>();
  const { plans, runs } = useMealPlanRuns();
  const meals = useMealTemplates();
  const offline = !isEffectivelyOnline(useNetworkStatus());
  const query = tab === 'plans' ? plans : meals;
  const everyone = runs && new Set((plans.data ?? []).flatMap((p) => [...clientsOn(runs, p.id)])).size;
  const sub = plans.data && meals.data ? [count(plans.data.length, 'day plan', 'day plans'), count(meals.data.length, 'meal', 'meals'),
    everyone === undefined ? '' : `${count(everyone, 'client', 'clients')} on a plan`].filter(Boolean).join(' · ') : undefined;
  const card = [ms.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }];

  let body: React.ReactNode;
  if (query.isLoading) body = <Loading label={tab === 'plans' ? 'Loading your meal plans' : 'Loading your meals'} />;
  else if (!query.data) {
    body = <LoadFailed title={tab === 'plans' ? 'Your meal plans didn’t load.' : 'Your meals didn’t load.'}
      error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  } else if (tab === 'meals') {
    body = meals.data?.length ? meals.data.map((m) => (
      <HapticPressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}, ${macroLine(m)}`} accessibilityHint="Opens the meal"
        onPress={() => navigation.navigate('MealEditor', { mealId: m.id })} style={[card, styles.meal]}>
        <View style={ms.fill}>
          <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{m.name}</Text>
          <Text style={[typography.bodySmall, styles.nums, { color: sc.textMuted }]}>{macroLine(m)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
      </HapticPressable>
    )) : <FirstCard title="No meals yet." body="Add the meals you use most, with their calories and macros. Day plans are built from them." />;
  } else {
    body = plans.data?.length
      ? plans.data.map((p) => <PlanCard key={p.id} plan={p} clients={runs && clientsOn(runs, p.id).size}
        onPress={() => navigation.navigate('DayPlanBuilder', { planId: p.id })} />)
      : <FirstCard title="No day plans yet." body="A day plan is a day of your meals, such as a training day or a rest day. Clients see it in Food." />;
  }

  return (
    <Screen edges={[]} contentStyle={styles.content}
      refreshControl={<RefreshControl refreshing={query.isRefetching} tintColor={sc.accent}
        onRefresh={() => { void plans.refetch(); void meals.refetch(); }} />}
      footer={!query.data ? undefined : tab === 'meals'
        ? <PrimaryButton label="New meal" testID="meal-new" onPress={() => navigation.navigate('MealEditor')} />
        : <PrimaryButton label="New day plan" testID="plan-new" onPress={() => navigation.navigate('DayPlanBuilder')} />}>
      <Masthead title="Your meal plans" sub={sub}><ProgramsTabs value={tab} onChange={onTab} onDark /></Masthead>
      {offline && query.data ? <OfflineNote at={query.dataUpdatedAt} /> : null}
      {body}
    </Screen>
  );
}

/** K5 plan card; one moss dash a meal (decorative, hidden from screen readers). */
function PlanCard({ plan, clients, onPress }: { plan: DailyMealPlan; clients?: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  const t = dayTotals(plan.slots);
  const people = clients === undefined ? '' : count(clients, 'client', 'clients');
  return (
    <HapticPressable accessibilityRole="button" accessibilityLabel={[plan.name, `${num(t.calories_kcal)} kcal`, people].filter(Boolean).join(', ')}
      accessibilityHint="Opens the day plan" onPress={onPress} style={[ms.card, styles.plan, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
      <View style={styles.row}>
        <Text style={[ms.cardTitle, ms.fill, { color: sc.textPrimary }]}>{plan.name}</Text>
        <Text style={[typography.h2, styles.nums, { color: sc.textPrimary }]}>{num(t.calories_kcal)}</Text>
        <Text style={[typography.body, { color: sc.textMuted }]}>kcal</Text>
      </View>
      {plan.notes ? <Text style={[styles.note, { color: sc.textPrimary }]}>{`“${plan.notes}”`}</Text> : null}
      <View style={styles.row}>
        <View style={styles.dashes} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {plan.slots.slice(0, 8).map((x) => <View key={x.id} style={[styles.dash, { backgroundColor: sc.data.moss }]} />)}
        </View>
        <Text style={[typography.bodySmall, styles.grow, { color: sc.textMuted }]}>
          {`${count(plan.slots.length, 'meal', 'meals')} · protein ${num(t.protein_g)} g`}
        </Text>
        {people ? <Text style={[typography.bodySmall, styles.people, { color: sc.accentText }]}>{people}</Text> : null}
      </View>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 }, plan: { gap: 8, padding: 16 }, grow: { flexGrow: 1 }, dashes: { flexDirection: 'row', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  nums: { fontVariant: ['lining-nums', 'tabular-nums'] },
  note: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 19, lineHeight: 25 },
  dash: { width: 14, height: 6, borderRadius: radius.chip },
  people: { fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  meal: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
});
