/**
 * WORKOUT-REFUSAL-M (203-P1, owner #203-E89 "a workout the server refused - style 2"): Style 2 "Tells you why",
 * GOAL ctx#579 planning/WORKOUT-OFFLINE-MOCK frames s2_R1 to s2_R5b. A saved workout the server refused with a
 * reason code (backend b#1256) shows as a warm card at the top of the Train tab: the server's own words, its plain
 * next step, Send again and Tell <coach> (See workout for a coachless client). The card opens a sheet with the
 * sets, Send again, Tell <coach> and Remove from this phone. Several read as one count card; See both shows each
 * card. A refusal with no code is not kept (sync-engine keepRefusal), so nothing shows: today's behaviour.
 * WORKOUT_NOT_FOUND (the workout is gone from the server) offers no Send again: its next step is Remove.
 * FIX-WRM-1 (OPERATOR RULING 7208809287): WORKOUT_INVALID reads a plain line, never the validation line; the sheet's
 * head and actions never scroll (s2_R4a, s2_R4b); Tell <coach> opens the chat on the Home stack; a timed exercise reads
 * "3 × 60 sec" (its plan row's unit, from the Train tab's assignments).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationProp, ParamListBase, useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowInsets } from '../../ui/layout/ScreenArea';
import { Colors } from '../../constants/colors';
import { useMyCoaches } from '../../hooks/useCalendar';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  deadLetterEvents,
  listRefusedWorkouts,
  removeRefusedWorkout,
  sendRefusedWorkoutAgain,
  workoutSyncEvents,
  type RefusedWorkout,
} from '../../offline/sync/sync-engine';
import { canSendAgain, refusalLines } from '../../offline/sync/refusal';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, layout, radius, typography } from '../../theme/tokens';
import { PrimaryButton, TextLink } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { assignmentPrescription } from '../../utils/workout/assignmentPrescription';
import { isTimedRow } from '../../utils/workout/exerciseUnit';
import SheetGrip from '../log/SheetGrip';

/** WORKOUT-OFFLINE-W ids (ctx#579 index.md "Wording needed"), approved (operator, #203-E15). */
export const REFUSAL_COPY = {
  title: 'Workout not saved', // W1
  count: (n: number) => `${n} workouts not saved`, // W14
  said: 'The server said:', // W15
  hint: 'Opens the workout', // W3
  label: (name: string, longDate: string) => `Workout not saved: ${name}, ${longDate}.`, // W31
  overline: 'Not saved', // W4
  why: (coach: string | null) => (coach
    ? `The server did not accept this workout, so it is not in your history and ${coach} has not seen it.` // W5
    : 'The server did not accept this workout, so it is not in your history.'), // W6
  sendAgain: 'Send again', // W7
  remove: 'Remove from this phone', // W8
  stays: 'It stays on this phone until you send it again or remove it. Signing out removes it.', // W9
  again: 'Not accepted again.', // W10
  confirmTitle: 'Remove this workout?', // W11
  confirmBody: (name: string, date: string) =>
    `${name} from ${date} leaves this phone. It is not in your history, so it cannot be brought back.`, // W12
  confirmRemove: 'Remove', // W13
  cancel: 'Cancel', // today's
  tell: (coach: string) => `Tell ${coach}`, // W17
  see: 'See workout', // W18
  seeBoth: 'See both', // W19
  seeAll: 'See all', // WORKOUT-REFUSAL-W4 (three or more; main's word, MoneyScreen)
  yourCoach: 'your coach', // C1-C-44
  invalid: "Part of this workout couldn't be saved.", // WORKOUT-REFUSAL-W5: WORKOUT_INVALID, in place of the validation line
  close: 'Close', // WORKOUT-REFUSAL-W6: the sheet's scrim, main's word (CheckInDraftSheet, ClientPeekSheet)
  leave: 'Leave', // WORKOUT-REFUSAL-W7: the logger's leave question after a coded refusal (ALM-D8, ruling 7209272454)
};
const c = REFUSAL_COPY;
const CAP = 1.3;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
type Exercise = {
  exercise_name?: unknown; sets_completed?: unknown; reps_per_set?: unknown; weight_per_set?: unknown;
  plan_assignment_id?: unknown; plan_order?: unknown;
};
/** The client's assignments as the Train tab reads them (GET /assignments/me), in assignmentPrescription's shape. */
type Assignment = Parameters<typeof assignmentPrescription>[0];
export type RefusedPlans = ReadonlyArray<Partial<Assignment>>;

