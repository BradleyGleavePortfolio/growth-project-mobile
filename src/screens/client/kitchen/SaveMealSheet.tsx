/**
 * "Save a meal from today" (SAVED-MEAL-SAVE-M; the owner's PICK #ALM-P2, Style 2 Menu, frame S2_save on ctx#610): the
 * Kitchen's sheet frame (KitchenSheet) over the page with every food logged today, by meal, newest meal first; she
 * ticks the foods that belong together, keeps or changes the name and saves. The Name field and the button sit in the
 * sheet's pinned foot, above the keyboard (SS9). It closes on success only; her picks and her name survive every
 * failure. One send at a time, and after a lost answer the list is read again before anything is sent again (R6).
 * MealNameField is the one Name field; the meal sheet's Rename body reuses it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SaveMealBody, SavedMeal } from '../../../api/savedFoodsApi';
import { useTodayLog } from '../../../hooks/useApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui';
import { StyleCCheck, StyleCLoadingLines, StyleCNotice } from '../../../ui/layout/StyleCPage';
import { getTodayString } from '../../../utils/date';
import { formatPlanNumber as n } from '../mealplan/planStyleC';
import { SAVE_WORDS, WORDS, kcalWords, saveFoodsWords, savedMealsOf, untickWords } from './kitchen';
import {
  NAME_MAX, SAVED_MEAL_ITEMS_MAX, atLimit, dayGroups, defaultName, firstPicks, groupTitle, lostSaveIn, nameOk, pickedFoods, saveBody,
  todayEntries, type DayFood,
} from './saveMeal';
import { KitchenSheet } from './SavedMealSheet';
import { failureKind, online, type SavedMealWrites } from './useSavedMealWrites';

/** KM-16: the overline "Name" and the serif field on its rule; at most 80 characters; Return puts the keyboard down. */
export function MealNameField({ value, onChange, testID, editable = true }: {
  value: string; onChange: (text: string) => void; testID: string; editable?: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  return (
    <View>
      <Text style={s.label} testID={`${testID}-label`} importantForAccessibility="no" accessibilityElementsHidden>{SAVE_WORDS.name}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} maxLength={NAME_MAX} editable={editable}
        accessibilityLabel={SAVE_WORDS.nameSpoken} returnKeyType="done" blurOnSubmit onSubmitEditing={() => Keyboard.dismiss()}
        autoCapitalize="sentences" style={s.field} selectionColor={sc.accent} />
    </View>
  );
}

