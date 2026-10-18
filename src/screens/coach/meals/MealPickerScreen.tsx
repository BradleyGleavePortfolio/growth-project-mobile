/**
 * MEALBUILD: Swap a slot's meal or Add a meal (MOCK-K5 Style C "builder" tap
 * map). The pick saves the plan's whole slot list (PATCH replaces all slots).
 * #MEAL-2 (3/3): the coach's own meals first, then the food bank (GET foods/search;
 * a coach passes its student route by role hierarchy). A food becomes one of the
 * coach's meals at the portion picked, then fills the slot.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { TextLink } from '../../../ui/buttons/PrimaryButton';
import HapticPressable from '../../../components/HapticPressable';
import FoodImage from '../../../components/FoodImage';
import QuantityPickerModal from '../../../components/log/QuantityPickerModal';
import { QuietOverline } from '../../../ui/sections/QuietSection';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useCreateMealTemplate, useDailyMealPlan, useMealTemplates, useUpdateDailyMealPlan } from '../../../hooks/useMealTemplates';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { SLOT_LABELS, type SlotLabel } from '../../../api/mealTemplatesApi';
import { foodApi } from '../../../services/api';
import { mapFoodItem, type RawFoodItem } from '../../../utils/log/mapFoodItem';
import { calcMacros, parseQuantityInput } from '../../../utils/log/macros';
import { formatPortion } from '../../../utils/log/quickLog';
import type { SearchResult } from '../../../utils/log/types';
import type { ProgramsScreenProps } from '../programs/types';
import { Chips, FirstCard, LoadFailed, Loading, Masthead, SLOT_NAMES, macroLine, mealStyles as ms, planSaveFailed, saveFailed, sortedSlots } from './mealUi';

type SlotPick = { meal_template_id: string; slot_label: SlotLabel };
const known = (f: SearchResult) => [f.calories, f.protein, f.carbs, f.fat].every(Number.isFinite);
/** "Per 100g · 165 kcal · P 31 · C 0 · F 4", the food log's basis words (FoodSearchView). */
const foodLine = (f: SearchResult) => `${f.nutrient_basis === 'PER_SERVING' ? 'Per portion' : 'Per 100g'} · ${macroLine(
  { calories_kcal: f.calories, protein_g: f.protein, carbs_g: f.carbs, fats_g: f.fat })}`;

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
  const create = useCreateMealTemplate();
  const [q, setQ] = useState('');
  const term = useDebouncedValue(q.trim(), 300);
  const bank = useQuery({ queryKey: ['food-search', term], enabled: term.length >= 2, staleTime: 60_000,
    queryFn: async () => (((await foodApi.search(term, 20)).data?.results ?? []) as RawFoodItem[]).map(mapFoodItem).filter(known) });
  const [food, setFood] = useState<SearchResult | null>(null);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('serving');
  const amount = parseQuantityInput(qty);
  const made = food && calcMacros(food, amount ?? 0, unit);
  const meal = made && { calories_kcal: made.calories, protein_g: Math.round(made.protein), carbs_g: Math.round(made.carbs), fats_g: Math.round(made.fat) };
  // The meal DTO's limits, as the meal editor (CoachMealTemplatesScreen).
  const over = !!meal && (meal.calories_kcal > 2000 || meal.protein_g > 300 || meal.carbs_g > 400 || meal.fats_g > 200);

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
  const addFood = async () => {
    if (!food || !meal || !amount || over) return;
    try {
      const m = await create.mutateAsync({ name: food.name.slice(0, 120), description: formatPortion(amount, unit), ...meal });
      setFood(null);
      pick(m.id);
    } catch {
      void HapticService.error();
    }
  };

  const list = meals.data;
  const mine = list?.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const card = [ms.card, styles.list, { backgroundColor: sc.bgSurface, borderColor: sc.border }];
  const row = (i: number) => [styles.row, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }];
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  const busy = update.isPending || create.isPending;
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
      ) : (
        <>
          <TextInput value={q} onChangeText={setQ} placeholder="Search your meals and the food bank" placeholderTextColor={sc.textMuted}
            accessibilityLabel="Search your meals and the food bank" autoCorrect={false} returnKeyType="search" testID="pick-search"
            style={[styles.field, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]} />
          {!list.length ? (
            <FirstCard title="No meals yet." body="Add the meals you use most, with their calories and macros. Day plans are built from them.">
              <TextLink label="New meal" align="start" onPress={() => navigation.navigate('MealEditor')} />
            </FirstCard>
          ) : mine?.length ? (
            <View style={styles.section}>
              <QuietOverline accessibilityRole="header">Your meals</QuietOverline>
              <View style={card}>
                {mine.map((m, i) => {
                  const on = m.id === current?.meal_template_id;
                  return (
                    <HapticPressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}, ${macroLine(m)}`} accessibilityState={{ selected: on, disabled: busy }}
                      disabled={busy} testID={`pick-${m.id}`} onPress={() => pick(m.id)} style={row(i)}>
                      <View style={ms.fill}>
                        <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{m.name}</Text>
                        <Text style={muted}>{macroLine(m)}</Text>
                      </View>
                      {on ? <Ionicons name="checkmark" size={22} color={sc.accentText} /> : null}
                    </HapticPressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <View style={styles.section}>
            <QuietOverline accessibilityRole="header">Food bank</QuietOverline>
            {term.length < 2 ? <Text style={muted}>Search above to add a food at the portion you pick.</Text>
              : bank.error ? <LoadFailed title="The food bank didn’t load." error={bank.error} onRetry={() => void bank.refetch()} retrying={bank.isFetching} />
              : !bank.data ? <Loading label="Searching the food bank" />
              : !bank.data.length ? <Text style={muted}>{`No foods match “${term}”.`}</Text> : (
                <View style={card}>
                  {bank.data.map((f, i) => (
                    <HapticPressable key={`${f.id}-${i}`} accessibilityRole="button" accessibilityLabel={`${f.name}, ${foodLine(f)}`} accessibilityHint="Opens the portion"
                      accessibilityState={{ disabled: busy }} disabled={busy} testID={`food-${i}`} style={row(i)}
                      onPress={() => { create.reset(); setQty('1'); setUnit('serving'); setFood(f); }}>
                      {f.image_url ? <Image source={{ uri: f.image_url }} style={styles.thumb} /> : <FoodImage name={f.name} brand={f.brand ?? undefined} size={44} />}
                      <View style={ms.fill}>
                        <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{f.name}</Text>
                        <Text style={muted}>{foodLine(f)}</Text>
                      </View>
                    </HapticPressable>
                  ))}
                </View>
              )}
          </View>
        </>
      )}
      <QuantityPickerModal visible={!!food} selectedFood={food} quantityInput={qty} selectedUnit={unit} onQuantityChange={setQty}
        onUnitChange={setUnit} onConfirm={() => void addFood()} onCancel={() => setFood(null)} saving={busy}
        confirmLabel="Use this food" emptyHint="Enter a quantity greater than zero to use this food." blocked={over}
        notice={over ? 'Up to 2,000 kcal, 300 g protein, 400 g carbs and 200 g fat.' : create.error ? saveFailed(create.error) : null} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  list: { paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  field: { ...typography.body, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input },
  section: { gap: 8 }, thumb: { width: 44, height: 44, borderRadius: radius.input },
});