/**
 * C3 (TIMED-SETS-M): the stored body counts seconds in reps_per_set with no unit; an exercise logged from an assignment
 * names its plan row (plan_assignment_id, plan_order), and that row's unit says whether it is timed. Not loaded: reps.
 */
function timed(plans: RefusedPlans | undefined, e: Exercise): boolean {
  const a = typeof e.plan_assignment_id === 'string' ? plans?.find((p) => p.id === e.plan_assignment_id) : undefined;
  return !!a && typeof e.plan_order === 'number'
    && isTimedRow(assignmentPrescription(a as Assignment).exercises.find((r) => r.order === e.plan_order));
}

/** Name, "Sat 10 Oct", "Saturday 10 October", minutes and set rows from the stored POST /workouts body. */
export function refusedView(body: Record<string, unknown>, plans?: RefusedPlans) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(body.date ?? ''));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  const exercises = (Array.isArray(body.exercises) ? body.exercises : []) as Exercise[];
  const rows = exercises.map((e) => {
    const reps = Array.isArray(e.reps_per_set) ? (e.reps_per_set as number[]) : [];
    const weights = Array.isArray(e.weight_per_set) ? (e.weight_per_set as number[]) : [];
    const n = typeof e.sets_completed === 'number' ? e.sets_completed : reps.length;
    const same = reps.length > 0 && reps.every((r) => r === reps[0]) && weights.every((w) => w === weights[0]);
    const unit = timed(plans, e) ? ' sec' : ''; // "3 × 60 sec", as the Train tab writes a timed row (TrainToday blockLine)
    const line = same ? `${n} × ${reps[0]}${unit}${weights[0] > 0 ? ` · ${weights[0]} lb` : ''}` : `${n} ${n === 1 ? 'set' : 'sets'}`;
    return { name: String(e.exercise_name ?? ''), line, sets: n };
  });
  const sets = rows.reduce((sum, r) => sum + r.sets, 0);
  const minutes = typeof body.duration_minutes === 'number' && body.duration_minutes > 0 ? body.duration_minutes : 0;
  const date = d ? `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` : '';
  return {
    name: String(body.workout_name || 'Workout'),
    date,
    longDate: d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : '',
    meta: [date, minutes ? `${minutes} min` : '', `${sets} ${sets === 1 ? 'set' : 'sets'}`].filter(Boolean).join(' · '),
    rows,
  };
}

/** The signed-in client's coded refusals; reloads on focus, after a background refusal and after a send. */
export function useRefusedWorkouts(userId: string | undefined) {
  const [items, setItems] = useState<RefusedWorkout[]>([]);
  const count = useRef(0);
  const reload = useCallback(async (felt = false) => {
    const next = userId ? await listRefusedWorkouts(userId).catch(() => [] as RefusedWorkout[]) : [];
    // A refusal that arrives while the tab is open is felt once (docs/HAPTICS.md: error on a failed action).
    if (felt && next.length > count.current) void HapticService.error();
    count.current = next.length;
    setItems(next);
  }, [userId]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const parked = () => void reload(true);
    const sent = () => void reload();
    deadLetterEvents.on('dead_letter', parked);
    workoutSyncEvents.on('synced', sent);
    return () => {
      deadLetterEvents.off('dead_letter', parked);
      workoutSyncEvents.off('synced', sent);
    };
  }, [reload]);
  return { items, reload };
}

