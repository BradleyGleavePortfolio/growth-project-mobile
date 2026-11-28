/**
 * PLAN-SWAPS-M (C2 Style C C_recipe; operator rulings R6, R8, R9): a coach's plan meal on its own page. Opened from
 * the Food day's and the meal plan page's "Recipe and grocery list", and later from the Kitchen's "From {coach}" row,
 * with { date, slotId } (the README's id-only params). The forest masthead names the meal, the coach's note about it
 * and its own four numbers (what "Ate it as planned" logs); the paper holds the recipe (ingredients, allergens,
 * method) or, with no recipe, the meal's items; the footer keeps "Ate it as planned" (today only) and "Add
 * ingredients to grocery list". Reads: the day's plan (the Food day's key), the coach, the day's log (today), the
 * recipe. Writes: the plan meal log (LogPlannedMealButton) and one grocery add (the Prep guide's own write).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { listsApi, recipesApi } from '../../../services/api';
import { mealTemplatesApi, type ClientTodayResponse } from '../../../api/mealTemplatesApi';
import { useTodayLog } from '../../../hooks/useApi';
import { featureFlags } from '../../../config/featureFlags';
import { getTodayString } from '../../../utils/date';
import { buildPlanDay } from '../../../utils/log/foodDay';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../../../utils/log/dailyEntry';
import { countsInDay, withQueuedFoods } from '../../../utils/log/queuedDay';
import { useClientStore } from '../../../store/clientStore';
import type { FoodLog } from '../../../types';
import { errorStatus } from '../../../types/common';
import { isHiddenForAllergens, recipeAllergenDetail, type RecipeAllergenFields } from '../../../lib/recipeAllergens';
import LogPlannedMealButton, { plannedMealFromSlot } from '../../../components/mealplan/LogPlannedMealButton';
import HapticPressable from '../../../components/HapticPressable';
import { PrimaryButton } from '../../../ui';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import { StyleCLoadingLines, StyleCNotice, StyleCSheet, useBottomInset } from '../../../ui/layout/StyleCPage';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useTheme } from '../../../theme/ThemeProvider';
import { gold, layout, radius, spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { MastLine, mast, PaperPage, PlanMasthead, useCoachItalic } from './planStyleC';
import { findPlanSlot, firstName, groceryItems, ingredientRows, perServingLine, SLOT_NAME, type GroceryItem, type IngredientRow } from './planMeal';

interface Recipe extends RecipeAllergenFields {
  id: string;
  ingredients?: string[];
  instructions?: string[];
}
type Params = { PlanMeal: { date: string; slotId: string } };

const FIVE_MIN = 5 * 60 * 1000;
// C_day's quote rule (ClientDailyMealPlanScreen QUOTED): the marks go round the note unless it already has them.
const QUOTED = /^["'“‘]|["'”’]$/;
const quoted = (t: string) => (QUOTED.test(t) ? t : `“${t}”`);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const NO_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0 };
// Main's waiting words for a meal's foods saved on the phone (FoodDayView.tsx offlineLine, OFFLINE-FOOD-M).
const waitingLine = (w: FoodLog[]) => (w.length === 1
  ? `Saved offline. ${w[0].foodName} will sync when you reconnect.`
  : `Saved offline. ${w.length} foods will sync when you reconnect.`);

export default function PlanMealScreen() {
  const { date, slotId } = useRoute<RouteProp<Params, 'PlanMeal'>>().params;
  // One page per meal (LO B1, LS B2). The stack reuses the PlanMeal route on top when a door names it again (the Food
  // tab's navigate('MoreTab', { screen: 'PlanMeal', params })), so the body is keyed by the meal: what a visit holds
  // (the eaten decision, the button's log and Undo, the grocery sheet) starts again for each meal, from every door.
  return <PlanMealPage key={`${date}|${slotId}`} date={date} slotId={slotId} />;
}

function PlanMealPage({ date, slotId }: Params['PlanMeal']) {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const qc = useQueryClient();
  const italic = useCoachItalic();
  const bottom = useBottomInset();
  const isToday = date === getTodayString();

  // The Food day's plan read (FoodDayView.tsx:159-164); from the meal plan page, its no-date answer when it is this day.
  const plan = useQuery<ClientTodayResponse>({
    queryKey: ['meal-plan', 'today', date],
    queryFn: () => mealTemplatesApi.todayForClient(date).then((r) => r.data),
    staleTime: FIVE_MIN,
    initialData: () => {
      const today = qc.getQueryData<ClientTodayResponse>(['meal-plan', 'today', null]);
      return today?.date === date ? today : undefined;
    },
    initialDataUpdatedAt: () => qc.getQueryState(['meal-plan', 'today', null])?.dataUpdatedAt,
  });
  const coach = useQuery({
    queryKey: ['clients', 'me', 'coach'],
    queryFn: () => api.get<{ name?: string }>('/v1/clients/me/coach').then((r) => r.data),
    staleTime: FIVE_MIN,
  });
  const found = findPlanSlot(plan.data, slotId);
  const slot = found?.slot ?? null;
  const recipeId = slot?.recipe_id ?? null;
  const recipe = useQuery<Recipe>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId as string).then((r) => r.data as Recipe),
    enabled: !!recipeId,
    staleTime: FIVE_MIN,
  });
  // R8: the meal plan page's eaten rule (buildPlanDay over the day's log), today only.
  const dayOn = isToday && !!slot;
  const day = useTodayLog(dayOn ? date : '');
  const entries = day.data && typeof day.data === 'object' ? (day.data as { entries?: DailyLogEntry[] }).entries ?? [] : null;
  // (b) FIX-PSM-2: this meal's foods saved on the phone count as eaten, joined as the Food day joins them (clientStore
  // shownDay: withQueuedFoods over the waiting and sent foods, OFFLINE-FOOD-M #191-E3); a refused food counts nowhere.
  const queue = useClientStore((st) => st.queuedFoods);
  const sent = useClientStore((st) => st.sentFoods);
  const logs = withQueuedFoods((entries ?? []).map((e) => foodLogFromDailyEntry(e, date)), NO_TOTALS, [...queue, ...sent], date, '')
    .foodLogs.filter(countsInDay);
  const eaten = found && (entries || day.isError) && featureFlags.foodPlanChecklist
    ? buildPlanDay([found.plan], logs).slots.find((x) => x.key === slotId) ?? null : null;
  const onPhone = (eaten?.logs ?? []).filter((l) => l.offline === 'waiting');
  // LS B1: whether the meal was eaten is decided from the day's log read for this visit, never from a log the app
  // already held (the Food day's own logs refresh its store, not this query). A visit starts when the page opens and
  // again when it comes back into focus. Offline the read fails after the app's retries (no onlineManager is wired, so
  // it never pauses on a phone); then the first visit decides from the log in hand and the phone's foods.
  // (a) FIX-PSM-2: a return keeps the last decision, and LogPlannedMealButton with it (its Saving, Saved offline and
  // Undo), closed to taps while the visit's read is out. Only a read that answers replaces the decision, or a food
  // for this meal saved on the phone while the page was away (b).
  const [visitAt, setVisitAt] = useState(() => Date.now());
  const opened = useRef(false);
  const phoneNow = useRef<string[]>([]);
  phoneNow.current = onPhone.map((l) => l.id);
  const phoneAtBlur = useRef<string[] | null>(null);
  useFocusEffect(useCallback(() => {
    if (opened.current) setVisitAt(Date.now());
    opened.current = true;
    return () => { phoneAtBlur.current = phoneNow.current; };
  }, []));
  const { refetch } = day;
  useEffect(() => {
    if (dayOn) void refetch();
  }, [dayOn, visitAt, refetch]);
  // A food of this meal leaving the phone (sent and read back, refused or removed) reads the day again, so the status
  // line follows it to the server's words.
  const phoneKey = phoneNow.current.join(' ');
  const phoneSeen = useRef(phoneKey);
  useEffect(() => {
    if (dayOn && phoneSeen.current && phoneKey !== phoneSeen.current) void refetch();
    phoneSeen.current = phoneKey;
  }, [dayOn, phoneKey, refetch]);
  const answered = day.dataUpdatedAt >= visitAt;
  const readForVisit = answered || day.errorUpdatedAt >= visitAt || day.fetchStatus === 'paused';
  const decision = useRef<{ at: number; eaten: boolean } | null>(null);
  if (decision.current?.at !== visitAt && readForVisit && (entries || day.isError)) {
    const last = decision.current;
    const savedAway = phoneNow.current.some((id) => !(phoneAtBlur.current ?? phoneNow.current).includes(id));
    decision.current = { at: visitAt, eaten: !last || answered ? (eaten?.logs.length ?? 0) > 0 : last.eaten || savedAway };
  }
  const eatenNow = decision.current ? decision.current.eaten : null;
  const reading = !!decision.current && decision.current.at !== visitAt;

  const [added, setAdded] = useState<number | null>(null);
  const addToGrocery = useMutation({
    mutationFn: (items: GroceryItem[]) => listsApi.bulkAdd('grocery', items).then((r) => r.data?.added ?? items.length),
    onSuccess: (count) => {
      void HapticService.success();
      void qc.invalidateQueries({ queryKey: ['lists', 'grocery'] });
      setAdded(count);
    },
    onError: () => Alert.alert('Could not add the ingredients', 'Nothing was added to your grocery list. Try again.'),
  });

  const band = (
    <View style={styles.band}>
      <View style={styles.rule} />
    </View>
  );
  if (plan.isLoading) {
    return (
      <View style={styles.screen}>
        <PlanMasthead title="" bones testID="plan-meal-masthead" />
        <PaperPage bg={sc.bgPrimary}><StyleCLoadingLines rows={4} label="Loading" /></PaperPage>
      </View>
    );
  }
  if (!plan.data) {
    return (
      <View style={styles.screen}>
        {band}
        <PaperPage bg={sc.bgPrimary}>
          <QuietError message={loadFailureMessage(plan.error, 'Your meal plan')} onRetry={() => void plan.refetch()}
            retrying={plan.isFetching} testID="plan-meal-plan-error" />
        </PaperPage>
      </View>
    );
  }
  if (!slot || !found) {
    return (
      <View style={styles.screen}>
        {band}
        <PaperPage bg={sc.bgPrimary}>
          <View testID="plan-meal-gone"><StyleCNotice>This meal is no longer in your plan for this day.</StyleCNotice></View>
        </PaperPage>
      </View>
    );
  }

  const t = slot.meal_template;
  const meal = SLOT_NAME[slot.slot_label] ?? 'Meal';
  const who = firstName(coach.data?.name);
  const note = t.description?.trim();
  const shownRecipe = recipeId ? recipe.data ?? null : null;
  const rows = recipeId ? (shownRecipe ? ingredientRows(shownRecipe, null) : []) : ingredientRows(null, t.items);
  const groceries = recipeId ? (shownRecipe ? groceryItems(shownRecipe, null) : []) : groceryItems(null, t.items);
  // A meal still on the phone reads as the Food day reads it: main's waiting line, never "Logged as planned".
  const status = !eatenNow ? null : onPhone.length > 0 ? waitingLine(onPhone) : eaten?.status ?? null;
  const showButton = isToday && eatenNow === false;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <PlanMasthead eyebrow={(who ? `${meal}, from ${who}'s plan` : `${meal}, from your coach's plan`).toUpperCase()} title={t.name}
          testID="plan-meal-masthead">
          {note ? (
            <Text style={[styles.note, italic]} accessibilityLabel={`${who ? `${who}'s` : "Your coach's"} note: ${note}`}>{quoted(note)}</Text>
          ) : null}
          <MastLine style={styles.perServing} testID="plan-meal-per-serving">{perServingLine(t)}</MastLine>
        </PlanMasthead>
        <PaperPage bg={sc.bgPrimary}>
          {recipeId && recipe.isLoading ? (
            <View testID="plan-meal-recipe-loading"><StyleCLoadingLines rows={4} label="Loading" /></View>
          ) : recipeId && !shownRecipe ? (
            <RecipeFailure error={recipe.error} onRetry={() => void recipe.refetch()} />
          ) : null}
          {rows.length > 0 ? (
            <View testID="plan-meal-ingredients">
              <Text style={styles.eyebrow} accessibilityRole="header">INGREDIENTS</Text>
              {rows.map((r, i) => <Ingredient key={`${i}-${r.name}`} row={r} styles={styles} sc={sc} />)}
            </View>
          ) : null}
          {shownRecipe ? (
            <View testID="plan-meal-allergens">
              <Text style={[styles.eyebrow, styles.sectionGap]} accessibilityRole="header">ALLERGENS</Text>
              <Text style={styles.muted}>{`${recipeAllergenDetail(shownRecipe)} Check the ingredients below before you cook.`}</Text>
            </View>
          ) : null}
          {shownRecipe && (shownRecipe.instructions ?? []).length > 0 ? (
            <View testID="plan-meal-method">
              <Text style={[styles.eyebrow, styles.sectionGap]} accessibilityRole="header">METHOD</Text>
              {(shownRecipe.instructions ?? []).map((step, i) => (
                <View key={i} style={styles.step}>
                  <Text style={styles.stepNo}>{String(i + 1)}</Text>
                  <Text style={styles.body}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </PaperPage>
      </ScrollView>
      {/* C_recipe .foot: the actions stay at the bottom over the page. */}
      <View style={[styles.foot, { paddingBottom: bottom + 12 }]}>
        {showButton ? (
          <View pointerEvents={reading ? 'none' : 'auto'} accessibilityElementsHidden={reading}
            importantForAccessibility={reading ? 'no-hide-descendants' : 'auto'} testID="plan-meal-log">
            <LogPlannedMealButton meal={plannedMealFromSlot(slot)} slot={slot.slot_label} planSlotId={slot.id} planned />
          </View>
        ) : null}
        {status ? <Text style={styles.status} testID="plan-meal-status">{status}</Text> : null}
        {groceries.length > 0 ? (
          <HapticPressable intent="light" disableAnimation onPress={() => { if (!addToGrocery.isPending) addToGrocery.mutate(groceries); }}
            disabled={addToGrocery.isPending}
            accessibilityRole="button" accessibilityLabel="Add ingredients to grocery list"
            accessibilityState={{ disabled: addToGrocery.isPending, busy: addToGrocery.isPending }} style={styles.link} testID="plan-meal-grocery">
            <Text style={styles.linkText}>Add ingredients to grocery list</Text>
          </HapticPressable>
        ) : null}
      </View>
      {/* The Prep guide's confirmation sheet and words (PrepGuideScreen.tsx:320-329). */}
      <StyleCSheet visible={added != null} icon="cart-outline" title="Added to Grocery List"
        body={`${plural(added ?? 0, 'ingredient')} added to your grocery list.`} action="View List"
        onAction={() => { setAdded(null); navigation.navigate('GroceryList'); }} link="OK" onClose={() => setAdded(null)} />
    </View>
  );
}

