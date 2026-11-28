/**
 * KITCHEN-DOOR-M (the owner's PICK #ALM-P2 "door from food", DOORS frame 2): the add sheet's Saved meals tab. Her saved
 * meals, each added to the sheet's meal and day in one tap (R4), with Open Kitchen under them (R8), the Kitchen's one
 * door. The read is the Kitchen's (its key, query and stored shape), mounted only while the tab shows; every number,
 * total rule and word the Kitchen also shows comes from kitchen.ts (R5); the add itself is LogScreen's, through the
 * Kitchen's exported add step (R6). The undrawn states (loading, failed, empty, adding, not added) follow the sheet's own
 * family with the Kitchen's words (R9).
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { SAVED_MEALS_KEY, savedFoodsApi, type SavedMeal } from '../../api/savedFoodsApi';
import { WORDS, foodsLine, heldNote, mealView, mealWord, proteinWords, rowSpoken, savedMealsOf } from '../../screens/client/kitchen/kitchen';
import type { AddOutcome } from '../../screens/client/kitchen/kitchenAdd';
import { formatPlanNumber } from '../../screens/client/mealplan/planStyleC';
import { layout, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import type { MealType } from '../../types';
import { QuietTextButton, TextLink } from '../../ui';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import { StyleCLoadingLines } from '../../ui/layout/StyleCPage';
import HapticPressable from '../HapticPressable';

// This job's words (137-2, approved (operator, #203-E15) with the pick); every other word is the Kitchen's or main's.
export const DOOR_WORDS = {
  tab: 'Saved meals', // C2-S-64
  open: 'Open Kitchen', // KM-23
  openHint: 'Opens your kitchen', // KK-1 (spoken)
} as const;
/** KD-1 (spoken hint): "Adds it to breakfast", the sheet's meal in a sentence. */
export const addsToWords = (meal: MealType): string => `Adds it to ${mealWord(meal)}`;

/** Why the last tap added nothing; 'offline' is the tap with no connection (R7), which sends nothing. */
export type SavedMealFailure = { meal: SavedMeal; outcome: Exclude<AddOutcome, 'added'> | 'offline' };
/** D7: each outcome's line (KK-5 to KK-9); Try again only for a lost answer, which resends the same key. */
const LINES: Record<SavedMealFailure['outcome'], string> = {
  empty: WORDS.nothingToAdd, 'food-not-found': WORDS.foodGone, 'meal-gone': WORDS.mealGone, lost: WORDS.notAdded,
  refused: WORDS.notAdded, offline: WORDS.offline,
};
// KM-7 as the sheet's empty layout: its first sentence the title, the second the line under it (the same words).
const [EMPTY_TITLE, EMPTY_LINE] = WORDS.empty.split('. ');

/** What the sheet passes to show the tab (R3: only a sheet with no plan or usual-meal link). */
export interface SavedPart {
  /** The sheet's meal, for the rows' hint. */
  mealType: MealType;
  onAdd: (meal: SavedMeal) => void;
  /** The meal whose add is running: its row spins (D5). */
  savingId: string | null;
  failure: SavedMealFailure | null;
  /** Absent outside a navigator (and in a sheet the Kitchen mounts itself): no link. */
  onOpenKitchen?: () => void;
}

export default function SavedMealsTab({ part, saving, listStyle }: {
  part: SavedPart;
  /** Any save of the sheet running: every row and Open Kitchen are off. */
  saving?: boolean;
  /** The sheet list's own padding (the Recent list's). */
  listStyle?: StyleProp<ViewStyle>;
}) {
  const { semanticColors: sc } = useTheme();
  const s = makeStyles(sc);
  // The Kitchen's read: its key, the same request and the same stored shape (KitchenScreen.tsx), so a save, rename or
  // delete on the Kitchen shows here and a read here shows there.
  const q = useQuery({ queryKey: SAVED_MEALS_KEY, queryFn: () => savedFoodsApi.list().then((r) => r.data as unknown) });
  const meals = savedMealsOf(q.data);
  const line = part.failure ? LINES[part.failure.outcome] : null;
  // Android reads the live region; iOS hears the same words once (QuantityPickerModal's way).
  useEffect(() => { if (Platform.OS === 'ios' && line) AccessibilityInfo.announceForAccessibility(line); }, [line, part.failure]);

  const failureLine = part.failure && line ? (
    <View style={s.failure} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="saved-meals-failure">
      <Ionicons name="information-circle-outline" size={16} color={sc.textMuted} />
      <Text style={s.failureText}>{line}</Text>
      {part.failure.outcome === 'lost' ? (
        <QuietTextButton label={WORDS.tryAgain} disabled={saving} onPress={() => part.failure && part.onAdd(part.failure.meal)}
          testID="saved-meals-try-again" />
      ) : null}
    </View>
  ) : null;

  const state = meals ? null : q.isFetching ? (
    // D2: three still rows in the list's place, read once.
    <View style={s.state} testID="saved-meals-loading"><StyleCLoadingLines rows={3} label={WORDS.loading} /></View>
  ) : (
    // D3: the sheet's failed layout, never "No saved meals yet" or an empty list from a failed read.
    <View style={s.empty} testID="saved-meals-failed">
      <Text style={s.emptyTitle}>{WORDS.failed}</Text>
      <Text style={s.emptyLine}>{WORDS.failedLine}</Text>
      <TextLink label={WORDS.tryAgain} tone="accent" underline={false} onPress={() => void q.refetch()} testID="saved-meals-retry" />
    </View>
  );

  return (
    <FlatList
      testID="saved-meals"
      data={meals ?? []}
      keyExtractor={(m) => m.id}
      renderItem={({ item }) => (
        <MealRow meal={item} part={part} busy={part.savingId === item.id} off={!!saving} s={s} sc={sc} />
      )}
      ListHeaderComponent={failureLine}
      ListEmptyComponent={state ?? (
        // D4: the sheet's empty layout with the Kitchen's words.
        <View style={s.empty} testID="saved-meals-empty">
          <Text style={s.emptyTitle}>{EMPTY_TITLE}</Text>
          <Text style={s.emptyLine}>{EMPTY_LINE}</Text>
        </View>
      )}
      // R8 (D1's rule, choice (b)): at the end of the rows' scroll, in every state of the tab.
      ListFooterComponent={part.onOpenKitchen ? (
        <TextLink label={DOOR_WORDS.open} tone="accent" accessibilityHint={DOOR_WORDS.openHint} disabled={saving}
          onPress={part.onOpenKitchen} style={s.open} testID="saved-meals-open-kitchen" />
      ) : null}
      contentContainerStyle={listStyle}
      keyboardShouldPersistTaps="handled"
    />
  );
}

