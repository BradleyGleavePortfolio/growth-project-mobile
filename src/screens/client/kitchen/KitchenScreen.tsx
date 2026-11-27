/**
 * The Kitchen page (KITCHEN-M; the owner's PICK #ALM-P2, #ALM-E26: Style 2 Menu, after Paprika; frames S2_* on ctx#610).
 * One calm menu on the Style C kitchen page: her saved meals (a tap opens the sheet that adds one to today), the owner's
 * "Log food" button, From {coach} with today's next plan meal for a client with a coach, then rows to Recipes, the
 * approved Grocery list, the Prep guide and Food this week. A client with no coach gets the same page without the
 * coach's parts, and the page makes no coach, plan or day read for her. A read that failed never shows as zero or empty.
 * Opened from the Food tab's add sheet (KITCHEN-DOOR-M, the owner's "door from food"); 'Kitchen' in the More stack.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import api, { logApi, recipesApi } from '../../../services/api';
import { mealTemplatesApi } from '../../../api/mealTemplatesApi';
import { SAVED_MEALS_KEY, savedFoodsApi, type SavedMeal } from '../../../api/savedFoodsApi';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { useClientStore } from '../../../store/clientStore';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  layout, radius, schemeBar, schemeCard, schemeCardOutline, typography, withAlpha, type SemanticTokens,
} from '../../../theme/tokens';
import type { MealType } from '../../../types';
import { PrimaryButton, Screen } from '../../../ui';
import { StyleCMasthead, StyleCMastText, StyleCNotice, StyleCPaper, usePullToRefresh, useStyleCScreen } from '../../../ui/layout/StyleCPage';
import { getTodayString } from '../../../utils/date';
import { fetchOneList, toGet } from '../GroceryListScreen';
import SaveMealSheet from './SaveMealSheet';
import SavedMealSheet from './SavedMealSheet';
import {
  SAVE_WORDS, WORDS, addedWords, coachFirst, fromCoach, kcalWords, mealView, planCard, recipesDetail, rowSpoken, savedMealsOf, toGetWords,
} from './kitchen';
import { atLimit } from './saveMeal';
import { useSavedMealWrites } from './useSavedMealWrites';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function KitchenScreen() {
  const user = useCurrentUser();
  // Remount on identity change, so no meal, count or late answer crosses accounts.
  return <KitchenPage key={user?.id ?? 'signed-out'} coachId={user?.coach_id ?? null} />;
}

function KitchenPage({ coachId }: { coachId: string | null }) {
  const page = useStyleCScreen();
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const online = isEffectivelyOnline(useNetworkStatus());
  // R8: the Food tab's own test (LogScreen.tsx:767); a client whose coach left has no coach_id.
  const coached = !!coachId;
  const today = getTodayString();

  const saved = useQuery({ queryKey: SAVED_MEALS_KEY, queryFn: () => savedFoodsApi.list().then((r) => r.data as unknown) });
  // R9: the Grocery page's own read, key and shape (GroceryListScreen.tsx), so a tick there changes the count here.
  const grocery = useQuery({ queryKey: ['lists', 'grocery'], queryFn: fetchOneList, staleTime: 60 * 1000 });
  // The Recipes page's own read (RecipesScreen.tsx listQuery).
  const recipes = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list().then((r) => r.data as Array<{ created_by_id?: string }>),
    staleTime: 5 * 60 * 1000,
  });
  // R8: the Food day's reads under its keys and shapes (FoodDayView.tsx, useApi.ts useTodayLog), coached only.
  const plan = useQuery({
    queryKey: ['meal-plan', 'today', today],
    queryFn: () => mealTemplatesApi.todayForClient(today).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: coached,
  });
  const daily = useQuery({
    queryKey: ['food', 'log', today],
    queryFn: async () => (await logApi.getDaily(today)).data as unknown,
    enabled: coached,
  });
  const coach = useQuery({
    queryKey: ['clients', 'me', 'coach'],
    queryFn: () => api.get<{ name?: string }>('/v1/clients/me/coach').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: coached,
  });

  const readAll = () => Promise.all([
    saved.refetch(), grocery.refetch(), recipes.refetch(),
    ...(coached ? [plan.refetch(), daily.refetch(), coach.refetch()] : []),
  ]);
  const { pulling, onRefresh } = usePullToRefresh(readAll);

  const [sheetMeal, setSheetMeal] = useState<SavedMeal | null>(null);
  const [added, setAdded] = useState<MealType | null>(null);
  // SAVED-MEAL-SAVE-M: the save sheet, and the three writes (R7: after a save the page shows her meals from the first).
  const [saving, setSaving] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const writes = useSavedMealWrites(() => scroll.current?.scrollTo({ y: 0, animated: false }));

  // Back on the page (from the Food tab, the Grocery page or a recipe) every read is fresh again; the page stays
  // mounted and the app's queries do not refetch on focus (queryClient.ts), so the focus after the first re-reads.
  const onFocus = useRef<() => void>(() => undefined);
  onFocus.current = () => { void readAll(); };
  useEffect(() => {
    let first = true;
    const offFocus = navigation.addListener('focus', () => { if (first) { first = false; return; } onFocus.current(); });
    // R11: the Added bar goes when she leaves the page.
    const offBlur = navigation.addListener('blur', () => setAdded(null));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);
  // R11: the bar's words, once, for VoiceOver (Android reads the live region).
  useEffect(() => { if (Platform.OS === 'ios' && added) AccessibilityInfo.announceForAccessibility(addedWords(added)); }, [added]);

  const meals = savedMealsOf(saved.data);
  const first = coached && coach.isSuccess ? coachFirst(coach.data) : null;
  const card = coached && plan.isSuccess && daily.isSuccess ? planCard(plan.data, daily.data, today) : null;
  const recipeList = recipes.isSuccess && Array.isArray(recipes.data) ? recipes.data : null;
  const recipeCount = recipeList
    ? recipesDetail(recipeList.length, coached ? recipeList.filter((r) => r?.created_by_id === coachId).length : 0,
      coached ? first ?? 'your coach' : null)
    : null;
  const groceryCount = grocery.isSuccess && Array.isArray(grocery.data) ? toGetWords(toGet(grocery.data, 'grocery')) : null;

  const openToday = () => {
    useClientStore.getState().setSelectedDate(getTodayString());
    (navigation.getParent() ?? navigation).navigate('Log');
  };
  const openMeal = (meal: SavedMeal) => { setAdded(null); setSheetMeal(meal); };
  const openSave = () => { setAdded(null); setSaving(true); };

  return (
    <Screen edges={['top']} scroll={false} {...page} testID="kitchen-screen">
      <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.grow} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl testID="kitchen-refresh" refreshing={pulling} onRefresh={onRefresh} tintColor={sc.textOnAccent} />}>
        <StyleCMasthead title={WORDS.title} onBack={() => navigation.goBack()} backLabel="Go back">
          {saved.isPending
            ? <View style={s.mastBone} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="kitchen-mast-bone" />
            : <StyleCMastText>{WORDS.mastLine}</StyleCMastText>}
        </StyleCMasthead>
        <StyleCPaper scrolls style={s.paper}>
          <Text style={s.overline} accessibilityRole="header">{WORDS.yourMeals}</Text>
          {meals ? (
            <View style={s.card} testID="kitchen-meals">
              {meals.length === 0 ? <Text style={s.empty} testID="kitchen-empty">{WORDS.empty}</Text> : meals.map((meal, i) => (
                <MealRow key={meal.id} meal={meal} first={i === 0} onPress={() => openMeal(meal)} s={s} />
              ))}
              {/* SAVED-MEAL-SAVE-M SS0: the group's last row, only when the meals read worked (S2_page, S2_empty). */}
              <Pressable onPress={openSave} accessibilityRole="button" accessibilityLabel={SAVE_WORDS.way}
                accessibilityHint={atLimit(meals) ? undefined : SAVE_WORDS.wayHint}
                style={({ pressed }) => [s.row, s.rule, pressed && s.pressed]} testID="kitchen-save-way">
                <Ionicons name="add" size={24} color={sc.accent} />
                <Text style={s.saveWay}>{SAVE_WORDS.way}</Text>
              </Pressable>
            </View>
          ) : saved.isPending ? (
            <View style={s.card} accessible accessibilityLabel={WORDS.loading} testID="kitchen-loading">
              {[0, 1, 2].map((k) => (
                <View key={k} style={[s.row, k > 0 && s.rule]}>
                  <View style={[s.bone, s.boneName]} /><View style={[s.bone, s.boneKcal]} />
                </View>
              ))}
            </View>
          ) : (
            <View style={s.error} testID="kitchen-error">
              <StyleCNotice title={WORDS.failed}>{WORDS.failedLine}</StyleCNotice>
              <PrimaryButton wrap label={WORDS.tryAgain} onPress={() => void saved.refetch()} disabled={saved.isFetching} haptic={false}
                testID="kitchen-retry" />
            </View>
          )}

          {/* The owner's addition (#ALM-E26): the page's primary action under her meals; off while offline. */}
          <View style={s.logButton}>
            <PrimaryButton wrap label={WORDS.logButton} accessibilityHint={WORDS.logButtonHint} onPress={openToday} disabled={!online}
              testID="kitchen-log-food" />
          </View>

          {coached && card ? (
            <>
              <Text style={s.overline} accessibilityRole="header" testID="kitchen-from">{fromCoach(first)}</Text>
              <Pressable onPress={() => navigation.navigate('ClientDailyMealPlan')} accessibilityRole="button"
                accessibilityLabel={[card.name, card.line, card.kcal != null ? kcalWords(card.kcal) : null].filter(Boolean).join(', ')}
                style={({ pressed }) => [s.card, s.planCard, pressed && s.pressed]} testID="kitchen-plan-card">
                <View style={s.flex}>
                  <Text style={s.serif}>{card.name}</Text>
                  <Text style={s.muted}>{card.line}</Text>
                </View>
                {card.kcal != null ? <Kcal kcal={card.kcal} s={s} /> : null}
                <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} />
              </Pressable>
            </>
          ) : null}

          <Text style={s.overline} accessibilityRole="header">{WORDS.more}</Text>
          <View style={s.card}>
            <MenuRow icon="restaurant-outline" label={WORDS.recipes} detail={recipeCount} onPress={() => navigation.navigate('Recipes')} first s={s} sc={sc} />
            <MenuRow icon="cart-outline" label={WORDS.grocery} detail={groceryCount} onPress={() => navigation.navigate('GroceryList')} s={s} sc={sc} />
            <MenuRow icon="clipboard-outline" label={WORDS.prep} onPress={() => navigation.navigate('PrepGuide')} s={s} sc={sc} />
            <MenuRow icon="analytics-outline" label={WORDS.week} onPress={() => navigation.navigate('FoodWeek')} s={s} sc={sc} />
          </View>
        </StyleCPaper>
      </ScrollView>

      {added ? (
        <View style={s.bar} accessibilityLiveRegion="polite" testID="kitchen-added">
          <Ionicons name="checkmark" size={18} color={schemeBar.text} />
          <Text style={[s.barText, s.barWords]}>{addedWords(added)}</Text>
          <Pressable onPress={() => { setAdded(null); openToday(); }} accessibilityRole="button" accessibilityLabel={WORDS.seeToday}
            style={s.barLink} testID="kitchen-see-today">
            <Text style={[s.barText, s.underline]}>{WORDS.seeToday}</Text>
          </Pressable>
        </View>
      ) : null}

      {saving && meals ? <SaveMealSheet meals={meals} writes={writes} onClose={() => setSaving(false)} /> : null}
      <SavedMealSheet meal={sheetMeal} onClose={() => setSheetMeal(null)}
        onAdded={(meal) => { setSheetMeal(null); setAdded(meal); }} onStale={() => void saved.refetch()} />
    </Screen>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Kcal({ kcal, s }: { kcal: number; s: Styles }) {
  const [num, unit] = kcalWords(kcal).split(' ');
  return <Text style={s.kcal}>{num}<Text style={s.kcalUnit}>{` ${unit}`}</Text></Text>;
}