function Outline({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const sc = useTheme().semanticColors;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }} testID={testID}
      style={({ pressed }) => [s.outline, { borderColor: sc.accent }, (pressed || disabled) && s.dim]}>
      <Text maxFontSizeMultiplier={CAP} style={[s.outlineText, { color: sc.accentText }]}>{label}</Text>
    </Pressable>
  );
}

/** The card on the Train tab (on the masthead with Train v2 on, under the header with it off); nothing when none. */
export default function RefusedWorkoutCard({ assignments }: { assignments?: RefusedPlans }) {
  const user = useCurrentUser();
  const { items, reload } = useRefusedWorkouts(user?.id);
  return user?.id && items.length ? (
    <RefusedCards userId={user.id} coachId={user.coach_id} items={items} reload={reload} assignments={assignments} />
  ) : null;
}

function RefusedCards({ userId, coachId, items, reload, assignments }: {
  userId: string; coachId?: string | null; items: RefusedWorkout[]; reload: () => Promise<void>; assignments?: RefusedPlans;
}) {
  const coachless = useCoachlessClient();
  const coaches = useMyCoaches(!coachless).data;
  const coachName = (coaches?.find((x) => x.coach_id === coachId) ?? coaches?.[0])?.name?.trim().split(/\s+/)[0];
  const coach = coachless ? null : coachName || c.yourCoach;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [openId, setOpenId] = useState<string | null>(null);
  const [again, setAgain] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // The card fades in over 150 ms, at once with Reduce Motion (ctx#579 index.md, the styles' shared rules).
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [reduced, fade]);

  // N2: one send at a time. The ref holds at once, so a second tap in the same frame (before `busy` renders) is ignored
  // and cannot answer 'kept' and close the card while the first send is still waiting for "Not accepted again.".
  const sending = useRef(false);
  const send = async (id: string) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(id);
    try {
      const outcome = await sendRefusedWorkoutAgain(id, userId);
      if (outcome === 'dead_letter') {
        void HapticService.error();
        setAgain((prev) => new Set(prev).add(id));
        setOpenId(id); // R4b: the sheet says "Not accepted again."
      } else {
        if (outcome === 'sent') void HapticService.success();
        setOpenId(null);
      }
    } catch {
      // N2: a database error leaves the row as it was; it is felt, and the reload below shows the card as it is.
      void HapticService.error();
    } finally {
      sending.current = false;
      setBusy(null);
      await reload();
    }
  };
  const remove = (item: RefusedWorkout) => {
    const v = refusedView(item.body);
    Alert.alert(c.confirmTitle, c.confirmBody(v.name, v.date), [
      { text: c.cancel, style: 'cancel' },
      { text: c.confirmRemove, style: 'destructive', onPress: () => {
        setOpenId(null);
        void removeRefusedWorkout(item.id, userId).then(() => reload(), () => reload());
      } },
    ]);
  };
  // B1: the coach chat is registered on the Home stack only (ClientNavigator) and the card is on the Train stack, so it
  // opens through the tabs with Home's first screen under it, so Back works (as YouScreen, LearnScreen, CourseMomentSheet).
  const tell = () => {
    setOpenId(null);
    (navigation.getParent() ?? navigation).navigate('Home', { screen: 'Messages', initial: false });
  };

  const open = items.find((x) => x.id === openId) ?? null;

  const one = (item: RefusedWorkout) => {
    const v = refusedView(item.body);
    const resend = canSendAgain(item.refusal);
    const first = resend ? { label: c.sendAgain, run: () => void send(item.id), id: 'send' }
      : { label: c.see, run: () => setOpenId(item.id), id: 'see' };
    const second = coach ? { label: c.tell(coach), run: tell, id: 'tell' }
      : resend ? { label: c.see, run: () => setOpenId(item.id), id: 'see' } : null;
    return (
      <View key={item.id} style={[s.card, { borderColor: Colors.offlineBanner }]} accessibilityLiveRegion="polite"
        testID={`refused-card-${item.id}`}>
        <Pressable onPress={() => setOpenId(item.id)} accessibilityRole="button" accessibilityLabel={c.label(v.name, v.longDate)}
          accessibilityHint={c.hint} testID="refused-card-open">
          <Text maxFontSizeMultiplier={CAP} style={s.title}>{c.title}</Text>
          <Text maxFontSizeMultiplier={CAP} style={s.sub}>{[v.name, v.date].filter(Boolean).join(' · ')}</Text>
          {refusalLines(item.refusal, c).map((line) => (
            <Text key={line} maxFontSizeMultiplier={CAP} style={s.said}>{line}</Text>
          ))}
        </Pressable>
        <View style={s.actions}>
          {[first, second].map((b) => (b ? (
            <Outline key={b.id} label={b.label} onPress={b.run} disabled={busy === item.id} testID={`refused-card-${b.id}`} />
          ) : null))}
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={{ opacity: reduced ? 1 : fade }} testID="refused-workouts">
      {items.length > 1 && !all ? (
        <View style={[s.card, { borderColor: Colors.offlineBanner }]} accessibilityLiveRegion="polite" testID="refused-count-card">
          <Text maxFontSizeMultiplier={CAP} style={s.title}>{c.count(items.length)}</Text>
          {items.map((item) => {
            const v = refusedView(item.body);
            return <Text key={item.id} maxFontSizeMultiplier={CAP} style={s.list}>{[v.name, v.date].filter(Boolean).join(', ')}</Text>;
          })}
          <View style={s.actions}>
            <Outline label={items.length === 2 ? c.seeBoth : c.seeAll} onPress={() => setAll(true)} testID="refused-see-all" />
          </View>
        </View>
      ) : items.map(one)}
      {open ? (
        <RefusedWorkoutSheet item={open} coach={coach} again={again.has(open.id)} busy={busy === open.id} assignments={assignments}
          onClose={() => setOpenId(null)} onSend={() => void send(open.id)} onTell={tell} onRemove={() => remove(open)} />
      ) : null}
    </Animated.View>
  );
}

