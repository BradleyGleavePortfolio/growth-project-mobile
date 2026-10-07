/**
 * "Log this meal" on a planned meal (PlanScreen, ClientDailyMealPlanScreen).
 *
 * One tap adds the meal to today's food log when the plan gives calories,
 * protein, carbs and fat and its slot names a log meal. Otherwise a sheet asks
 * only for what the plan does not say (the meal, a missing value); a missing
 * value is never logged as zero. The write is the Food log's manual-entry path
 * (utils/log/logSubmit): online it creates the food and the entry and offers
 * Undo; offline it queues them exactly like the Food log.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, typography, type SemanticTokens } from '../../theme/tokens';
import type { MealType } from '../../types';
import type { DailyMealPlanSlot } from '../../api/mealTemplatesApi';
import { MEAL_SECTIONS } from '../../utils/log/types';
import { FoodLogValidationError, submitManualLogOffline, submitManualLogOnlineWithId } from '../../utils/log/logSubmit';
import { logApi } from '../../services/api';
import { notifyPendingFoodLogs } from '../../services/foodLogSync';
import { queryClient } from '../../services/queryClient';
import { isEffectivelyOnline } from '../../hooks/useNetworkStatus';
import { useClientStore } from '../../store/clientStore';
import { readUserCacheSync } from '../../lib/userCache';
import { getTodayString } from '../../utils/date';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import { HapticService } from '../../ui/haptics/haptics.service';
import { errorMessage } from '../../types/common';

export interface PlannedMeal {
  name: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}

type Field = 'calories' | 'protein' | 'carbs' | 'fat';
type Values = Record<Field, string>;
const FIELDS: Array<[Field, string]> = [
  ['calories', 'Calories'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)'],
];

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  const n = t ? Number(t) : NaN;
  return isAmount(n) ? n : null;
}

/** The food-log meal a plan slot names, or null when it names none (pre-workout, "09:30"). */
export function mealTypeForSlot(slot?: string | null): MealType | null {
  const s = (slot ?? '').toLowerCase().replace(/^day\s+\d+\s*[–-]\s*/, '').trim();
  if (s.startsWith('breakfast')) return 'breakfast';
  if (s.startsWith('lunch')) return 'lunch';
  if (s.startsWith('dinner')) return 'dinner';
  return /\bsnacks?\b/.test(s) ? 'snack' : null;
}

/** A canonical plan slot: its meal template always carries all four values. */
export function plannedMealFromSlot(slot: DailyMealPlanSlot): PlannedMeal {
  const t = slot.meal_template;
  return { name: t.name, calories: t.calories_kcal, protein: t.protein_g, carbs: t.carbs_g, fat: t.fats_g };
}