/** S11: the recipe could not be read: RecipeDetail's words (RecipeDetailScreen.tsx:133-140); Try again only when it may come back. */
function RecipeFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const gone = errorStatus(error) === 404;
  return (
    <View style={stylesStatic.failure} testID="plan-meal-recipe-error">
      <StyleCNotice>
        {isHiddenForAllergens(error) ? 'This recipe is hidden because it lists an allergen saved on your profile.'
          : gone ? 'This recipe is no longer available.' : 'Could not load this recipe. Check your connection and try again.'}
      </StyleCNotice>
      {gone ? null : <PrimaryButton label="Try again" accessibilityLabel="Retry recipe" onPress={onRetry} haptic={false} />}
    </View>
  );
}

/** One ingredient: a hairline row for a recipe's line as written; with an amount, C_recipe's dotted leader to it. */
function Ingredient({ row, styles, sc }: { row: IngredientRow; styles: Styles; sc: SemanticTokens }) {
  if (!row.amount) return <View style={styles.ingredient}><Text style={styles.body}>{row.name}</Text></View>;
  return (
    <View style={styles.lead} accessible accessibilityLabel={`${row.name}, ${row.amount}`}>
      <Text style={styles.leadName}>{row.name}</Text>
      <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Svg width="100%" height={2}><Line x1={1} y1={1} x2="100%" y2={1} stroke={sc.textMuted} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="0.01 3" /></Svg>
      </View>
      <Text style={styles.leadAmount}>{row.amount}</Text>
    </View>
  );
}

