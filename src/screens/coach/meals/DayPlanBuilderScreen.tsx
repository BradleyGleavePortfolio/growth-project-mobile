/**
 * MEALBUILD 2/2: the day-plan builder (MOCK-K5 Style C "builder") on
 * coach/daily-meal-plans. A new plan is named first (POST); after that every
 * change saves at once (PATCH), so clients on the plan see it right away.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import HapticPressable from '../../../components/HapticPressable';
import { HapticService } from '../../../ui/haptics/haptics.service';
import {
  useCreateDailyMealPlan, useDailyMealPlan, useMealPlanAssignments, useUpdateDailyMealPlan,
} from '../../../hooks/useMealTemplates';
import type { UpdateDailyMealPlanInput } from '../../../api/mealTemplatesApi';
import type { ProgramsScreenProps } from '../programs/types';
import {
  LoadFailed, Loading, Masthead, SLOT_NAMES, clientsOn, count, dayTotals, macroLine, mealStyles as ms, num, planSaveFailed,
  saveFailed, sortedSlots,
} from './mealUi';

export default function DayPlanBuilderScreen({ route, navigation }: ProgramsScreenProps<'DayPlanBuilder'>) {
  const { semanticColors: sc } = useTheme();
  const { planId, assigned } = route.params ?? {};
  const plan = useDailyMealPlan(planId);
  const create = useCreateDailyMealPlan();
  const update = useUpdateDailyMealPlan();
  const { byPlan } = useMealPlanAssignments(planId ? [planId] : []);
  const [name, setName] = useState<string>();
  const [note, setNote] = useState<string>();
  const back = () => navigation.goBack();
  const onDark = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };

  if (!planId) {
    const make = async () => {
      void HapticService.mediumImpact();
      try {
        const made = await create.mutateAsync({ name: (name ?? '').trim(), slots: [] });
        void HapticService.success();
        navigation.setParams({ planId: made.id });
      } catch {
        void HapticService.error();
      }
    };
    return (
      <Screen edges={['bottom']} contentStyle={styles.content} footer={<PrimaryButton label="Create day plan" haptic={false}
        disabled={!name?.trim()} loading={create.isPending} onPress={() => void make()} testID="plan-create" />}>
        <Masthead title="New day plan" sub="Name it, then add its meals." onBack={back} />
        <TextInput autoFocus value={name} onChangeText={setName} maxLength={120} accessibilityLabel="Day plan name"
          placeholder="Training day" placeholderTextColor={sc.textMuted}
          style={[styles.field, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]} />
        {create.error ? <Text accessibilityRole="alert" style={[typography.body, { color: sc.textPrimary }]}>{saveFailed(create.error)}</Text> : null}
      </Screen>
    );
  }

  const p = plan.data;
  if (!p) {
    return (
      <Screen edges={['bottom']} contentStyle={styles.content}>
        <Masthead title="Day plan" onBack={back} />
        {plan.isLoading ? <Loading label="Loading the day plan" /> : (
          <LoadFailed title="This day plan didn’t load." error={plan.error} onRetry={() => void plan.refetch()} retrying={plan.isFetching} />
        )}
      </Screen>
    );
  }

  const slots = sortedSlots(p);
  const t = dayTotals(slots);
  const clients = byPlan && clientsOn(byPlan.get(p.id) ?? []).size;
  const save = (input: UpdateDailyMealPlanInput) => update.mutate({ id: p.id, input },
    { onSuccess: () => void HapticService.success(), onError: () => void HapticService.error() });
  return (
    <Screen edges={['bottom']} contentStyle={styles.content}
      footer={<PrimaryButton label="Assign to a client" disabled={!slots.length} accessibilityHint={slots.length ? undefined : 'Add a meal first'}
        onPress={() => navigation.navigate('MealPlanAssign', { planId: p.id })} testID="plan-assign" />}>
      <Masthead onBack={back} title={
        <TextInput value={name ?? p.name} onChangeText={setName} maxLength={120} accessibilityLabel="Day plan name"
          onEndEditing={() => { if (name?.trim() && name.trim() !== p.name) save({ name: name.trim() }); }} style={[ms.title, styles.title, onDark]} />
      }>
        <View style={styles.big}>
          <Text style={[styles.kcal, onDark]}>{num(t.calories_kcal)}</Text>
          <Text style={[typography.body, muted]}>kcal a day</Text>
        </View>
        <Text style={[typography.body, onDark]}>{`Protein ${num(t.protein_g)} g   Carbs ${num(t.carbs_g)} g   Fat ${num(t.fats_g)} g`}</Text>
        {clients ? <Text style={[typography.body, muted]}>{`${count(clients, 'client follows', 'clients follow')} this plan`}</Text> : null}
      </Masthead>
      {assigned ? <Text accessibilityLiveRegion="polite" style={[typography.bodyMd, { color: sc.accentText }]}>{assigned}</Text> : null}
      <View style={[ms.card, styles.noteCard, { backgroundColor: sc.surface.sage }]}>
        <Text style={[typography.eyebrow, { color: sc.textPrimary }]}>Your note · clients see it</Text>
        <TextInput value={note ?? p.notes ?? ''} onChangeText={setNote} multiline maxLength={2000} accessibilityLabel="Your note on this plan, clients see it"
          placeholder="A line for clients, such as when to eat the bigger meal" placeholderTextColor={sc.textMuted}
          onEndEditing={() => { if (note !== undefined && note.trim() !== (p.notes ?? '')) save({ notes: note.trim() }); }}
          style={[styles.note, { color: sc.textPrimary }]} />
      </View>
      {slots.map((x, i) => {
        const slot = SLOT_NAMES[x.slot_label];
        const m = x.meal_template;
        return (
          <View key={x.id} style={styles.slot}>
            <View style={styles.rail} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={[styles.dot, { backgroundColor: sc.data.moss }]}><Ionicons name="checkmark" size={13} color={sc.textOnAccent} /></View>
              <View style={[styles.railLine, { backgroundColor: sc.border }]} />
            </View>
            <View style={[ms.fill, styles.slotBody]}>
              <Text style={[typography.eyebrow, { color: sc.textMuted }]}>{slot}</Text>
              <View style={[ms.card, styles.meal, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
                <View style={[styles.tile, { backgroundColor: sc.bgPrimary }]}><Ionicons name="restaurant-outline" size={22} color={sc.textPrimary} /></View>
                <View style={ms.fill}>
                  <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{m.name}</Text>
                  <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{m.archived_at ? 'Archived meal. Swap it to keep editing.' : macroLine(m)}</Text>
                </View>
                <HapticPressable accessibilityRole="button" accessibilityLabel={`Swap ${slot.toLowerCase()}`} hitSlop={4} style={styles.icon}
                  onPress={() => navigation.navigate('MealPicker', { planId: p.id, index: i })}>
                  <Ionicons name="swap-horizontal-outline" size={22} color={sc.textMuted} />
                </HapticPressable>
              </View>
            </View>
          </View>
        );
      })}
      <HapticPressable accessibilityRole="button" accessibilityLabel="Add a meal" style={styles.add} testID="plan-add"
        onPress={() => navigation.navigate('MealPicker', { planId: p.id })}>
        <Ionicons name="add" size={22} color={sc.accentText} />
        <Text style={[typography.bodyMd, { color: sc.accentText }]}>Add a meal</Text>
      </HapticPressable>
      {update.error ? <Text accessibilityRole="alert" style={[typography.body, { color: sc.textPrimary }]}>{planSaveFailed(update.error)}</Text> : null}
      {clients ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          {`Changes reach the ${count(clients, 'client', 'clients')} on this plan right away. Food they already logged stays as it was.`}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  field: { ...typography.body, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input },
  title: { padding: 0 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  kcal: { ...typography.display, fontSize: 52, lineHeight: 65, fontVariant: ['lining-nums', 'tabular-nums'] },
  noteCard: { gap: 6, paddingVertical: 16 },
  note: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 19, lineHeight: 25, padding: 0, minHeight: 25 },
  slot: { flexDirection: 'row', gap: 10 },
  rail: { width: 22, alignItems: 'center' },
  dot: { width: 22, height: 22, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  railLine: { width: 2, flex: 1, marginTop: 2, marginBottom: -16 },
  slotBody: { gap: 8 },
  meal: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  tile: { width: 40, height: 40, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 44, height: 44, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, alignSelf: 'flex-start' },
});
