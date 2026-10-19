/**
 * HB-B1: Habits as concept B, the ring (planning/MOCKUP3/HABITS sections 7 to 11), behind habitsRing.
 * Masthead ring, week strip of small rings, tiles; runs and counts from GET /habits and /habits/summary (HB3).
 * HB-B1b (#WORDING-HB3): a strip day up to today opens in the ring and ticks; a future day only says it cannot be logged.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { habitsApi } from '../../../../services/api';
import { useLogHabit } from '../../../../hooks/useApi';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../../../hooks/useCoachlessClient';
import { useReducedMotion } from '../../../../hooks/useReducedMotion';
import { useMyCoaches } from '../../../../hooks/useCalendar';
import { ForestStatusBar } from '../../../../components/StatusBarBand';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { SegmentedRing, type SegmentState } from '../../../../ui/charts/StyleCMarks';
import { PrimaryButton, Screen, TextLink } from '../../../../ui';
import { QuietLoading } from '../../../../ui/states/QuietStates';
import { useTheme } from '../../../../theme/ThemeProvider';
import { colors, layout, radius, typography, type SemanticTokens } from '../../../../theme/tokens';
import { getTodayString } from '../../../../utils/date';
import { plannedToday } from '../../../../components/home/rings/homeTiles';
import {
  IDEAS, RING_COPY as C, dayName, dayOfMonth, doneOn, longDate, mondayOf, plusDays, runLine,
  weekCount, weekStrip, weekdayLetter, weekdayName, type HabitSummary, type RingHabit,
} from './ringModel';

export interface HabitsRingProps {
  habits: RingHabit[] | undefined;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onAdd: () => void; // today's Add habit sheet
  onCheckIn: () => void; // today's check-in tab
  onSaved?: () => void;
}

const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || undefined;

export default function HabitsRing({ habits, loading, failed, refreshing, onRefresh, onAdd, onCheckIn, onSaved }: HabitsRingProps) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const { width, fontScale } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const coachless = useCoachlessClient();
  const coaches = useMyCoaches(!coachless).data;
  const coachName = coachless ? undefined : firstName(coaches?.find((c) => c.coach_id === user?.coach_id)?.name);

  const from = mondayOf(getTodayString());
  const summary = useQuery<HabitSummary>({
    queryKey: ['habits', 'summary', from],
    queryFn: async () => (await api.get('/habits/summary', { params: { from, to: plusDays(from, 6) } })).data,
  });
  const today = summary.data?.today ?? getTodayString();
  // The day the ring shows: today, or a day of this week picked in the strip.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && picked >= mondayOf(today) && picked <= today ? picked : today;

  // The masthead's forest runs under the native back header, with today's two tabs on its right.
  const checkIn = useRef(onCheckIn);
  checkIn.current = onCheckIn;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: sc.surface.masthead },
      headerTintColor: sc.textOnAccent,
      headerRight: () => (
        <View style={s.tabs} accessibilityRole="tablist">
          <View style={s.tab} accessibilityRole="tab" accessibilityState={{ selected: true }} testID="habits-ring-tab-habits">
            <Text style={[s.tabText, s.light]}>{C.habits}</Text>
            <View style={s.underline} />
          </View>
          <Pressable
            onPress={() => { void HapticService.selection(); checkIn.current(); }}
            accessibilityRole="tab" accessibilityState={{ selected: false }} testID="habits-ring-tab-checkin"
            style={({ pressed }) => [s.tab, pressed && s.pressed]}
          >
            <Text style={[s.tabText, s.muted]}>{C.checkIn}</Text>
          </Pressable>
        </View>
      ),
    });
    return () => navigation.setOptions({ headerStyle: { backgroundColor: colors.bone }, headerTintColor: colors.ink, headerRight: undefined });
  }, [navigation, sc, s]);

  // A tick shows at once; the server's answer settles it (a failure puts it back).
  const logHabit = useLogHabit();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [draw, setDraw] = useState<{ index: number; key: string } | null>(null);
  const busy = useRef(new Set<string>());
  const taps = useRef(0);
  const list = habits ?? [];
  // Ticks on their way, by day and habit ("2026-10-13|h1").
  const isDoneOn = (h: RingHabit, on: string) => shown[`${on}|${h.id}`] ?? doneOn(h, on);
  const isDone = (h: RingHabit) => isDoneOn(h, day);
  useEffect(() => {
    setShown((m) => {
      const keep = Object.entries(m).filter(([k, v]) => { const [on, id] = k.split('|'); return busy.current.has(k) || list.some((h) => h.id === id && doneOn(h, on) !== v); });
      return keep.length === Object.keys(m).length ? m : Object.fromEntries(keep);
    });
  }, [habits]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same parts as Home's habits tile, for the day shown: planned that day, or ticked that day on the server.
  const partsOn = (on: string) => list.filter((h) => doneOn(h, on) || plannedToday(h, on));
  const countOn = (on: string) => { const p = partsOn(on); return { planned: p.length, done: p.filter((h) => isDoneOn(h, on)).length }; };
  const parts = partsOn(day);
  const done = parts.filter(isDone).length;
  const toggle = (h: RingHabit) => {
    const key = `${day}|${h.id}`;
    if (busy.current.has(key)) return;
    const next = !isDone(h);
    const index = parts.findIndex((p) => p.id === h.id);
    setUnsaved(null);
    setShown((m) => ({ ...m, [key]: next }));
    if (next) {
      taps.current += 1;
      setDraw({ index, key: `${h.id}:${day}:${taps.current}` });
      void (done + 1 === parts.length ? HapticService.success() : HapticService.softImpact());
    } else void HapticService.selection();
    busy.current.add(key);
    logHabit.mutateAsync({ id: h.id, date: day, completed: next, value: next ? h.target_value || 1 : 0 }).then(
      () => { if (next) onSaved?.(); },
      () => {
        setShown((m) => { const rest = { ...m }; delete rest[key]; return rest; });
        setUnsaved(key);
        void HapticService.error();
        AccessibilityInfo.announceForAccessibility(C.notSaved);
      },
    ).finally(() => busy.current.delete(key));
  };

  // #WORDING-HB3: a future day is never logged. Its quiet line fades in, holds, fades out by itself and is spoken;
  // with Reduce Motion it shows and goes without the fade.
  const reduceMotion = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  const [future, setFuture] = useState(0);
  useEffect(() => {
    if (!future) return undefined;
    AccessibilityInfo.announceForAccessibility(C.future);
    const to = (toValue: number) => { if (!reduceMotion) Animated.timing(fade, { toValue, duration: FADE_MS, useNativeDriver: true }).start(); };
    to(1);
    const out = setTimeout(() => to(0), HOLD_MS);
    const gone = setTimeout(() => setFuture(0), HOLD_MS + FADE_MS);
    return () => { clearTimeout(out); clearTimeout(gone); };
  }, [future]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (on: string) => {
    if (on > today) { fade.setValue(reduceMotion ? 1 : 0); setFuture((n) => n + 1); return; }
    void HapticService.selection();
    setDraw(null);
    setPicked(on);
  };

  // First run (coachless): an idea becomes the client's habit in one tap.
  const createIdea = useMutation({
    mutationFn: (idea: (typeof IDEAS)[number]) => habitsApi.create({ name: idea.name, category: 'custom', ...idea.plan }),
    onSuccess: () => { void HapticService.success(); return qc.invalidateQueries({ queryKey: ['habits'] }); },
    onError: () => { void HapticService.error(); },
  });

  const refresh = () => { onRefresh(); void summary.refetch(); };
  const ring = Math.min(148, Math.round((width - layout.gutter * 2) * 0.46));
  const tileWidth = fontScale > 1.15 ? width - layout.gutter * 2 : (width - layout.gutter * 2 - GAP) / 2;
  const week = weekCount(list, day, isDone);
  const unplanned = parts.length === 0 && day === today; // #HABITS-EMPTY-DAY op 1
  const empty = !loading && !(failed && !habits) && list.length === 0;
  const first = empty && coachless;

  const left = (content: React.ReactNode) => <View style={[s.center, { width: ring, minHeight: ring }]}>{content}</View>;
  let mast: React.ReactNode;
  if (loading) {
    mast = (
      <View style={s.row} accessible accessibilityLabel={C.loading} testID="habits-ring-loading">
        {left(<View style={[s.placeholder, { width: ring, height: ring, borderRadius: ring / 2 }]} />)}
        <View style={s.flex}><View style={[s.placeholder, s.bar]} /><View style={[s.placeholder, s.bar, s.barShort]} /></View>
      </View>
    );
  } else if (failed && !habits) {
    mast = (
      <View style={s.row} testID="habits-ring-error">
        {left(<Text style={[typography.eyebrow, s.muted]}>{C.today}</Text>)}
        <Text style={[typography.body, s.light, s.flex]} accessibilityLiveRegion="polite">{C.failed}</Text>
      </View>
    );
  } else if (empty) {
    mast = (
      <View style={s.row} testID={first ? 'habits-ring-first' : 'habits-ring-empty'}>
        {left(<Text style={[s.serif, s.light, s.centerText]} accessibilityRole="header">{first ? C.yourRing : C.noHabitsYet}</Text>)}
        <View style={s.flex}>
          {first || coachName ? <Text style={[typography.eyebrow, s.muted]}>{first ? C.startHere : C.fromCoach(coachName as string)}</Text> : null}
          {first || coachName ? <Text style={[typography.body, s.light]}>{first ? C.onePart : C.coachCanAdd(coachName as string)}</Text> : null}
        </View>
      </View>
    );
  } else {
    mast = (
      <>
        <View style={s.row}>
          {unplanned ? left(<Text style={[s.serif, s.light, s.centerText]} accessibilityRole="header" testID="habits-ring-unplanned">{C.nothingToday}</Text>) : (
            <SegmentedRing
              segments={parts.map((h): SegmentState => (isDone(h) ? 'done' : day < today ? 'missed' : 'planned'))} size={ring} onDark
              label={day === today ? C.ring(done, parts.length) : C.day(dayName(day), { planned: parts.length, done })}
              drawIndex={draw?.index} event={draw?.key} testID="habits-ring"
            >
              <Text style={[s.count, s.light, { maxWidth: ring * 0.72 }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1} testID="habits-ring-count">{C.of(done, parts.length)}</Text>
              <Text style={[typography.eyebrow, s.muted]}>{day === today ? C.today : weekdayName(day)}</Text>
            </SegmentedRing>
          )}
          <View style={s.flex}>
            <Text style={[typography.eyebrow, s.muted]}>{weekdayName(today)}</Text>
            {day !== today ? <Text style={[typography.body, s.light]}>{longDate(day)}</Text>
              : week?.planned ? <Text style={[typography.body, s.light]} testID="habits-ring-week">{C.thisWeek(week.done, week.planned)}</Text> : null}
          </View>
        </View>
        {summary.data ? (
          <View style={s.strip} testID="habits-ring-strip">
            {weekStrip(summary.data, today, (on) => (on === today || on === day ? countOn(on) : null)).map((d) => {
              const on = d.date === day;
              return (
                <Pressable
                  key={d.date} onPress={() => pick(d.date)} testID={`habits-ring-pick-${d.date}`}
                  accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={C.day(dayName(d.date), d.count)}
                  style={({ pressed }) => [s.day, pressed && s.pressed]}
                >
                  <Text style={[s.letter, on ? s.light : s.muted]} importantForAccessibility="no" accessibilityElementsHidden>{weekdayLetter(d.date)}</Text>
                  <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                    <SegmentedRing segments={d.segments} size={MINI} onDark label={C.day(dayName(d.date), d.count)} testID={`habits-ring-day-${d.date}`}>
                      <Text style={[on ? typography.bodyMd : typography.bodySmall, s.light]} maxFontSizeMultiplier={1.3}>{dayOfMonth(d.date)}</Text>
                    </SegmentedRing>
                  </View>
                  <View style={[s.mark, on && s.underline]} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </>
    );
  }

  const tile = (h: RingHabit) => {
    const on = isDone(h);
    const run = runLine(h, isDoneOn(h, today));
    const by = coachless ? null : h.assigned_by_coach_id ? firstName(coaches?.find((c) => c.coach_id === h.assigned_by_coach_id)?.name) : null;
    const added = coachless ? null : h.assigned_by_coach_id ? (by ? C.coachAdded(by) : null) : C.youAdded;
    return (
      <Pressable
        key={h.id} onPress={() => toggle(h)} testID={`habits-ring-tile-${h.id}`}
        accessibilityRole="checkbox" accessibilityState={{ checked: on }}
        accessibilityLabel={[day === today ? C.tile(h.name, on) : C.tileOn(h.name, dayName(day), on), run, added].filter(Boolean).join(', ')}
        style={({ pressed }) => [s.tile, { width: tileWidth }, on ? s.tileDone : s.tileOpen, pressed && s.pressed]}
      >
        <View style={[s.check, on ? s.checkDone : s.checkOpen]}>{on ? <Ionicons name="checkmark" size={18} color={sc.textOnAccent} /> : null}</View>
        <Text style={[typography.h4, s.ink]}>{h.name}</Text>
        {run ? <Text style={[typography.bodySmall, s.soft]}>{run}</Text> : null}
        {added ? (
          <View style={s.added}>
            {by ? <View style={s.avatar}><Text style={s.initial}>{by.charAt(0).toUpperCase()}</Text></View> : null}
            <Text style={[typography.bodySmall, s.ink]}>{added}</Text>
          </View>
        ) : null}
        {unsaved === `${day}|${h.id}` ? <Text style={[typography.bodySmall, s.ink]} accessibilityLiveRegion="polite" testID="habits-ring-unsaved">{C.notSaved}</Text> : null}
      </Pressable>
    );
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode;
  if (loading) body = <QuietLoading label={C.loading} rows={3} />;
  else if (failed && !habits) footer = <PrimaryButton label={C.tryAgain} onPress={refresh} loading={refreshing} testID="habits-ring-retry" />;
  else if (first) {
    body = (
      <>
        <Text style={[typography.eyebrow, s.soft]} accessibilityRole="header">{C.ideas}</Text>
        <View style={s.grid}>
          {IDEAS.map((idea, i) => (
            <Pressable
              key={idea.name} disabled={createIdea.isPending} testID={`habits-ring-idea-${i}`}
              onPress={() => { void HapticService.mediumImpact(); createIdea.mutate(idea); }}
              accessibilityRole="button" accessibilityLabel={`${idea.name}, ${idea.when}`} accessibilityState={{ busy: createIdea.isPending }}
              style={({ pressed }) => [s.tile, s.tileOpen, { width: tileWidth }, pressed && s.pressed]}
            >
              <View style={[s.check, s.checkIdea]}><Ionicons name="add" size={18} color={sc.accentText} /></View>
              <Text style={[typography.h4, s.ink]}>{idea.name}</Text>
              <Text style={[typography.bodySmall, s.soft]}>{idea.when}</Text>
            </Pressable>
          ))}
        </View>
        {createIdea.isError ? <Text style={[typography.bodySmall, s.ink]} accessibilityLiveRegion="polite">{C.notCreated}</Text> : null}
      </>
    );
    footer = <PrimaryButton label={C.writeOwn} onPress={onAdd} testID="habits-ring-write" />;
  } else if (empty) {
    footer = (
      <>
        <PrimaryButton label={C.addHabit} onPress={onAdd} testID="habits-ring-add" />
        {coachName ? <TextLink label={C.askCoach(coachName)} tone="accent" onPress={() => navigation.navigate('Messages')} testID="habits-ring-ask" /> : null}
      </>
    );
  } else {
    body = (
      <>
        {unplanned ? (
          <View style={s.listed}>
            {list.map((h, i) => <View key={h.id} style={[s.listedRow, i > 0 && s.listedLine]}><Text style={[typography.bodyMd, s.ink]}>{h.name}</Text></View>)}
          </View>
        ) : (
          <>
            {done < parts.length ? <Text style={[typography.body, s.soft]}>{C.tap}</Text> : null}
            <View style={s.grid}>{parts.map(tile)}</View>
          </>
        )}
        <TextLink label={C.addHabit} tone="accent" underline={false} align="start" onPress={onAdd} testID="habits-ring-add" />
        {future ? (
          <Animated.View style={[s.notice, { opacity: fade }]} pointerEvents="none" testID="habits-ring-future">
            <Text style={s.noticeText}>{C.future}</Text>
          </Animated.View>
        ) : null}
      </>
    );
  }

  return (
    <>
      <ForestStatusBar />
      <Screen
        edges={[]} testID="habits-ring-screen" contentStyle={s.page} footer={footer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={sc.textMuted} />}
      >
        <View style={s.mast}>{mast}</View>
        {body ? <View style={s.body}>{body}</View> : null}
      </Screen>
    </>
  );
}

const GAP = 12, MINI = 38, FADE_MS = 200, HOLD_MS = 2400;
const serif: TextStyle = { fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', fontVariant: ['lining-nums', 'tabular-nums'] };

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  page: { paddingHorizontal: 0 },
  flex: { flex: 1, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  light: { color: sc.textOnAccent },
  muted: { color: sc.textOnMastheadMuted },
  ink: { color: sc.textPrimary },
  soft: { color: sc.textMuted },
  pressed: { opacity: 0.7 },
  tabs: { flexDirection: 'row', gap: 20 },
  tab: { minHeight: layout.touchMin, justifyContent: 'center' },
  tabText: { ...typography.bodyMd },
  underline: { height: 3, borderRadius: radius.chip, backgroundColor: sc.data.leaf },
  mast: {
    backgroundColor: sc.surface.masthead, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 24, gap: 24,
  },
  serif: { ...serif, fontSize: 32, lineHeight: 40 },
  count: { ...serif, fontSize: 40, lineHeight: 50 },
  placeholder: { backgroundColor: sc.surface.forestBand },
  bar: { height: 18, borderRadius: radius.control, width: '80%' },
  barShort: { width: '55%' },
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 6, minWidth: layout.touchMin },
  letter: { ...typography.caption },
  mark: { width: 18, height: 3 },
  body: { paddingHorizontal: layout.gutter, paddingTop: 20, gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  listed: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.surface.sageLine, backgroundColor: sc.bgSurface, paddingHorizontal: 16 },
  listedRow: { paddingVertical: 14 },
  listedLine: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: sc.surface.sageLine },
  notice: {
    position: 'absolute', top: 12, left: layout.gutter, right: layout.gutter, alignItems: 'center', borderRadius: radius.chip, paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: sc.bgSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.surface.sageLine,
  },
  noticeText: { ...typography.bodySmall, fontStyle: 'italic', color: colors.error },
  tile: { borderRadius: radius.card, padding: 16, gap: 8, minHeight: layout.rowMinHeight, borderWidth: StyleSheet.hairlineWidth },
  tileOpen: { backgroundColor: sc.bgSurface, borderColor: sc.surface.sageLine },
  tileDone: { backgroundColor: sc.surface.sage, borderColor: sc.surface.sage },
  check: { width: 32, height: 32, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  checkOpen: { borderWidth: 2, borderColor: sc.textPrimary },
  checkDone: { backgroundColor: sc.data.forest },
  checkIdea: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: sc.data.planned },
  added: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: radius.chip, backgroundColor: sc.surface.masthead, alignItems: 'center', justifyContent: 'center' },
  initial: { ...serif, fontSize: 13, lineHeight: 17, color: sc.textOnAccent },
});
