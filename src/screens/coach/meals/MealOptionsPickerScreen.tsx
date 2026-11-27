/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3; frames S1_F02 and F06): Add an option. His live meals but
 * this one, A to Z, each a checkbox; archived ids are not listed but count. Done hands the list back to the meal page
 * still mounted under it (R3: popTo with mealId; kept ids in their order, new ticks appended); Back hands nothing back.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, schemeCard, schemeCardOutline, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { QuietOverline } from '../../../ui/sections/QuietSection';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useMealTemplates } from '../../../hooks/useMealTemplates';
import type { ProgramsScreenProps } from '../programs/types';
import { FirstCard, LoadFailed, Loading, Masthead, macroLine, mealStyles as ms, num } from './mealUi';
import { MAX_OPTIONS, pickerMeals, toggleOption } from './mealLinks';

export default function MealOptionsPickerScreen({ route, navigation }: ProgramsScreenProps<'MealOptionsPicker'>) {
  const { semanticColors: sc } = useTheme();
  const { mealId, mealName, chosen } = route.params;
  const meals = useMealTemplates();
  const [ids, setIds] = useState(chosen);
  const [q, setQ] = useState('');
  const full = ids.length >= MAX_OPTIONS;
  const all = meals.data && pickerMeals(meals.data, mealId, '');
  const shown = meals.data && pickerMeals(meals.data, mealId, q);
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  const done = () => navigation.popTo('MealEditor', { mealId, picked: { options: ids, at: Date.now() } });
  return (
    <Screen edges={['bottom']} contentStyle={styles.content}
      footer={<PrimaryButton label="Done" wrap testID="options-done" disabled={!all?.length} onPress={done} />}>
      <Masthead title="Add an option" sub={`${mealName ? `For ${mealName} · ` : ''}${ids.length} of ${MAX_OPTIONS}`}
        onBack={() => navigation.goBack()} />
      {!all || !shown ? (
        meals.error ? <LoadFailed title="Your meals didn’t load." error={meals.error} onRetry={() => void meals.refetch()} retrying={meals.isFetching} />
          : <Loading label="Loading your meals" />
      ) : !all.length ? (
        <FirstCard title="No other meals yet." body="An option is another of your meals. Make one with its calories and macros, then add it here.">
          <Pressable accessibilityRole="button" accessibilityLabel="New meal" onPress={() => navigation.push('MealEditor')}
            style={({ pressed }) => [styles.plus, pressed && ms.pressed]}>
            <Ionicons name="add-circle-outline" size={22} color={sc.accentText} />
            <Text style={[typography.bodyMd, { color: sc.accentText }]}>New meal</Text>
          </Pressable>
        </FirstCard>
      ) : (
        <>
          <View style={[styles.field, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}>
            <Ionicons name="search-outline" size={20} color={sc.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search your meals" placeholderTextColor={sc.textMuted}
              accessibilityLabel="Search your meals" autoCorrect={false} returnKeyType="search" style={[typography.body, ms.fill, { color: sc.textPrimary }]} />
          </View>
          <QuietOverline accessibilityRole="header">Your meals, A to Z</QuietOverline>
          {!shown.length ? <Text style={muted}>{`No meals match “${q.trim()}”.`}</Text> : (
            <View style={[ms.card, schemeCard, schemeCardOutline, styles.list]}>
              {shown.map((m, i) => {
                const on = ids.includes(m.id);
                const off = full && !on;
                return (
                  <Pressable key={m.id} testID={`option-${m.id}`} accessibilityRole="checkbox" disabled={off}
                    accessibilityState={{ checked: on, disabled: off }}
                    accessibilityLabel={`${m.name}, ${num(m.calories_kcal)} kcal, P ${num(m.protein_g)}, C ${num(m.carbs_g)}, F ${num(m.fats_g)}`}
                    onPress={() => { void HapticService.selection(); setIds(toggleOption(ids, m.id)); }}
                    style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth },
                      pressed && ms.pressed, off && styles.off]}>
                    <View style={ms.fill}>
                      <Text style={[typography.body, { color: sc.textPrimary }]}>{m.name}</Text>
                      <Text style={muted}>{macroLine(m)}</Text>
                    </View>
                    <View style={[styles.tick, on ? { backgroundColor: sc.accent, borderColor: sc.accent } : { borderColor: sc.textMuted }]}>
                      {on ? <Ionicons name="checkmark" size={18} color={sc.textOnAccent} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input },
  list: { paddingVertical: 4, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  tick: { width: 28, height: 28, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.45 },
  plus: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin },
});
