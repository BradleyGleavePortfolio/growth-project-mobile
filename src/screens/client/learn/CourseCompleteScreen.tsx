/** LEARN-M7, board c10 (flag learnCourses; MOCK-LEARN2 option A, plan PR 7): the record of a finished course. Gold only here, on the deep top.
 * Opened from the course home once every lesson is done; it reads what the home read (the Finished date waits for a server field, see the PR). */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, Screen } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { CourseMasthead, makeCourseStyles } from './CourseParts';
import { weekDone } from './CourseMomentSheet';
import { courseCopy, courseNow, dayLabel, useCourse } from './courseData';

export default function CourseCompleteScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => ({ ...makeCourseStyles(sc), ...makeStyles(sc) }), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id } = (useRoute().params ?? {}) as { id?: string };
  const { query, course, known } = useCourse(id);
  const copy = courseCopy(known?.coach ?? null);
  const { done, total } = course ? courseNow(course) : { done: 0, total: 0 };

  if (!course || total === 0 || done < total) {
    return (
      <Screen edges={[]} contentStyle={s.page} testID="course-complete">
        <CourseMasthead navigation={navigation} back={known?.title}><View /></CourseMasthead>
        <View style={s.body}>{query.error || course ? <QuietError layout="inline" message={copy.failed} onRetry={() => void query.refetch()} /> : <QuietLoading label={copy.loading} rows={3} />}</View>
      </Screen>
    );
  }

  const started = course.startsOn ? `${dayLabel(course.startsOn, false)}, ${course.startsOn.slice(0, 4)}` : null;
  const rows = [started && ['Started', started], ['Lessons', `${done} of ${total}`], ['Weeks', `${course.weeks.filter(weekDone).length} of ${course.weeks.length}`]].filter((r): r is string[] => !!r);
  const footer = <PrimaryButton label="Back to Train" onPress={() => navigation.navigate('WorkoutMain')} testID="course-complete-back" />;

  return (
    <Screen edges={[]} contentStyle={s.page} footer={footer} testID="course-complete">
      <CourseMasthead navigation={navigation} back={course.title}>
        <Ionicons name="ribbon-outline" size={40} color={sc.data.peak} style={s.ribbon} />
        <Overline style={{ color: sc.data.peak }}>Course complete</Overline>
        <Text style={s.title} accessibilityRole="header">{course.title}</Text>
        {course.coach ? <Text style={s.onDarkBody}>{`Taught by ${course.coach}`}</Text> : null}
      </CourseMasthead>
      <View style={s.body}>
        <View style={s.record} testID="course-record">
          <Overline>Your record</Overline>
          {rows.map(([label, value], i) => (
            <View key={label} style={[s.recordRow, i > 0 && s.rowLine]} accessible accessibilityLabel={`${label}, ${value}`}>
              <Text style={s.muted}>{label}</Text>
              <Text style={s.value}>{value}</Text>
            </View>
          ))}
        </View>
        <Text style={s.again}>Every lesson stays open to watch or read again.</Text>
      </View>
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  ribbon: { marginTop: 16, marginBottom: 12 },
  record: { backgroundColor: sc.bgSurface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border, paddingHorizontal: 20, paddingVertical: 18, gap: 4 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', columnGap: 12, minHeight: layout.rowMinHeight, paddingVertical: 10 },
  value: { ...typography.bodyMd, color: sc.textPrimary, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  again: { ...typography.bodySmall, color: sc.textMuted, marginTop: 16, marginHorizontal: 4 },
});