/**
 * s2_R4a / s2_R4b: the workout's sets, the server's words, Send again, Tell <coach>, Remove from this phone. B2: a column
 * as the drawing is: the head (overline, name, meta) and the actions ("Not accepted again.", the buttons, the footnote)
 * never scroll; only the body between them (the lede, the server's words, the sets) scrolls and shrinks to fit.
 */
export function RefusedWorkoutSheet({ item, coach, again, busy, assignments, onClose, onSend, onTell, onRemove }: {
  item: RefusedWorkout; coach: string | null; again: boolean; busy: boolean; assignments?: RefusedPlans;
  onClose: () => void; onSend: () => void; onTell: () => void; onRemove: () => void;
}) {
  const sc = useTheme().semanticColors;
  const insets = useSafeAreaInsets();
  // OFFLINE-BAND-ROOT-M: a Modal draws from the window's top, over the band: the scrim takes the window's top inset.
  const windowTop = useWindowInsets().top;
  const v = useMemo(() => refusedView(item.body, assignments), [item.body, assignments]);
  const ink = { color: sc.textPrimary };
  const muted = { color: sc.textMuted };
  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[s.scrim, { backgroundColor: sc.overlay, paddingTop: windowTop + 8 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={c.close}
          testID="refused-sheet-scrim" />
        <View style={[s.sheet, { backgroundColor: sc.bgSurface, paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal
          onAccessibilityEscape={onClose} testID="refused-sheet">
          <SheetGrip />
          <View style={s.pad} testID="refused-sheet-head">
            <Text maxFontSizeMultiplier={CAP} style={[typography.eyebrow, { color: Colors.offlineBanner }]}>{c.overline}</Text>
            <Text accessibilityRole="header" style={[typography.h1, ink]}>{v.name}</Text>
            <Text maxFontSizeMultiplier={CAP} style={[typography.bodySmall, muted, s.tabular, s.meta]}>{v.meta}</Text>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.pad} testID="refused-sheet-body">
            <Text style={[s.why, ink]}>{c.why(coach)}</Text>
            <View style={[s.box, { borderLeftColor: Colors.offlineBanner }]} testID="refused-sheet-said">
              {refusalLines(item.refusal, c).map((line) => <Text key={line} style={s.said}>{line}</Text>)}
            </View>
            {v.rows.map((r, i) => (
              <View key={`${r.name}-${i}`} style={[s.setRow, { borderTopColor: sc.border }]}>
                <Text style={[s.setText, ink, s.flex]}>{r.name}</Text>
                <Text style={[s.setText, muted, s.tabular]}>{r.line}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[s.rule, { backgroundColor: sc.border }]} />
          <View style={[s.pad, s.buttons]} testID="refused-sheet-actions">
            {again ? (
              <View style={s.again} accessibilityRole="alert" testID="refused-sheet-again">
                <Ionicons name="alert-circle-outline" size={20} color={Colors.offlineBanner} />
                <Text maxFontSizeMultiplier={CAP} style={[s.againText, { color: Colors.offlineBanner }]}>{c.again}</Text>
              </View>
            ) : null}
            {canSendAgain(item.refusal) ? (
              <PrimaryButton label={c.sendAgain} onPress={onSend} loading={busy} testID="refused-sheet-send" />
            ) : null}
            {coach ? <Outline label={c.tell(coach)} onPress={onTell} testID="refused-sheet-tell" /> : null}
            <TextLink label={c.remove} tone="accent" onPress={onRemove} disabled={busy} testID="refused-sheet-remove" />
            <Text maxFontSizeMultiplier={CAP} style={[typography.bodySmall, muted, s.center]}>{c.stays}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.noticeWarningBg, borderWidth: 1, borderRadius: radius.card, padding: 16,
    marginHorizontal: layout.gutter, marginBottom: 20,
  },
  title: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 24, color: colors.ink },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: colors.charcoal, marginTop: 2 },
  list: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: colors.charcoal, marginTop: 2 },
  said: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: colors.charcoal, marginTop: 8 },
  // Side by side while both labels fit on one line; else each takes the full width (s2_R1 at 320 pt 130%).
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  outline: {
    flexGrow: 1, flexBasis: 'auto', minHeight: layout.touchMin, borderWidth: 1.5, borderRadius: radius.button, paddingHorizontal: 16,
    paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
  },
  outlineText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20, textAlign: 'center' },
  dim: { opacity: 0.6 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  // s2_R4a: at its tallest the sheet reaches 8 pt under the status bar (540 pt of 568 at 320, 789 of 844 at 390).
  sheet: { maxHeight: '100%', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  // Spacing measured from s2_R4a at 390 pt: rows 37 pt, the reason box 22 pt under the lede, buttons 8 pt apart.
  pad: { paddingHorizontal: layout.gutter },
  // B2: the body takes only the height it needs and shrinks (scrolling) when the sheet reaches its full height.
  body: { flexGrow: 0, flexShrink: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: layout.gutter }, // s2_R4a: the line under the part that scrolls
  meta: { marginTop: 2 },
  why: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, marginTop: 12 },
  box: {
    backgroundColor: Colors.noticeWarningBg, borderLeftWidth: 4, borderRadius: radius.card, padding: 16, paddingTop: 8,
    marginTop: 20, marginBottom: 12,
  },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 37, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  setText: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22 },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  // s2_R4b: "Not accepted again." 10 pt under the line and 12 pt over Send again (the actions' own 13 and 8, adjusted).
  again: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -3, marginBottom: 4 },
  againText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22, flexShrink: 1 },
  buttons: { gap: 8, marginTop: 13 },
  center: { textAlign: 'center' },
});
