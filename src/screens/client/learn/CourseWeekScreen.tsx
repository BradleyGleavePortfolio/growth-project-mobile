/** LEARN-M5, board c04 (flag learnCourses): one open week with its dates, the coach's note and its lessons (kind and minutes; the first not done says Up
 * next), then when the next week opens. Finishing the last lesson shows the week's c08 page (LEARN-M7) once the client is back here. */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, Screen } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { WeekCompleteSheet, useWeekMoment } from './CourseMomentSheet';
import { CoachNote, CourseMark, CourseMasthead, makeCourseStyles } from './CourseParts';
import { courseCopy, dayLabel, doneIn, lessonMeta, useCourse } from './courseData';

export default function CourseWeekScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => ({ ...makeCourseStyles(sc), ...makeStyles(sc) }), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id, week: weekId } = (useRoute().params ?? {}) as { id?: string; week?: string };
  const { query, course, known } = useCourse(id);
  const copy = courseCopy(known?.coach ?? null);
  const week = course?.weeks.find((w) => w.id === weekId && w.open);
  const moment = useWeekMoment(week && [week]);

  if (!course || !week) {
    return (
      <Screen edges={[]} contentStyle={s.page} testID="course-week">
        <CourseMasthead navigation={navigation} back={known?.title}><View /></CourseMasthead>
        <View style={s.body}>{query.error || course ? <QuietError layout="inline" message={copy.failed} onRetry={() => void query.refetch()} /> : <QuietLoading label={copy.loading} rows={3} />}</View>
      </Screen>
    );
  }

  const d = doneIn(week);
  const next = week.lessons.find((l) => !l.done);
  const after = course.weeks[week.n];
  const dates = week.opensOn && week.finishBy ? `Open ${dayLabel(week.opensOn, false)} to ${dayLabel(week.finishBy, false)} · ` : '';
  const open = (lesson: string) => { void HapticService.selection(); navigation.navigate('CourseLesson', { id: course.id, lesson }); };

  return (
    <Screen edges={[]} contentStyle={s.page} testID="course-week">
      <CourseMasthead navigation={navigation} back={course.title}>
        <Overline style={s.onDarkMuted}>{copy.weekOf(week.n, course.weeks.length)}</Overline>
        <Text style={s.title} accessibilityRole="header">{week.title || `Week ${week.n}`}</Text>
        <Text style={s.onDarkBody}>{`${dates}${d} of ${week.lessons.length} done`}</Text>
      </CourseMasthead>
      <View style={s.body}>
        {week.note ? <CoachNote from={copy.from} text={week.note} testID="course-week-note" /> : null}
        <View style={[s.list, week.note ? s.gap : null]}>
          {week.lessons.map((l, i) => {
            const state = l.done ? 'done' : l === next ? 'next' : 'later';
            return (
              <Pressable key={l.id} onPress={() => open(l.id)} accessibilityRole="button" testID={`course-lesson-${l.n}`}
                accessibilityLabel={`Lesson ${l.n}, ${l.title}, ${lessonMeta(l)}, ${l.done ? 'complete' : l === next ? 'up next' : 'not complete'}`}
                style={({ pressed }) => [s.row, i > 0 && s.rowLine, pressed && s.pressed]}>
                <CourseMark state={state} icon={l.kind} />
                <View style={s.fill}>
                  <Text style={s.rowTitle}>{l.title}</Text>
                  {state === 'next' ? <View style={s.pill}><Text style={s.pillText}>Up next</Text></View> : null}
                  <Text style={s.muted}>{`${l.n} · ${lessonMeta(l)}`}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={sc.textMuted} />
              </Pressable>
            );
          })}
        </View>
        {after && !after.open && after.opensOn ? (
          <View style={s.opens}>
            <Ionicons name="time-outline" size={18} color={sc.textMuted} />
            <Text style={s.muted}>{`Week ${after.n} opens ${dayLabel(after.opensOn)}.`}</Text>
          </View>
        ) : null}
      </View>
      {moment.week ? <WeekCompleteSheet course={course} week={moment.week} onClose={() => { moment.close(); navigation.goBack(); }} /> : null}
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  gap: { marginTop: 16 },
  pill: { alignSelf: 'flex-start', backgroundColor: sc.accent, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 2, marginVertical: 4 },
  pillText: { ...typography.caption, letterSpacing: 0, color: sc.textOnAccent },
  opens: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginHorizontal: 4 },
});
