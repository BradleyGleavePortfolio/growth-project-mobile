/** LEARN-M5, boards c05 and c06 (flag learnCourses): one lesson's page, the coach's note and Mark as complete, done only after the server saves
 * it (success haptic). Done, the footer is the c06 moment (LessonCompleteMoment: its 300 ms fade, none with Reduce Motion): the week's count and
 * Next to the week's next lesson, in place of this one. Offline the page reads and the button waits, with the reason. Video: CourseVideoPlayer. */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackActions, useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, Screen } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { lessonsApi } from '../../../services/api';
import { LearnBack, LearnText } from './LearnParts';
import { CoachNote } from './CourseParts';
import { LessonCompleteMoment } from './CourseMomentSheet';
import CourseVideoPlayer from './CourseVideoPlayer';
import { courseCopy, doneIn, lessonMeta, useCourse } from './courseData';

export default function CourseLessonScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id, lesson: lessonId } = (useRoute().params ?? {}) as { id?: string; lesson?: string };
  const online = isEffectivelyOnline(useNetworkStatus());
  const { query, course, known, markDone, markPosition } = useCourse(id);
  const copy = courseCopy(known?.coach ?? null);
  const week = course?.weeks.find((w) => w.open && w.lessons.some((l) => l.id === lessonId));
  const lesson = week?.lessons.find((l) => l.id === lessonId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      markDone(lesson.id);
      void HapticService.success();
    } catch {
      setSaveError('Lesson completion did not save. Check your connection and try again.');
      void HapticService.error();
    } finally {
      setSaving(false);
    }
  };

  const reason = saveError ?? (online ? null : copy.offline);
  // Back names where it returns: the week, or the course home when Up next opened the lesson.
  const nav = navigation.getState?.(); const fromWeek = nav?.routes[nav.index - 1]?.name === 'CourseWeek';
  // c06 Next: the week's first lesson still to do; it takes this lesson's place, so Back still returns to the week or the course.
  const next = week.lessons.find((l) => !l.done) ?? null;
  const footer = lesson.done ? (
    <LessonCompleteMoment lesson={lesson} done={doneIn(week)} total={week.lessons.length} next={next}
      onNext={(n) => navigation.dispatch(StackActions.replace('CourseLesson', { id, lesson: n.id }))} />
  ) : (
    <View style={s.footer}>
      {reason ? <Text style={s.ink} accessibilityRole={saveError ? 'alert' : undefined} testID="course-lesson-reason">{reason}</Text> : null}
      <PrimaryButton label={saving ? 'Saving completion…' : 'Mark as complete'} loading={saving} disabled={!online} onPress={() => void complete()} testID="course-lesson-complete" />
    </View>
  );

  return (
    <Screen edges={['top']} footer={footer} testID="course-lesson">
      <LearnBack navigation={navigation} label={fromWeek ? `Week ${week.n}` : known?.title} />
      {lesson.kind !== 'page' ? (
        <View style={s.eyebrow}>
          <CourseVideoPlayer key={lesson.id} lesson={lesson} online={online} offline={lesson.done ? copy.offline : undefined} failed={copy.videoFailed} noAnswer={copy.noAnswer} onPosition={(sec) => markPosition(lesson.id, sec)} />
        </View>
      ) : null}
      <Overline style={s.eyebrow}>{`Lesson ${lesson.n} · ${lessonMeta(lesson)}`}</Overline>
      <Text style={s.title} accessibilityRole="header">{lesson.title}</Text>
      {lesson.body ? <View style={s.text}><LearnText text={lesson.body} /></View> : null}
      {lesson.note ? <CoachNote from={copy.from} text={lesson.note} testID="course-lesson-note" /> : null}
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
});