/** One saved meal: its serif name and its total (KK-2 with no total, KK-8a under the name with no foods). */
function MealRow({ meal, first, onPress, s }: { meal: SavedMeal; first: boolean; onPress: () => void; s: Styles }) {
  const view = mealView(meal);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={rowSpoken(meal, view)}
      style={({ pressed }) => [s.row, !first && s.rule, pressed && s.pressed]} testID={`kitchen-meal-${meal.id}`}>
      <View style={s.flex}>
        <Text style={s.serif}>{meal.name}</Text>
        {view.foods.length === 0 ? <Text style={s.muted}>{WORDS.noFoods}</Text> : null}
      </View>
      {view.total ? <Kcal kcal={view.total.kcal} s={s} /> : view.foods.length > 0 ? <Text style={s.noTotal}>{WORDS.noTotal}</Text> : null}
    </Pressable>
  );
}

/** One row of "More in your kitchen": icon, label, its count when its read succeeded, chevron. */
function MenuRow({ icon, label, detail, onPress, first, s, sc }: {
  icon: IconName; label: string; detail?: string | null; onPress: () => void; first?: boolean; s: Styles; sc: SemanticTokens;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={({ pressed }) => [s.row, !first && s.rule, pressed && s.pressed]} testID={`kitchen-row-${label}`}>
      <Ionicons name={icon} size={22} color={sc.textPrimary} />
      <Text style={[s.flex, s.menuLabel]}>{label}</Text>
      {detail ? <Text style={s.detail}>{detail}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} />
    </Pressable>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  mastBone: { height: 14, width: '60%', marginTop: 12, borderRadius: radius.button, backgroundColor: withAlpha(sc.textOnAccent, 0.16) },
  // S2_page (2 px = 1 pt): the paper's words start 22 pt under its top, 24 pt gutters, 140 pt under the last card.
  paper: { paddingHorizontal: layout.gutter, paddingTop: 22, paddingBottom: 140 },
  overline: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5, lineHeight: 14,
    letterSpacing: 2, textTransform: 'uppercase', color: sc.textMuted, marginLeft: 4, marginBottom: 14, marginTop: 6 },
  // Every panel is the cream card (203-D40 op 1): the forest left edge, the border colour on the other three sides.
  card: { ...schemeCard, ...schemeCardOutline, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderRadius: radius.card, overflow: 'hidden', marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 16, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderColor: sc.border },
  pressed: { opacity: 0.6 },
  serif: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', fontSize: 21, lineHeight: 27,
    letterSpacing: 0, color: sc.textPrimary },
  muted: { ...typography.bodySmall, fontSize: 14, lineHeight: 20, color: sc.textMuted, marginTop: 2 },
  kcal: { ...typography.bodyMd, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
  kcalUnit: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted },
  noTotal: { ...typography.bodySmall, color: sc.textMuted },
  empty: { ...typography.body, fontSize: 15, lineHeight: 22, letterSpacing: 0, color: sc.textMuted, padding: 16 },
  bone: { height: 14, borderRadius: radius.button, backgroundColor: sc.data.trackLight },
  boneName: { flex: 1, maxWidth: '55%' },
  boneKcal: { width: 56, marginLeft: 'auto' },
  error: { gap: 14, marginBottom: 20 },
  logButton: { marginTop: -4, marginBottom: 26 },
  planCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 14 },
  saveWay: { ...typography.body, flexShrink: 1, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.accent,
    textDecorationLine: 'underline' },
  menuLabel: { ...typography.h4, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textPrimary },
  detail: { ...typography.bodySmall, fontSize: 15, lineHeight: 21, color: sc.textMuted, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  // R11: the forest "Added" bar over the page, above the tab bar, inside the page (W2).
  bar: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 8, minHeight: 56, borderRadius: radius.button, backgroundColor: schemeBar.fill,
    borderWidth: 1, borderColor: schemeBar.border },
  barText: { ...typography.bodySmall, fontSize: 15, lineHeight: 21, color: schemeBar.text },
  barLink: { minHeight: layout.touchMin, justifyContent: 'center', marginLeft: 'auto' },
  barWords: { flexShrink: 1 },
  underline: { textDecorationLine: 'underline' },
});
