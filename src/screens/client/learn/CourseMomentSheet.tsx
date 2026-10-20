/** LEARN-M7, boards c06, c08, c09 (flag learnCourses; MOCK-LEARN2 option A, plan PR 7): the course's three moments.
 * c06 `LessonCompleteMoment`: the lesson screen's footer once a lesson saves (the screen mounts it; it owns the 300 ms fade, the caller owns the haptic).
 * c08 `WeekCompleteSheet`: the deep peak page when the last lesson of a week is done. c09 `LockedWeekSheet`: when a week opens and what is in it, titles only.
 * `useWeekMoment` picks the week to celebrate: one that turns done while the course is open, once, on the screen in front (Home or the week). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { LessonMark } from './LearnParts';
import { dayLabel, doneIn, type Course, type CourseLesson, type CourseWeek } from './courseData';

export const weekDone = (w: CourseWeek) => w.lessons.length > 0 && doneIn(w) === w.lessons.length;

/** c06: the check, "Lesson {n} complete.", "{done} of {total} done" and, when one is left in the open week, "Next: {title}". */
export function LessonCompleteMoment({ lesson, done, total, next, onNext }: { lesson: CourseLesson; done: number; total: number; next?: CourseLesson | null; onNext?: (next: CourseLesson) => void }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => { if (!reduced) Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start(); }, [fade, reduced]);
  return (
    <Animated.View style={[s.moment, { opacity: fade }]} testID="lesson-moment">
      <View style={s.momentHead} accessible accessibilityLiveRegion="polite">
        <LessonMark state="done" />
        <View style={s.fill}>
          <Text style={s.momentTitle}>{`Lesson ${lesson.n} complete.`}</Text>
          <Text style={s.muted}>{`${done} of ${total} done`}</Text>
        </View>
      </View>
      {next && onNext ? <PrimaryButton label={`Next: ${next.title}`} onPress={() => onNext(next)} testID="lesson-moment-next" /> : null}
    </Animated.View>
  );
}

/** Which week to celebrate: the first week in `weeks` that turned done after this screen first saw the course, shown once per week across screens,
 * and only while this screen is the one in front (a lesson opened over it waits until the client is back). */
const told = new Set<string>();
export function useWeekMoment(weeks: CourseWeek[] | undefined) {
  const focused = useIsFocused();
  const base = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<CourseWeek | null>(null);
  useEffect(() => {
    if (!weeks) return;
    base.current ??= new Set(weeks.filter(weekDone).map((w) => w.id));
    const fresh = weeks.find((w) => weekDone(w) && !base.current?.has(w.id) && !told.has(w.id));
    if (!fresh || !focused) return;
    told.add(fresh.id);
    void HapticService.success();
    setShown(fresh);
  }, [weeks, focused]);
  return { week: shown, close: () => setShown(null) };
}

/** c08: the deep page. The week bars say how many weeks are done; the next week says when it opens. */
export function WeekCompleteSheet({ course, week, onClose }: { course: Course; week: CourseWeek; onClose: () => void }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const insets = useSafeAreaInsets();
  const after = course.weeks[week.n];
  const weeksDone = course.weeks.filter(weekDone).length;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[s.peak, { paddingTop: insets.top + 48, paddingBottom: Math.max(insets.bottom, layout.footerBottomMin) }]} testID="week-moment">
        <ScrollView contentContainerStyle={s.peakBody} bounces={false}>
          <View style={s.ring}><Ionicons name="checkmark" size={56} color={sc.data.leaf} /></View>
          <Text style={s.peakTitle} accessibilityRole="header">{`Week ${week.n} done`}</Text>
          <Text style={s.peakMuted}>{`${doneIn(week)} of ${week.lessons.length} lessons${week.title ? ` · ${week.title}` : ''}`}</Text>
          {after && !after.open && after.opensOn ? <Text style={s.peakInk}>{`Week ${after.n} opens ${dayLabel(after.opensOn)}.`}</Text> : null}
          <View style={s.bars} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {course.weeks.map((w) => <View key={w.id} style={[s.bar, weekDone(w) && s.barDone]} />)}
          </View>
          <Text style={s.peakMuted}>{`${weeksDone} of ${course.weeks.length} weeks`}</Text>
        </ScrollView>
        <View style={s.peakFoot}><PrimaryButton tone="cream" label="Back to the course" onPress={onClose} testID="week-moment-close" /></View>
      </View>
    </Modal>
  );
}

/** c09: a week not open yet. Its name, when it opens and its lesson titles (no pages, no videos). */
export function LockedWeekSheet({ week, onClose }: { week: CourseWeek; onClose: () => void }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: sc.overlay }]} onPress={onClose} accessible={false} importantForAccessibility="no" testID="locked-week-scrim" />
      <View style={s.dock} pointerEvents="box-none">
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, layout.footerBottomMin) }]} accessibilityViewIsModal testID="locked-week">
          <View style={s.handle} />
          <ScrollView bounces={false} contentContainerStyle={s.sheetBody}>
            <View style={s.lock}><Ionicons name="lock-closed-outline" size={22} color={sc.textPrimary} /></View>
            <Text style={s.sheetTitle} accessibilityRole="header">{week.title ? `Week ${week.n} · ${week.title}` : `Week ${week.n}`}</Text>
            {week.opensOn ? <Text style={s.sheetOpens}>{`Opens ${dayLabel(week.opensOn)}`}</Text> : null}
            {week.lessons.map((l) => <Text key={l.id} style={s.lessonTitle} testID="locked-week-lesson">{l.title}</Text>)}
          </ScrollView>
          <View style={s.sheetFoot}><PrimaryButton label="OK" onPress={onClose} testID="locked-week-close" /></View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  fill: { flex: 1 },
  muted: { ...typography.bodySmall, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  moment: { gap: layout.footerItemGap },
  momentHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  momentTitle: { ...typography.bodyMd, color: sc.textPrimary },
  peak: { flex: 1, backgroundColor: sc.surface.masthead, paddingHorizontal: layout.gutter },
  peakBody: { flexGrow: 1, alignItems: 'center', gap: 10 },
  ring: { width: 104, height: 104, borderRadius: radius.chip, borderWidth: 4, borderColor: sc.data.leaf, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  peakTitle: { ...typography.h1, color: sc.textOnAccent, textAlign: 'center' },
  peakMuted: { ...typography.body, color: sc.textOnMastheadMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  peakInk: { ...typography.body, color: sc.textOnAccent, textAlign: 'center' },
  bars: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: 14 },
  bar: { flex: 1, height: 8, borderRadius: radius.chip, backgroundColor: sc.surface.forestBand },
  barDone: { backgroundColor: sc.data.leaf },
  peakFoot: { paddingTop: 12 },
  dock: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: sc.bgSurface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.chip, backgroundColor: sc.border, marginBottom: 20 },
  sheetBody: { paddingHorizontal: layout.gutter, gap: 8 },
  lock: { width: 48, height: 48, borderRadius: radius.chip, backgroundColor: sc.data.trackLight, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  sheetTitle: { ...typography.h2, color: sc.textPrimary },
  sheetOpens: { ...typography.body, color: sc.textMuted },
  lessonTitle: { ...typography.body, color: sc.textPrimary, paddingVertical: 8 },
  sheetFoot: { paddingHorizontal: layout.gutter, paddingTop: 16 },
});