export default function SaveMealSheet({ meals, writes, onClose }: {
  meals: SavedMeal[]; writes: SavedMealWrites; onClose: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const [limitHit, setLimitHit] = useState(false);
  const limited = limitHit || atLimit(meals);
  // R3: today's foods as the server holds them, read only while the sheet is open (it is mounted only then), and read
  // again on every open: a fresh cache is fetched anyway and a read already running is joined, not doubled.
  const day = useTodayLog(limited ? '' : getTodayString());
  const refetchDay = useRef(day.refetch);
  refetchDay.current = day.refetch;
  useEffect(() => { if (!atLimit(meals)) void refetchDay.current({ cancelRefetch: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = todayEntries(day.data);
  const groups = useMemo(() => (entries ? dayGroups(entries) : []), [day.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const picks = picked ?? new Set(firstPicks(groups));
  const chosen = pickedFoods(groups, picks);
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? defaultName(chosen.map((f) => f.name));
  const over = chosen.length - SAVED_MEAL_ITEMS_MAX;

  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const sending = useRef(false);
  const kept = useRef<Set<string> | null>(null);
  const lost = useRef<SaveMealBody[]>([]);
  // KITCHEN-M's C2 class: an answer closes only the sheet that sent it. Closed mid-send (R7) and opened again, the open
  // sheet is a new one, so a late answer leaves it as she left it; the list still gets the meal (the mutation's onSuccess).
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const done = () => { if (live.current) onClose(); };
  // SS7: each line read once; iOS hears it, Android reads the notice's live region.
  useEffect(() => { if (Platform.OS === 'ios' && line) AccessibilityInfo.announceForAccessibility(line); }, [line]);

  const canSave = chosen.length > 0 && over <= 0 && nameOk(name);
  const toggle = (f: DayFood) => {
    if (!f.savable || busy) return;
    const next = new Set(picks);
    if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
    setPicked(next);
  };

  const save = async () => {
    if (sending.current || !canSave) return;
    sending.current = true;
    setBusy(true);
    setLine(null);
    const body = saveBody(name, chosen);
    try {
      if (!(await online())) { setRetry(false); setLine(SAVE_WORDS.offline); return; }
      if (!kept.current) kept.current = new Set(meals.map((m) => m.id));
      if (lost.current.length > 0) {
        // R6: a lost send may have landed. Read the list first; a meal this sheet did not see before that matches a
        // lost send is that save, and nothing is sent. A failed read sends nothing.
        const list = savedMealsOf(await writes.readList().catch(() => null));
        if (!list) { setRetry(true); setLine(SAVE_WORDS.notSaved); return; }
        const landed = lostSaveIn(list, kept.current, lost.current);
        if (landed) { writes.saved(landed); done(); return; }
      }
      await writes.create.mutateAsync(body);
      done();
    } catch (err) {
      onClose(); // MUTATION M5
      const kind = failureKind(err);
      if (kind === 'lost') {
        lost.current = [...lost.current, body];
        setRetry(true);
        setLine(SAVE_WORDS.notSaved);
      } else if (kind === 'limit') {
        setLimitHit(true);
      } else {
        setRetry(false);
        setLine(kind === 'refused' ? SAVE_WORDS.refused : SAVE_WORDS.foodGone);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  let foot: React.ReactNode = null;
  if (limited) {
    body = (
      <View style={s.state} testID="save-limit">
        <StyleCNotice>{SAVE_WORDS.limit}</StyleCNotice>
        <PrimaryButton wrap label={WORDS.close} onPress={onClose} haptic={false} testID="save-limit-close" />
      </View>
    );
  } else if (!entries) {
    body = day.isFetching ? (
      <View style={s.state} testID="save-loading"><StyleCLoadingLines rows={4} label={SAVE_WORDS.loading} lead="ring" /></View>
    ) : (
      <View style={s.state} testID="save-failed">
        <StyleCNotice title={SAVE_WORDS.failed}>{WORDS.failedLine}</StyleCNotice>
        <PrimaryButton wrap label={WORDS.tryAgain} onPress={() => void day.refetch()} haptic={false} testID="save-retry" />
      </View>
    );
  } else if (entries.length === 0) {
    body = <Text style={[s.muted, s.state]} testID="save-nothing">{SAVE_WORDS.nothing}</Text>;
  } else {
    body = (
      <>
        <Text style={s.muted}>{SAVE_WORDS.tick}</Text>
        {groups.map((g) => (
          <View key={g.meal}>
            <Text style={s.overline} accessibilityRole="header" testID={`save-group-${g.meal}`}>{groupTitle(g)}</Text>
            {g.foods.map((f) => {
              const on = f.savable && picks.has(f.id);
              return (
                <Pressable key={f.id} testID={`save-food-${f.id}`} onPress={() => toggle(f)} disabled={!f.savable || busy}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !f.savable || busy }}
                  accessibilityLabel={[f.name, f.amount, kcalWords(f.kcal), f.savable ? null : SAVE_WORDS.cannot].filter(Boolean).join(', ')}
                  style={({ pressed }) => [s.food, pressed && s.pressed]}>
                  <StyleCCheck checked={on} />
                  <View style={s.grow}>
                    <Text style={s.foodName}>{f.name}</Text>
                    {f.savable ? null : <Text style={s.small}>{SAVE_WORDS.cannot}</Text>}
                  </View>
                  <Text style={s.amount}>{f.amount}</Text>
                  <Text style={s.kcal}>{n(f.kcal)}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </>
    );
    foot = (
      <>
        {over > 0 ? <Text style={s.note} testID="save-too-many">{untickWords(over)}</Text> : null}
        <MealNameField value={name} onChange={setTyped} testID="save-name" editable={!busy} />
        {line ? <View style={s.line} testID="save-line"><StyleCNotice key={line}>{line}</StyleCNotice></View> : null}
        <View style={s.submit} testID="save-submit-wrap">
          <PrimaryButton wrap label={retry ? WORDS.tryAgain : saveFoodsWords(chosen.length)} onPress={() => void save()}
            disabled={!busy && !canSave} loading={busy} haptic={false} testID="save-submit" />
        </View>
      </>
    );
  }

  return (
    <KitchenSheet visible title={SAVE_WORDS.way} onClose={onClose} footer={foot} testID="kitchen-save-sheet">{body}</KitchenSheet>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  grow: { flex: 1 },
  state: { marginTop: 12, gap: 14 },
  // S2_save (2 px = 1 pt): the muted line under the title, 15 pt.
  muted: { ...typography.body, fontSize: 15, lineHeight: 22, letterSpacing: 0, color: sc.textMuted, marginTop: 2 },
  overline: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5, lineHeight: 14,
    letterSpacing: 2, textTransform: 'uppercase', color: sc.textMuted, marginTop: 22, marginBottom: 4 },
  // A food row: about 57 pt, the round check, the name, the amount muted and the kcal at the gutter, a hairline under.
  food: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 57, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  pressed: { opacity: 0.6 },
  foodName: { ...typography.body, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textPrimary },
  small: { ...typography.bodySmall, fontSize: 13, lineHeight: 19, color: sc.textMuted },
  amount: { ...typography.body, fontSize: 15, lineHeight: 22, letterSpacing: 0, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  kcal: { ...typography.body, fontSize: 17, lineHeight: 24, letterSpacing: 0, color: sc.textPrimary, fontVariant: ['tabular-nums'],
    minWidth: 40, textAlign: 'right' },
  note: { ...typography.bodySmall, lineHeight: 21, color: sc.textPrimary, marginBottom: 8 },
  // KM-16: the overline, then the 21 pt serif field on a 1 pt ink rule.
  label: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5, lineHeight: 14,
    letterSpacing: 2, textTransform: 'uppercase', color: sc.textMuted, marginTop: 0, marginBottom: 2 },
  field: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', fontSize: 21, lineHeight: 28,
    letterSpacing: 0, color: sc.textPrimary, minHeight: 44, paddingVertical: 6, paddingHorizontal: 0, borderBottomWidth: 1,
    borderColor: sc.textPrimary },
  line: { marginTop: 12 },
  submit: { marginTop: 12 },
});
