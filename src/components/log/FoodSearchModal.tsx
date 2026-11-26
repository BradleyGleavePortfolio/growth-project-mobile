import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import HapticPressable from '../HapticPressable';
import { layout, radius, typography, withAlpha, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { TextLink, useScreenInsets } from '../../ui';
import { SearchResult, MEAL_SECTIONS } from '../../utils/log/types';
import { MealType } from '../../types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { clockOf } from '../../utils/log/foodTimeline';
import FoodSearchView from './FoodSearchView';
import MealChoiceRow from './MealChoiceRow';
import ManualFoodEntryForm, { ManualFields } from './ManualFoodEntryForm';
import SheetGrip from './SheetGrip';
import { SheetGlyph } from './AddSheetGlyphs';

interface Props {
  visible: boolean;
  activeMealType: MealType;
  /** UI-3d: when set (the Food tab's Extras "Add"), the meal choice shows and a tap files the next food under that meal. */
  onMealChange?: (mealType: MealType) => void;
  onClose: () => void;
  addedFoodName?: string | null;

  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  onRetrySearch: () => void;
  searching: boolean;
  showSlowMessage: boolean;
  searchError: string | null;
  searchResults: SearchResult[];
  didYouMean: SearchResult[];

  recentTab: 'recent' | 'frequent';
  onRecentTabChange: (tab: 'recent' | 'frequent') => void;
  recentFoods: SearchResult[];
  frequentFoods: SearchResult[];
  browseUnavailable?: boolean;

  onSelectFood: (food: SearchResult) => void;

  repeatMeal?: PastMeal | null;
  repeatMealTitle?: string;
  onRepeatMeal?: () => void;

  manualMode: boolean;
  onEnterManualMode: () => void;
  onExitManualMode: () => void;

  manualFields: ManualFields;
  onManualFieldChange: (field: keyof ManualFields, value: string) => void;
  onManualLog: () => void;
  saving?: boolean;
  portionPicker?: React.ReactNode;
  /**
   * REFINE-968 (operator ruling 3): whether a food saved now files under today (LogScreen passes the save's own day
   * rule). When it does, the title is "Add at {clock}" over the meal (C_add); otherwise, or when absent, "Add to {meal}".
   */
  savesToday?: () => boolean;
}

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** The phone's minute, read at each render and moved on by a 60 s tick while the sheet is open (the Food day's tick
 *  shape), so a sheet reopened later never shows the minute it last closed on. */
function useSheetClock(on: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [on]);
  return nowMinutes();
}

/** A downward pull on the top of the sheet closes it (the swipe iOS gave the page sheet); a short pull springs back. */
function usePullToClose(shut: () => boolean) {
  const pull = useRef(new Animated.Value(0)).current;
  const from = useRef(0);
  const dy = (e: GestureResponderEvent) => e.nativeEvent.pageY - from.current;
  const back = () => Animated.spring(pull, { toValue: 0, useNativeDriver: true }).start();
  const handlers = {
    onTouchStart: (e: GestureResponderEvent) => { from.current = e.nativeEvent.pageY; },
    onMoveShouldSetResponder: (e: GestureResponderEvent) => dy(e) > 8,
    onResponderMove: (e: GestureResponderEvent) => pull.setValue(Math.max(0, dy(e))),
    onResponderRelease: (e: GestureResponderEvent) => { if (!(dy(e) > 80 && shut())) back(); },
    onResponderTerminate: back,
  };
  return { pull, handlers };
}