const stylesStatic = StyleSheet.create({ failure: { gap: 16, marginBottom: spacing.lg } });

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: sc.bgPrimary },
  scroll: { flex: 1, backgroundColor: mast.ground },
  content: { flexGrow: 1, backgroundColor: sc.bgPrimary },
  // A plain band where there is no meal to name (the plan failed, or the meal left the plan).
  band: { backgroundColor: mast.ground, paddingHorizontal: layout.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xs + radius.sheet },
  rule: { height: 1, backgroundColor: mast.rule, marginTop: spacing.md },
  // C_recipe .q: Cormorant italic 19/1.35 in the light ink, 6 under the title; .sum: Inter 500 15/1.4, 10 under it.
  note: { ...typography.h2, fontSize: 19, lineHeight: 26, letterSpacing: 0, color: mast.ink, marginTop: 6 },
  perServing: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, letterSpacing: 0, marginTop: 10, fontVariant: ['tabular-nums'] },
  // C_recipe .ov on the paper: Inter 600 11, tracked, muted; 14 between sections.
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 14, color: sc.textMuted, marginBottom: 4 },
  sectionGap: { marginTop: 18 },
  body: { ...typography.body, flex: 1, color: sc.textPrimary },
  muted: { ...typography.body, color: sc.textMuted },
  // RecipeDetail's hairline ingredient row (RecipeDetailScreen.tsx:330).
  ingredient: { paddingVertical: 10, minHeight: layout.touchMin, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  // C_recipe .c-lead: baseline row, gap 8, at least 40 tall, Inter 16; the dotted leader runs to the right-aligned amount.
  lead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin },
  leadName: { ...typography.body, color: sc.textPrimary, flexShrink: 1 },
  dots: { flex: 1, minWidth: 16, height: 2, marginTop: 6 },
  leadAmount: { ...typography.body, color: sc.textPrimary, fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  // C_recipe's steps: a serif numeral in gold (gold 800 on the sand paper, as RecipeDetail), the step beside it.
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
  stepNo: { ...typography.h3, fontSize: 24, lineHeight: 28, minWidth: 16, color: gold[800], fontVariant: ['lining-nums'] },
  // C_recipe .foot: the page's own ground, no rule above it.
  foot: { backgroundColor: sc.bgPrimary, paddingHorizontal: layout.gutter, paddingTop: 12 },
  status: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, color: sc.textMuted, textAlign: 'center', paddingVertical: 8 },
  link: { minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 8 },
  linkText: { ...typography.bodyMd, color: sc.accentText, textDecorationLine: 'underline', textAlign: 'center' },
});

/** The page's params, for the route's callers (KITCHEN-M's "From {coach}" row). */
export type PlanMealParams = Params['PlanMeal'];
