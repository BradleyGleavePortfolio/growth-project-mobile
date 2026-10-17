/**
 * MEALBUILD 2/2: Assign to a client (MOCK-K5 Style C, conflict state) on POST
 * coach/daily-meal-plans/:id/assignments. The server takes any overlap and
 * shows the client the plan that starts latest, so conflicts are read here.
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useAssignDailyMealPlan, useDailyMealPlan, useDailyMealPlans, useMealPlanAssignments } from '../../../hooks/useMealTemplates';
import { useAssignableClients } from '../../../hooks/usePrograms';
import { useCurrentMacrosForClient } from '../../../hooks/useMacros';
import { toIsoDate } from '../../../api/programsApi';
import type { ProgramsScreenProps } from '../programs/types';
import { Chips, FirstCard, LoadFailed, Loading, Masthead, Notice, count, dayTotals, httpStatus, mealStyles as ms, num, saveFailed, sortedSlots } from './mealUi';

/** ISO dates at noon, so a clock change never moves a day. */
const noon = (iso: string) => new Date(`${iso}T12:00:00`);
const addDays = (iso: string, n: number) => { const d = noon(iso); d.setDate(d.getDate() + n); return toIsoDate(d); };
const between = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 864e5);
const fmt = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => noon(iso).toLocaleDateString('en-US', o);
/** Any length the coach picks (#MEAL-1): whole weeks say weeks, anything else days; 0 is no end date. */
const span = (d: number) => (!d ? 'No end date' : d % 7 ? count(d, 'day', 'days') : count(d / 7, 'week', 'weeks'));
const LENGTHS = [0, 7, 14, 28];

export default function MealPlanAssignScreen({ route, navigation }: ProgramsScreenProps<'MealPlanAssign'>) {
  const { semanticColors: sc } = useTheme();
  const { planId } = route.params;
  const p = useDailyMealPlan(planId).data;
  const list = useDailyMealPlans();
  const plans = list.data;
  const ids = useMemo(() => (plans ?? []).map((x) => x.id), [plans]);
  const { byPlan, error: runsError } = useMealPlanAssignments(ids);
  const qc = useQueryClient();
  const rereading = useIsFetching({ queryKey: ['daily-meal-plans'] }) > 0;
  const roster = useAssignableClients();
  const assign = useAssignDailyMealPlan();
  const [clientId, setClientId] = useState<string>();
  const today = toIsoDate(new Date());
  const [starts, setStarts] = useState(today);
  const [days, setDays] = useState(0);
  const [picking, setPicking] = useState<'start' | 'end'>();
  const [q, setQ] = useState('');
  const target = useCurrentMacrosForClient(clientId).data;
  const ends = days ? addDays(starts, days - 1) : undefined;
  // A week of start chips and four lengths; a date or length picked beyond them shows on the Pick a date chip.
  const startChips = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(today, n))
    .map((iso, n): [string, string] => [iso, n ? `${fmt(iso, { weekday: 'short' })} ${Number(iso.slice(8))}` : 'Today']);
  const lengthChips = LENGTHS.map((d): [number, string] => [d, span(d)]);
  const customStart = startChips.some(([iso]) => iso === starts) ? undefined : fmt(starts);
  const customLength = LENGTHS.includes(days) ? undefined : span(days);
  const toggle = (which: 'start' | 'end') => setPicking(picking === which ? undefined : which);
  // Android's dialog closes on any answer; iOS keeps its calendar open (changing month can move the date) until Done.
  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setPicking(undefined);
    if (e.type !== 'set' || !d) return;
    if (picking === 'start') setStarts(toIsoDate(d));
    else setDays(Math.max(1, between(starts, toIsoDate(d)) + 1));
  };
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
  const readError = list.error ?? runsError;
  // Overlaps are read from every plan's assignments: until all of them are in, Assign waits (button and handler alike).
  const blocked = !client || !p || !plans || !byPlan || !!same || !!tie;

  const submit = async () => {
    if (blocked || !client) return;
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
      <PrimaryButton label={client ? `Assign to ${first}` : 'Assign to a client'} haptic={false} disabled={blocked}
        accessibilityHint={client ? undefined : 'Pick a client first'}
        loading={assign.isPending} onPress={() => void submit()} testID="assign-submit" />}>
      <Masthead title="Assign to a client" sub={p ? `${p.name} · ${num(kcal)} kcal a day` : undefined} onBack={() => navigation.goBack()}>
        <Chips label="Starts" items={startChips} value={starts} onChange={setStarts} scroll
          pick={{ label: 'Pick a start date', open: picking === 'start', chosen: customStart, onPress: () => toggle('start') }} />
        <Chips label="Ends" items={lengthChips} value={days} onChange={setDays}
          pick={{ label: 'Pick an end date', open: picking === 'end', chosen: customLength, onPress: () => toggle('end') }} />
        <Text style={[typography.body, styles.range, { color: sc.textOnAccent }]}>
          {days === 1 ? `On ${fmt(starts)} only` : `From ${fmt(starts)}${ends ? ` to ${fmt(ends)}` : ', no end date'}`}
        </Text>
      </Masthead>
      {picking ? (
        <View style={Platform.OS === 'ios' ? [ms.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }] : undefined}>
          <DateTimePicker mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} accentColor={sc.accent} onChange={onPick} testID="assign-date"
            value={noon(picking === 'start' ? starts : ends ?? starts)} minimumDate={noon(picking === 'start' ? today : starts)} />
          {Platform.OS === 'ios' ? <TextLink label="Done" tone="accent" underline={false} align="end" onPress={() => setPicking(undefined)} /> : null}
        </View>
      ) : null}
      {readError ? (
        <LoadFailed title="Your meal plans didn’t load." error={readError} retrying={rereading}
          onRetry={() => void qc.refetchQueries({ queryKey: ['daily-meal-plans'], type: 'active' })} />
      ) : null}
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
