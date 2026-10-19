/**
 * LEARN-M5, board c05 (flag learnCourses): one lesson's page, the coach's note and Mark as complete, done only after
 * the server saves it (300 ms fade, none with Reduce Motion; success haptic). Offline the page reads and the button
 * waits, with the reason. The video player is plan PR 6; the finish moments are plan PR 7.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, Screen } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { lessonsApi } from '../../../services/api';
import { LearnBack, LearnText, LessonMark } from './LearnParts';
import { CoachNote } from './CourseParts';
import { courseCopy, lessonMeta, useCourse } from './courseData';

export default function CourseLessonScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id, lesson: lessonId } = (useRoute().params ?? {}) as { id?: string; lesson?: string };
  const reduced = useReducedMotion();
  const online = isEffectivelyOnline(useNetworkStatus());
  const { query, course, known, markDone } = useCourse(id);
  const copy = courseCopy(known?.coach ?? null);
  const week = course?.weeks.find((w) => w.open && w.lessons.some((l) => l.id === lessonId));
  const lesson = week?.lessons.find((l) => l.id === lessonId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  if (!lesson || !week) {
    const failed = query.error || course;
    return (
      <Screen edges={['top']} testID="course-lesson">
        <LearnBack navigation={navigation} />
        <View style={s.state}>{failed ? <QuietError layout="inline" message={copy.failed} onRetry={() => void query.refetch()} /> : <QuietLoading label={copy.loading} rows={4} />}</View>
      </Screen>
    );
  }

  const complete = async () => {
    if (saving) return;
    setSaving(true); setSaveError(null);
    try {
      await lessonsApi.complete(lesson.id);
      fade.setValue(reduced ? 1 : 0);
      markDone(lesson.id);
      void HapticService.success();
      if (!reduced) Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } catch {
      setSaveError('Lesson completion did not save. Check your connection and try again.');
      void HapticService.error();
    } finally {
      setSaving(false);
    }
  };

  const reason = saveError ?? (online ? null : copy.offline);
  const footer = lesson.done ? undefined : (
    <View style={s.footer}>
      {reason ? <Text style={s.ink} accessibilityRole={saveError ? 'alert' : undefined} testID="course-lesson-reason">{reason}</Text> : null}
      <PrimaryButton label={saving ? 'Saving completion…' : 'Mark as complete'} loading={saving} disabled={!online} onPress={() => void complete()} testID="course-lesson-complete" />
    </View>
  );

  return (
    <Screen edges={['top']} footer={footer} testID="course-lesson">
      <LearnBack navigation={navigation} label={`Week ${week.n}`} />
      <Overline style={s.eyebrow}>{`Lesson ${lesson.n} · ${lessonMeta(lesson)}`}</Overline>
      <Text style={s.title} accessibilityRole="header">{lesson.title}</Text>
      {lesson.body ? <View style={s.text}><LearnText text={lesson.body} /></View> : null}
      {lesson.note ? <CoachNote from={copy.from} text={lesson.note} testID="course-lesson-note" /> : null}
      {lesson.done ? (
        <Animated.View style={[s.closure, { opacity: fade }]} accessible accessibilityLiveRegion="polite" testID="course-lesson-done">
          <LessonMark state="done" />
          <Text style={[s.closureText, s.fill]}>{`Lesson ${lesson.n} complete.`}</Text>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  state: { marginTop: 16 },
  eyebrow: { marginTop: 12 },
  title: { ...typography.h1, color: sc.textPrimary, marginTop: 8, marginBottom: 16 },
  text: { marginBottom: 8 },
  ink: { ...typography.bodySmall, color: sc.textPrimary },
  footer: { gap: layout.footerItemGap },
  closure: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: layout.rowMinHeight, paddingHorizontal: 16, paddingVertical: 12, marginTop: 20,
    backgroundColor: sc.bgSurface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  closureText: { ...typography.bodyMd, color: sc.textPrimary },
  fill: { flex: 1 },
});
