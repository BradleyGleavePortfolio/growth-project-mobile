/**
 * MEALBUILD 2/2: Assign to a client (MOCK-K5 Style C, conflict state) on POST
 * coach/daily-meal-plans/:id/assignments. The server takes any overlap and
 * shows the client the plan that starts latest, so conflicts are read here.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useAssignDailyMealPlan, useDailyMealPlan, useDailyMealPlans, useMealPlanAssignments } from '../../../hooks/useMealTemplates';
import { useAssignableClients } from '../../../hooks/usePrograms';
import { useCurrentMacrosForClient } from '../../../hooks/useMacros';
import { toIsoDate } from '../../../api/programsApi';
import type { ProgramsScreenProps } from '../programs/types';
import { Chips, FirstCard, LoadFailed, Loading, Masthead, Notice, dayTotals, httpStatus, mealStyles as ms, num, saveFailed, sortedSlots } from './mealUi';

const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return toIsoDate(d); };
const fmt = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', o);
const ENDS: [number, string][] = [[0, 'No end date'], [1, '1 week'], [2, '2 weeks'], [4, '4 weeks']];

export default function MealPlanAssignScreen({ route, navigation }: ProgramsScreenProps<'MealPlanAssign'>) {
  const { semanticColors: sc } = useTheme();
  const { planId } = route.params;
  const p = useDailyMealPlan(planId).data;
  const plans = useDailyMealPlans().data;
  const ids = useMemo(() => (plans ?? []).map((x) => x.id), [plans]);
  const { byPlan } = useMealPlanAssignments(ids);
  const roster = useAssignableClients();
  const assign = useAssignDailyMealPlan();
  const [clientId, setClientId] = useState<string>();
  const [start, setStart] = useState(0);
  const [weeks, setWeeks] = useState(0);
  const [q, setQ] = useState('');
  const target = useCurrentMacrosForClient(clientId).data;
  const today = dayIso(0);
  const starts = dayIso(start);
  const ends = weeks ? dayIso(start + weeks * 7 - 1) : undefined;
  const startChips: [number, string][] = [0, 1, 2, 3, 4, 5, 6].map((n) => [n, n ? `${fmt(dayIso(n), { weekday: 'short' })} ${Number(dayIso(n).slice(8))}` : 'Today']);
  const runs = (plans ?? []).flatMap((plan) => (byPlan?.get(plan.id) ?? [])
    .map((a) => ({ plan, client: a.client_id, from: a.starts_on.slice(0, 10), to: a.ends_on?.slice(0, 10) }))
    .filter((r) => !r.to || r.to >= today));
  const client = roster.data?.find((c) => c.id === clientId);
  const first = client?.name.split(' ')[0] ?? '';
  const mine = runs.filter((r) => r.client === clientId && r.from <= (ends ?? '9999-12-31') && (!r.to || r.to >= starts));
  const same = mine.find((r) => r.plan.id === planId);
  const tie = mine.find((r) => r.from === starts);
  const other = mine.find((r) => r.plan.id !== planId);
  const kcal = p ? dayTotals(sortedSlots(p)).calories_kcal : 0;
  const bold = { fontFamily: 'Inter_600SemiBold' };
  const shown = (roster.data ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));

  const submit = async () => {
    if (!client) return;
    void HapticService.mediumImpact();
    try {
      await assign.mutateAsync({ planId, input: { client_id: client.id, starts_on: starts, ...(ends ? { ends_on: ends } : {}) } });
      void HapticService.success();
      navigation.popTo('DayPlanBuilder', { planId, assigned: `Assigned to ${first} from ${fmt(starts)}.` });
    } catch {
      void HapticService.error();
    }
  };
  const message = String((assign.error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message ?? '');
  const failed = assign.error && (httpStatus(assign.error) !== 404 ? saveFailed(assign.error)
    : /client/i.test(message) ? `${first} is no longer your client.` : 'This day plan was archived.');

  return (
    <Screen edges={['bottom']} contentStyle={styles.content} footer={
      <PrimaryButton label={client ? `Assign to ${first}` : 'Assign to a client'} haptic={false} disabled={!client || !p || !!same || !!tie}
        accessibilityHint={client ? undefined : 'Pick a client first'}
        loading={assign.isPending} onPress={() => void submit()} testID="assign-submit" />}>
      <Masthead title="Assign to a client" sub={p ? `${p.name} · ${num(kcal)} kcal a day` : undefined} onBack={() => navigation.goBack()}>
        <Chips label="Starts" items={startChips} value={start} onChange={setStart} scroll />
        <Chips label="Ends" items={ENDS} value={weeks} onChange={setWeeks} />
        <Text style={[typography.body, styles.range, { color: sc.textOnAccent }]}>{`From ${fmt(starts)}${ends ? ` to ${fmt(ends)}` : ', no end date'}`}</Text>
      </Masthead>
      {same ? (
        <Notice icon="alert-circle-outline"><Text style={bold}>{`${first} is already on ${same.plan.name} from ${fmt(same.from)}.`}</Text></Notice>
      ) : tie ? (
        <Notice icon="alert-circle-outline"><Text style={bold}>{`${first} starts ${tie.plan.name} on ${fmt(tie.from)}.`}</Text>{' Pick another start date.'}</Notice>
      ) : other ? (
        <Notice icon="information-circle-outline">{`${first} is on ${other.plan.name} from ${fmt(other.from)}. On days both plans cover, ${first} sees the one that starts later.`}</Notice>
      ) : null}
      {failed ? <Text accessibilityRole="alert" style={[typography.body, { color: sc.textPrimary }]}>{failed}</Text> : null}
      {client && target ? <Text style={[typography.body, { color: sc.textMuted }]}>{`Plan ${num(kcal)} · target ${num(target.calories_kcal)} kcal`}</Text> : null}
      {!roster.data ? (
        roster.isLoading ? <Loading label="Loading your clients" /> : (
          <LoadFailed title="Your clients didn’t load." error={roster.error} onRetry={() => void roster.refetch()} retrying={roster.isFetching} />
        )
      ) : !roster.data.length ? (
        <FirstCard title="No clients yet." body="When a client joins you, you can assign this plan here." />
      ) : (
        <>
          <TextInput value={q} onChangeText={setQ} placeholder="Search your clients" placeholderTextColor={sc.textMuted} accessibilityLabel="Search"
            style={[styles.search, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]} />
          <View accessibilityRole="radiogroup" accessibilityLabel="Your clients" style={[ms.card, styles.list, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
            {shown.map((c, i) => {
              const on = c.id === clientId;
              const now = runs.filter((r) => r.client === c.id && r.from <= today).sort((a, b) => b.from.localeCompare(a.from))[0];
              return (
                <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`client-${c.id}`}
                  accessibilityLabel={now ? `${c.name}, on ${now.plan.name}` : c.name}
                  onPress={() => { if (!on) { void HapticService.selection(); setClientId(c.id); } }}
                  style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && ms.pressed]}>
                  <View style={[styles.radio, { borderColor: on ? sc.accent : sc.textMuted }]}>{on ? <View style={[styles.dot, { backgroundColor: sc.accent }]} /> : null}</View>
                  <Text style={[typography.h2, ms.fill, { color: sc.textPrimary }]}>{c.name}</Text>
                  {now ? <Text style={[typography.bodySmall, styles.on, { color: sc.textMuted }]}>{`On ${now.plan.name}`}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  range: { marginTop: 6 },
  search: { ...typography.body, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input },
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  radio: { width: 26, height: 26, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 14, height: 14, borderRadius: radius.chip },
  on: { maxWidth: '45%', textAlign: 'right' },
});