export default function FoodSearchModal(props: Props) {
  const {
    visible,
    activeMealType,
    onClose,
    manualMode,
    onEnterManualMode,
    onExitManualMode,
    manualFields,
    onManualFieldChange,
    onManualLog,
  } = props;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const insets = useScreenInsets();
  const { height } = useWindowDimensions();
  // C_add's markup: 90% of the space between the status bar and the home indicator, the sheet then running on under the
  // home indicator (its bottom padding), as the GOAL frame draws it.
  const sheetHeight = (height - insets.top - insets.bottom) * 0.9 + insets.bottom;
  // REFINE-968 (ruling 2): the sheet sits over the day. The dim and the pull close it through the same onClose as the
  // close, Done and the system Back, and nothing closes it while a food saves.
  const shut = () => { if (props.saving) return false; onClose(); return true; };
  const { pull, handlers } = usePullToClose(shut);
  const portionOpen = !!props.portionPicker;
  useEffect(() => { if (visible) pull.setValue(0); }, [visible, portionOpen, pull]);
  // REFINE-968 (ruling 3): the day rule is read again on each tick of the clock.
  const now = useSheetClock(visible && !!props.savesToday);
  const meal = MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label;
  const at = props.savesToday?.() ? clockOf(now) : null;
  const title = at ? `Add at ${at}` : `Add to ${meal}`;

  return (
    <Modal testID="food-search-sheet" visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.over, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={!portionOpen}
      >
        <Pressable testID="food-search-dim" style={[StyleSheet.absoluteFill, styles.dim]} onPress={shut}
          accessible={false} importantForAccessibility="no" />
        <Animated.View testID="food-search-frame" accessibilityViewIsModal
          style={[styles.sheet, { height: sheetHeight, transform: [{ translateY: pull }] }]}>
          <View style={[styles.clip, { paddingBottom: insets.bottom }]}>
            {portionOpen ? (
              <>
                {props.portionPicker}
                {/* Over the portion picker's own grab (QuantityPickerModal draws it), so the pull works there too. */}
                <View testID="food-search-drag" style={styles.portionPull} {...handlers} />
              </>
            ) : (
              <>
                <View testID="food-search-drag" {...handlers}>
                  <SheetGrip />
                  <View style={styles.modalHeader}>
                    <View style={styles.titleBlock} accessible accessibilityRole="header"
                      accessibilityLabel={at ? `${title}, ${meal}` : title}>
                      <Text testID="food-search-title" style={styles.modalTitle}>{title}</Text>
                      {at ? <Text testID="food-search-meal" style={styles.mealLine}>{meal}</Text> : null}
                    </View>
                    {props.addedFoodName ? (
                      <TextLink label="Done" tone="accent" underline={false} disabled={props.saving} onPress={onClose} style={styles.closeButton} />
                    ) : (
                      <HapticPressable intent="light" onPress={onClose} disabled={props.saving} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close food search">
                        <SheetGlyph name="close" size={22} color={sc.textPrimary} />
                      </HapticPressable>
                    )}
                  </View>
                </View>

                {props.onMealChange ? (
                  <MealChoiceRow testID="food-search-meals" value={activeMealType} onChange={props.onMealChange} disabled={props.saving}
                    style={styles.mealRow} />
                ) : null}

                {props.addedFoodName ? (
                  <Text style={styles.addedMessage} accessibilityLiveRegion="polite">
                    Added {props.addedFoodName}.
                  </Text>
                ) : null}

                <View style={styles.modalContainer}>
                  {!manualMode ? (
                    <FoodSearchView
                      searchQuery={props.searchQuery}
                      onSearchChange={props.onSearchChange}
                      onClearSearch={props.onClearSearch}
                      onRetrySearch={props.onRetrySearch}
                      searching={props.searching}
                      showSlowMessage={props.showSlowMessage}
                      searchError={props.searchError}
                      searchResults={props.searchResults}
                      didYouMean={props.didYouMean}
                      recentTab={props.recentTab}
                      onRecentTabChange={props.onRecentTabChange}
                      recentFoods={props.recentFoods}
                      frequentFoods={props.frequentFoods}
                      browseUnavailable={props.browseUnavailable}
                      onSelectFood={props.onSelectFood}
                      repeatMeal={props.repeatMeal}
                      repeatMealTitle={props.repeatMealTitle}
                      onRepeatMeal={props.onRepeatMeal}
                      saving={props.saving}
                      onEnterManualMode={onEnterManualMode}
                    />
                  ) : (
                    <ManualFoodEntryForm
                      fields={manualFields}
                      onFieldChange={onManualFieldChange}
                      onBack={onExitManualMode}
                      onSubmit={onManualLog}
                      saving={props.saving}
                    />
                  )}
                </View>
              </>
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  addedMessage: { ...typography.bodySmall, color: sc.accentText, paddingHorizontal: layout.gutter, paddingTop: 12 },
  closeButton: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  mealRow: { marginHorizontal: layout.gutter, marginTop: 12 },
  modalContainer: {
    flex: 1,
  },
  // REFINE-968 (C_add.html :110 .c-sheet): the day shows under an ink dim at 0.36; the sheet sits at the bottom.
  over: { flex: 1, justifyContent: 'flex-end' },
  dim: { backgroundColor: withAlpha(sc.textPrimary, 0.36) },
  // :59 .sheet: the surface fill (ruling 9), top corners 24, shadow 0 -4 12 at 0.08 (iOS; a radius of half the blur).
  // It shrinks above the keyboard rather than running under the status bar.
  sheet: {
    flexShrink: 1,
    backgroundColor: sc.bgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    shadowColor: sc.textPrimary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  clip: { flex: 1, overflow: 'hidden', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  // The portion picker's grab area: 10 above, 5, 14 below (QuantityPickerModal's own grip), across the sheet.
  portionPull: { position: 'absolute', top: 0, left: 0, right: 0, height: 29 },
  // :155 .row: the title block left, the close's 44 pt box at the right edge of the gutter.
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
  },
  titleBlock: { flex: 1 },
  // :45 .h2: Cormorant 500 24/30.
  modalTitle: {
    fontFamily: typography.h3.fontFamily,
    fontWeight: typography.h3.fontWeight,
    fontSize: 24,
    lineHeight: 30,
    color: sc.textPrimary,
  },
  // :49 .meta: Inter 14/20, muted.
  mealLine: { fontFamily: typography.bodySmall.fontFamily, fontSize: 14, lineHeight: 20, color: sc.textMuted },
});
