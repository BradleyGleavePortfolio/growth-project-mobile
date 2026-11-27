/**
 * The Kitchen's sheet (KITCHEN-M, Style 2 frame S2_use): a cream sheet over the page with the meal's name, Close, its
 * numbers, the day, the meal choice and "Add to today". KitchenSheet is the frame alone (scrim, grabber, title, Close,
 * modal for VoiceOver), exported once so SAVED-MEAL-SAVE-M's sheet reuses it (R10). It closes by Close, the scrim, a
 * pull down and Android Back. The log (R6): one intended save, one key (withSaveKey); online only (R7); it closes on
 * success only, and every failure keeps it open with its line, read once by a screen reader (R11).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions, type GestureResponderEvent,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { savedFoodsApi, type SavedMeal } from '../../../api/savedFoodsApi';
import { AnalyticsEvents } from '../../../analytics/events';
import MealChoiceRow from '../../../components/log/MealChoiceRow';
import { refreshFoodLog } from '../../../components/mealplan/LogPlannedMealButton';
import { isEffectivelyOnline } from '../../../hooks/useNetworkStatus';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { track } from '../../../lib/analytics';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors as palette, layout, radius, typography, withAlpha, type SemanticTokens } from '../../../theme/tokens';
import type { MealType } from '../../../types';
import { PrimaryButton } from '../../../ui';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useBottomInset } from '../../../ui/layout/StyleCPage';
import { dayForNewLog } from '../../../utils/logDay';
import { withSaveKey } from '../../../utils/log/saveKey';
import { WORDS, addIntent, failureOf, heldNote, kcalWords, mealOfHour, mealView, sheetLine } from './kitchen';

const nowMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** A downward pull on the sheet's top closes it; a short pull springs back (the add sheet's gesture). */
function usePullDown(close: () => void) {
  const y = useRef(new Animated.Value(0)).current;
  const from = useRef(0);
  const dy = (e: GestureResponderEvent) => e.nativeEvent.pageY - from.current;
  const back = () => Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
  return { y, handlers: {
    onTouchStart: (e: GestureResponderEvent) => { from.current = e.nativeEvent.pageY; },
    onMoveShouldSetResponder: (e: GestureResponderEvent) => dy(e) > 8,
    onResponderMove: (e: GestureResponderEvent) => y.setValue(Math.max(0, dy(e))),
    onResponderRelease: (e: GestureResponderEvent) => { if (dy(e) > 80) close(); else back(); },
    onResponderTerminate: back,
  } };
}

/** The keyboard's height while it is up, 0 otherwise (SAVED-MEAL-SAVE-M SS9). */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const up = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e?.endCoordinates?.height ?? 0));
    const down = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => { up.remove(); down.remove(); };
  }, []);
  return h;
}

/**
 * The sheet's frame (R10: shared with SAVED-MEAL-SAVE-M). `footer` is pinned under the scrolling body; with a field in
 * it, the keyboard view (iOS) lifts the sheet, the sheet keeps to the window left above the keyboard and the body
 * shrinks first, so the field and its button stay in view (SAVED-MEAL-SAVE-M SS9). With no keyboard it draws as before.
 */