type Styles = ReturnType<typeof makeStyles>;
type Sc = ReturnType<typeof useTheme>['semanticColors'];

function MealRow({ meal, part, busy, off, s, sc }: { meal: SavedMeal; part: SavedPart; busy: boolean; off: boolean; s: Styles; sc: Sc }) {
  const view = mealView(meal);
  const names = view.foods.map((f) => f.name);
  const body = (
    <View style={s.rowText}>
      <Text style={s.name}>{meal.name}</Text>
      <Text style={s.sub}>{names.length > 0 ? foodsLine(names) : WORDS.noFoods}</Text>
      {view.held.length > 0 ? <Text style={s.sub} testID={`saved-meal-held-${meal.id}`}>{heldNote(view.held)}</Text> : null}
    </View>
  );
  // D9: a meal with no foods left is not a button and sends nothing.
  if (view.foods.length === 0) {
    return <View style={s.row} accessible accessibilityLabel={rowSpoken(meal, view)} testID={`saved-meal-${meal.id}`}>{body}</View>;
  }
  const spoken = [rowSpoken(meal, view), foodsLine(names), view.held.length > 0 ? heldNote(view.held) : null].filter(Boolean).join(', ');
  return (
    <HapticPressable intent="light" style={s.row} onPress={() => part.onAdd(meal)} disabled={off}
      accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={addsToWords(part.mealType)}
      accessibilityState={{ busy, disabled: off }} testID={`saved-meal-${meal.id}`}>
      {body}
      <View style={s.nums}>
        {busy ? <ActivityIndicator size="small" color={sc.accentText} testID="saved-meal-busy" />
          : view.total ? (
            <>
              <Text style={s.kcal}>{formatPlanNumber(view.total.kcal)}<Text style={s.unit}> kcal</Text></Text>
              <Text style={s.protein}>{proteinWords(view.total.protein)}</Text>
            </>
          ) : <Text style={s.protein}>{WORDS.noTotal}</Text>}
      </View>
    </HapticPressable>
  );
}

const makeStyles = (sc: Sc) => StyleSheet.create({
  // The sheet's food row (C_add .c-li): a hairline under, at least 56 tall; P_food draws 72 with two lines (14 above and below).
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border,
  },
  rowText: { flex: 1, gap: 2 },
  // The food row's name (.nm): Cormorant 500 18/23.4.
  name: { fontFamily: typography.h3.fontFamily, fontWeight: typography.h3.fontWeight, fontSize: 18, lineHeight: 23.4, color: sc.textPrimary },
  // The food row's line (.st): Inter 13/18.2, muted.
  sub: { fontSize: 13, lineHeight: 18.2, color: sc.textMuted },
  // P_food: the calories in Inter 500 with a small muted "kcal", the protein under, both at the right.
  nums: { alignItems: 'flex-end', paddingTop: 2 },
  kcal: { fontFamily: typography.bodyMd.fontFamily, fontSize: 16, lineHeight: 22, color: sc.textPrimary, fontVariant: ['lining-nums', 'tabular-nums'] },
  unit: { fontFamily: typography.body.fontFamily, fontSize: 12, color: sc.textMuted },
  protein: { fontSize: 12, lineHeight: 17, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  // The search error line (FoodSearchView searchErrorBanner): the info glyph, Inter 13.
  failure: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 10, marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border,
  },
  failureText: { fontSize: 13, lineHeight: 18.2, color: sc.textPrimary, flex: 1, minWidth: 160 },
  state: { paddingTop: 8 },
  // The sheet's empty and failed layouts (emptyStateContainer).
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 8, gap: 8 },
  emptyTitle: { ...typography.h3, color: sc.textPrimary, textAlign: 'center' },
  emptyLine: { fontSize: 13, lineHeight: 19, color: sc.textMuted, textAlign: 'center' },
  // P_food: Open Kitchen centred under the last row (its 44 pt box 16 under the hairline).
  open: { marginTop: 16 },
});