interface PlanFood {
  name: string;
  serving?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

/** An AI plan meal as one entry: a value is summed only when every food has it. */
export function plannedMealFromFoods(foods: PlanFood[]): PlannedMeal {
  const sum = (pick: (f: PlanFood) => number | null | undefined): number | null =>
    foods.length > 0 && foods.every((f) => isAmount(pick(f)))
      ? foods.reduce((n, f) => n + Number(pick(f)), 0)
      : null;
  return {
    name: foods.filter((f) => f.name).map((f) => (f.serving ? `${f.name} (${f.serving})` : f.name)).join(', ').slice(0, 200),
    calories: sum((f) => f.calories),
    protein: sum((f) => f.protein_g),
    carbs: sum((f) => f.carbs_g),
    fat: sum((f) => f.fat_g),
  };
}

const mealLabel = (t: MealType) => (MEAL_SECTIONS.find((s) => s.type === t)?.label ?? 'Meal').toLowerCase();
const shown = (v: number | null | undefined) => (isAmount(v) ? String(Math.round(v * 10) / 10) : '');

function sheetProblem(values: Values, type: MealType | null): string | null {
  if ([values.protein, values.carbs, values.fat].some((v) => parseAmount(v) == null)) {
    return 'Enter protein, carbs and fat. Use 0 if there is none.';
  }
  if (parseAmount(values.calories) == null) return 'Enter calories. Use 0 if there is none.';
  return type ? null : 'Choose the meal to add it to.';
}

// Log, Home and Macros read today's food from the shared day store and the
// ['food', 'log', date] query; refresh both after a write.
function refreshFoodLog() {
  void queryClient.invalidateQueries({ queryKey: ['food', 'log'] });
  const userId = readUserCacheSync()?.id;
  const store = useClientStore.getState();
  if (userId) void store.loadDayData(userId, store.selectedDate);
}

type Phase = 'idle' | 'saving' | 'logged' | 'queued' | 'undoing';

export default function LogPlannedMealButton({ meal, slot }: { meal: PlannedMeal; slot?: string | null }) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const name = meal.name.trim();
  const initial: Values = {
    calories: shown(meal.calories), protein: shown(meal.protein), carbs: shown(meal.carbs), fat: shown(meal.fat),
  };
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [loggedTo, setLoggedTo] = useState<MealType>('snack');
  const [sheet, setSheet] = useState(false);
  const [values, setValues] = useState<Values>(initial);
  const [type, setType] = useState<MealType | null>(null);
  if (!name) return null;

  const busy = phase === 'saving' || phase === 'undoing';
  const problem = sheetProblem(values, type);

  const log = async (v: Values, t: MealType) => {
    setPhase('saving');
    setNote(null);
    const args = { foodName: name, ...v, quantity: '1', unit: 'serving', date: getTodayString(), mealType: t };
    try {
      const net = await NetInfo.fetch();
      if (!isEffectivelyOnline({ isOnline: !!net.isConnected, isInternetReachable: net.isInternetReachable })) {
        await submitManualLogOffline(args);
        void notifyPendingFoodLogs();
        setPhase('queued');
      } else {
        const res = await submitManualLogOnlineWithId(args);
        void HapticService.success();
        track(AnalyticsEvents.MEAL_LOGGED, { meal_type: t, source: 'meal_plan' });
        setEntryId(res.entryId);
        setPhase('logged');
        refreshFoodLog();
      }
      setLoggedTo(t);
      setSheet(false);
    } catch (err) {
      void HapticService.error();
      setPhase('idle');
      setNote(err instanceof FoodLogValidationError
        ? err.message
        : errorMessage(err, 'This meal was not added. Check the connection and try again.'));
    }
  };

  const onPress = () => {
    const t = mealTypeForSlot(slot);
    if (t && !sheetProblem(initial, t)) {
      void log(initial, t);
      return;
    }
    setValues(initial);
    setType(t);
    setNote(null);
    setSheet(true);
  };

  const close = () => {
    setSheet(false);
    setNote(null);
  };

  const undo = async () => {
    if (!entryId) return;
    setPhase('undoing');
    setNote(null);
    try {
      await logApi.deleteEntry(entryId);
      setEntryId(null);
      setPhase('idle');
      setNote(`Removed from today's ${mealLabel(loggedTo)}.`);
      refreshFoodLog();
    } catch (err) {
      setPhase('logged');
      setNote(errorMessage(err, 'This entry was not removed. Check the connection and try again.'));
    }
  };