export function KitchenSheet({ visible, title, onClose, children, footer, testID }: {
  visible: boolean; title: string; onClose: () => void; children?: React.ReactNode; footer?: React.ReactNode; testID?: string;
}) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const bottom = useBottomInset();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pull = usePullDown(onClose);
  const keyboard = useKeyboardHeight();
  const fit = keyboard > 0
    ? { maxHeight: height - keyboard - 16, paddingBottom: 12 }
    : { maxHeight: height * 0.92, paddingBottom: bottom + 16 };
  return (
    <Modal visible={visible} transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.avoid} testID="kitchen-sheet-avoider">
        <Pressable testID="kitchen-sheet-scrim" style={s.scrim} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <Animated.View accessibilityViewIsModal testID={testID}
          style={[s.sheet, { ...fit, transform: [{ translateY: pull.y }] }]}>
          <View {...pull.handlers}>
            <View style={s.grab} testID="kitchen-sheet-grab" />
            <View style={s.head}>
              <Text accessibilityRole="header" style={s.title} testID="kitchen-sheet-title">{title}</Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={WORDS.close} style={s.close}
                testID="kitchen-sheet-close">
                <Ionicons name="close" size={28} color={sc.textPrimary} />
              </Pressable>
            </View>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.bodyIn} keyboardShouldPersistTaps="handled" testID="kitchen-sheet-body">
            {children}
          </ScrollView>
          {footer ? <View style={s.foot} testID="kitchen-sheet-foot">{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** S5 and S9 to S13: add one saved meal to today. `meal` null: closed. */
export default function SavedMealSheet({ meal, onClose, onAdded, onStale }: {
  meal: SavedMeal | null; onClose: () => void; onAdded: (meal: MealType) => void; onStale: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const [type, setType] = useState<MealType>('breakfast');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  // The meal was deleted elsewhere, or its foods were removed since the read: nothing more to send from this sheet.
  const [closedOut, setClosedOut] = useState(false);
  const sending = useRef(false);

  // R5: the meal of the hour, read when the sheet opens; she can change it.
  useEffect(() => {
    if (!meal) return;
    setType(mealOfHour(nowMinute()));
    setLine(null);
    setRetry(false);
    setClosedOut(false);
  }, [meal]);
  // R11: Android reads the live region; iOS hears the same words once.
  useEffect(() => { if (Platform.OS === 'ios' && line) AccessibilityInfo.announceForAccessibility(line); }, [line]);

  if (!meal) return null;
  const view = mealView(meal);
  const empty = view.foods.length === 0;

  const add = async () => {
    if (sending.current || empty) return;
    sending.current = true;
    setBusy(true);
    setLine(null);
    setRetry(false);
    try {
      // R7: no queue; with no connection nothing is sent or stored.
      const net = await NetInfo.fetch();
      if (!isEffectivelyOnline({ isOnline: !!net.isConnected, isInternetReachable: net.isInternetReachable })) {
        void HapticService.error();
        setLine(WORDS.offline);
        return;
      }
      const date = dayForNewLog();
      const res = await withSaveKey(addIntent(meal.id, date, type),
        (key) => savedFoodsApi.log(meal.id, { date, meal_type: type }, key));
      if (!Array.isArray(res.data) || res.data.length === 0) {
        // S12: its foods were removed since the read; the server wrote nothing.
        void HapticService.error();
        setLine(WORDS.nothingToAdd);
        setClosedOut(true);
        onStale();
        return;
      }
      void HapticService.success();
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: type, source: 'saved_meal' });
      refreshFoodLog();
      onAdded(type);
    } catch (err) {
      void HapticService.error();
      const { status, message } = failureOf(err);
      if (status === 404 && /saved meal/i.test(message)) {
        setLine(WORDS.mealGone);
        setClosedOut(true);
        onStale();
      } else if (status === 404) {
        setLine(WORDS.foodGone);
      } else {
        setLine(WORDS.notAdded);
        setRetry(!status || status >= 500);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <KitchenSheet visible title={meal.name} onClose={onClose} testID="kitchen-sheet">
      {empty ? null : <Text style={s.line}>{sheetLine(view)}</Text>}
      {view.held.length > 0 ? <Text style={s.note} testID="kitchen-held-note">{heldNote(view.held)}</Text> : null}
      {view.held.length > 0 ? (
        <View style={s.foods}>
          {view.foods.map((f, i) => (
            <View key={i} style={s.food} accessible
              accessibilityLabel={`${f.name}, ${f.amount}, ${f.ok ? kcalWords(f.kcal) : WORDS.held}`}>
              <View style={s.grow}>
                <Text style={s.foodName}>{f.name}</Text>
                <Text style={s.muted}>{f.ok ? f.amount : `${f.amount}. ${WORDS.held}`}</Text>
              </View>
              {f.ok ? <Text style={s.foodKcal}>{kcalWords(f.kcal)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {empty ? (
        <Text style={s.note} accessibilityRole="alert" testID="kitchen-nothing">{WORDS.nothingToAdd}</Text>
      ) : (
        <>
          {/* R12: Today is the only day this PR adds to: a plain line, no chevron, no picker. */}
          <View style={s.dayRow} accessible accessibilityLabel={`${WORDS.day}, ${WORDS.today}`} testID="kitchen-day">
            <Text style={s.dayLabel}>{WORDS.day}</Text>
            <Text style={s.dayValue}>{WORDS.today}</Text>
          </View>
          <Text style={s.overline} accessibilityRole="header">{WORDS.meal}</Text>
          <MealChoiceRow value={type} onChange={setType} disabled={busy} style={s.choice} testID="kitchen-meal-choice" />
          {line ? (
            <Text style={s.fail} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="kitchen-sheet-line">{line}</Text>
          ) : null}
          {closedOut ? null : (
            <View style={s.action}>
              <PrimaryButton wrap label={retry ? WORDS.tryAgain : WORDS.add} onPress={() => void add()} loading={busy}
                haptic={false} testID="kitchen-add" />
            </View>
          )}
        </>
      )}
    </KitchenSheet>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  // S2_use: the ink scrim at 42% runs under the sheet's 24 pt top corners; the sheet is cream (colors.cream).
  avoid: { flex: 1, justifyContent: 'flex-end' },
  scrim: { flex: 1, marginBottom: -radius.sheet, backgroundColor: withAlpha(sc.textPrimary, 0.42) },
  sheet: { backgroundColor: palette.cream, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: radius.chip, backgroundColor: sc.border, marginBottom: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  // S2_use: the meal's name in the 27 pt serif (56 px cap line at 2x), Close at the right.
  title: { ...typography.h2, flex: 1, fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 27,
    lineHeight: 34, letterSpacing: 0, color: sc.textPrimary, paddingTop: 4 },
  close: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  body: { flexGrow: 0, flexShrink: 1 },
  foot: { paddingTop: 10 },
  bodyIn: { paddingBottom: 4 },
  line: { ...typography.body, fontSize: 15, lineHeight: 22, letterSpacing: 0, color: sc.textMuted, marginTop: 2,
    fontVariant: ['tabular-nums'] },
  note: { ...typography.bodySmall, lineHeight: 21, color: sc.textPrimary, marginTop: 10 },
  foods: { marginTop: 8 },
  food: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  grow: { flex: 1 },
  foodName: { ...typography.body, fontSize: 15, lineHeight: 21, letterSpacing: 0, color: sc.textPrimary },
  muted: { ...typography.bodySmall, fontSize: 13, lineHeight: 19, color: sc.textMuted },
  foodKcal: { ...typography.bodySmall, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
  // S2_use: Day and Today on one 44 pt line, a hairline under it, 22 pt above.
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
    minHeight: layout.touchMin, marginTop: 18, paddingVertical: 8, borderBottomWidth: 1, borderColor: sc.border },
  dayLabel: { ...typography.body, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textPrimary },
  dayValue: { ...typography.body, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textMuted },
  overline: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5, lineHeight: 14,
    letterSpacing: 2, textTransform: 'uppercase', color: sc.textMuted, marginTop: 22, marginBottom: 10 },
  // The one meal choice (R5) on the cream sheet: its own cream track gains a hairline so it reads as a control.
  choice: { borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  fail: { ...typography.bodySmall, lineHeight: 21, color: sc.textPrimary, marginTop: 14 },
  action: { marginTop: 18 },
});
