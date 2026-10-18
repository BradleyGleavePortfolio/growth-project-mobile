/**
 * MEALBUILD 2/2: Swap a slot's meal or Add a meal (MOCK-K5 Style C "builder" tap
 * map). The pick saves the plan's whole slot list (PATCH replaces all slots).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { TextLink } from '../../../ui/buttons/PrimaryButton';
import HapticPressable from '../../../components/HapticPressable';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useDailyMealPlan, useMealTemplates, useUpdateDailyMealPlan } from '../../../hooks/useMealTemplates';
import { SLOT_LABELS, type SlotLabel } from '../../../api/mealTemplatesApi';
import type { ProgramsScreenProps } from '../programs/types';
import { Chips, FirstCard, LoadFailed, Loading, Masthead, SLOT_NAMES, macroLine, mealStyles as ms, planSaveFailed, sortedSlots } from './mealUi';

type SlotPick = { meal_template_id: string; slot_label: SlotLabel };

export default function MealPickerScreen({ route, navigation }: ProgramsScreenProps<'MealPicker'>) {
  const { semanticColors: sc } = useTheme();
  const { planId, index } = route.params;
  const plan = useDailyMealPlan(planId);
  const meals = useMealTemplates();
  const update = useUpdateDailyMealPlan();
  const slots = plan.data ? sortedSlots(plan.data) : [];
  const current = index === undefined ? undefined : slots[index];
  const [picked, setKind] = useState<SlotLabel>();
  const kind = picked ?? current?.slot_label ?? SLOT_LABELS.find((k) => !slots.some((x) => x.slot_label === k)) ?? 'snack';
  const slot = current && SLOT_NAMES[current.slot_label].toLowerCase();

  const write = async (next: SlotPick[]) => {
    try {
      const input = { slots: next.map((x, order) => ({ meal_template_id: x.meal_template_id, slot_label: x.slot_label, order })) };
      await update.mutateAsync({ id: planId, input });
      void HapticService.success();
      navigation.goBack();
    } catch {
      void HapticService.error();
    }
  };
  const pick = (id: string) => void write(current
    ? slots.map((x) => (x === current ? { meal_template_id: id, slot_label: kind } : x))
    : [...slots, { meal_template_id: id, slot_label: kind }]);

  const list = meals.data;
  return (
    <Screen edges={['bottom']} contentStyle={styles.content}
      footer={slot ? <TextLink label={`Remove ${slot}`} onPress={() => void write(slots.filter((x) => x !== current))} /> : undefined}>
      <Masthead title={slot ? `Swap ${slot}` : 'Add a meal'} sub={plan.data?.name} onBack={() => navigation.goBack()}>
        <Chips items={SLOT_LABELS.map((k): [SlotLabel, string] => [k, SLOT_NAMES[k]])} value={kind} onChange={setKind} label="Meal" />
      </Masthead>
      {update.error ? <Text accessibilityRole="alert" style={[typography.body, { color: sc.textPrimary }]}>{planSaveFailed(update.error)}</Text> : null}
      {!list || !plan.data ? (
        !(meals.error ?? plan.error) ? <Loading label="Loading your meals" /> : (
          <LoadFailed title="Your meals didn’t load." error={meals.error ?? plan.error}
            onRetry={() => { void meals.refetch(); void plan.refetch(); }} retrying={meals.isFetching || plan.isFetching} />
        )
      ) : !list.length ? (
        <FirstCard title="No meals yet." body="Add the meals you use most, with their calories and macros. Day plans are built from them.">
          <TextLink label="New meal" align="start" onPress={() => navigation.navigate('MealEditor')} />
        </FirstCard>
      ) : (
        <View style={[ms.card, styles.list, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
          {list.map((m, i) => {
            const on = m.id === current?.meal_template_id;
            return (
              <HapticPressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}, ${macroLine(m)}`} accessibilityState={{ selected: on, disabled: update.isPending }}
                disabled={update.isPending} testID={`pick-${m.id}`} onPress={() => pick(m.id)}
                style={[styles.row, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <View style={ms.fill}>
                  <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{m.name}</Text>
                  <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{macroLine(m)}</Text>
                </View>
                {on ? <Ionicons name="checkmark" size={22} color={sc.accentText} /> : null}
              </HapticPressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  list: { paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
});