  return (
    <View style={styles.wrap}>
      {phase === 'logged' || phase === 'undoing' ? (
        <View style={styles.row}>
          <Text style={styles.muted} accessibilityLiveRegion="polite">{`Added to today's ${mealLabel(loggedTo)}.`}</Text>
          {entryId ? (
            <HapticPressable onPress={undo} disabled={busy} accessibilityRole="button"
              accessibilityLabel={`Undo, remove ${name} from today's food log`} style={styles.action}>
              <Text style={styles.link}>{phase === 'undoing' ? 'Removing…' : 'Undo'}</Text>
            </HapticPressable>
          ) : null}
        </View>
      ) : phase === 'queued' ? (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {`Saved offline. It syncs to today's ${mealLabel(loggedTo)} when the connection returns.`}
        </Text>
      ) : (
        <HapticPressable onPress={onPress} disabled={busy} accessibilityRole="button"
          accessibilityLabel={`Log this meal: ${name}`} accessibilityState={{ disabled: busy, busy }} style={styles.action}>
          <Text style={styles.link}>{phase === 'saving' ? 'Saving…' : 'Log this meal'}</Text>
        </HapticPressable>
      )}
      {note && !sheet ? <Text style={styles.muted} accessibilityLiveRegion="polite">{note}</Text> : null}
      {sheet ? (
        <Modal visible transparent animationType="fade" onRequestClose={close}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
            <View style={styles.sheet} accessibilityViewIsModal>
              <Text style={styles.overline}>Log this meal</Text>
              <Text style={styles.title}>{name}</Text>
              <Text style={styles.muted}>
                {FIELDS.some(([f]) => initial[f])
                  ? "Adds one entry to today's food log. Values come from your meal plan; change any that differ."
                  : "Adds one entry to today's food log."}
              </Text>
              <View style={styles.choices} accessibilityRole="radiogroup">
                {MEAL_SECTIONS.map((s) => (
                  <HapticPressable key={s.type} onPress={() => setType(s.type)} accessibilityRole="radio"
                    accessibilityState={{ checked: type === s.type }} style={[styles.choice, type === s.type && styles.choiceOn]}>
                    <Text style={type === s.type ? styles.choiceOnText : styles.muted}>{s.label}</Text>
                  </HapticPressable>
                ))}
              </View>
              {FIELDS.map(([f, label]) => (
                <View key={f} style={styles.field}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput value={values[f]} onChangeText={(v) => setValues((p) => ({ ...p, [f]: v }))}
                    keyboardType="decimal-pad" accessibilityLabel={label} style={styles.input} />
                </View>
              ))}
              {note || problem ? <Text style={styles.muted} accessibilityRole="alert">{note || problem}</Text> : null}
              <HapticPressable onPress={() => { if (type && !problem) void log(values, type); }}
                disabled={!!problem || busy} accessibilityRole="button" accessibilityState={{ disabled: !!problem || busy }}
                style={[styles.primary, (problem || busy) ? styles.primaryOff : null]}>
                <Text style={problem || busy ? styles.primaryOffText : styles.primaryText}>
                  {busy ? 'Saving…' : type ? `Log to ${mealLabel(type)}` : 'Log meal'}
                </Text>
              </HapticPressable>
              <HapticPressable onPress={close} accessibilityRole="button" style={styles.action}>
                <Text style={styles.muted}>Cancel</Text>
              </HapticPressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    wrap: { alignSelf: 'stretch' },
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
    action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: sc.accentText },
    muted: { ...typography.bodySmall, color: sc.textMuted },
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: sc.overlay },
    sheet: {
      backgroundColor: sc.bgPrimary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing.xl, paddingBottom: spacing['2xl'], gap: spacing.md,
    },
    overline: { ...typography.eyebrow, color: sc.textMuted },
    title: { ...typography.h3, color: sc.textPrimary },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
    choice: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: 'transparent' },
    choiceOn: { borderBottomColor: sc.textPrimary },
    choiceOnText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: sc.textPrimary },
    field: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border,
    },
    fieldLabel: { ...typography.bodySmall, color: sc.textPrimary },
    input: {
      ...typography.body, minWidth: 96, minHeight: 44, textAlign: 'right', color: sc.textPrimary, fontVariant: ['tabular-nums'],
    },
    primary: {
      minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: sc.accent,
    },
    primaryOff: { backgroundColor: sc.disabledBg },
    primaryText: { ...typography.bodyMd, color: sc.textOnAccent },
    primaryOffText: { ...typography.bodyMd, color: sc.textOnDisabled },
  });
}
