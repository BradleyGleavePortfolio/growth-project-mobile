/** LEARN-M5, boards c03, c12, c13 (flag learnCourses): the course home. This week and its end date over one bar per week, Up next with the one forest
 * button, then the weeks; a week not open yet says when it opens and opens its sheet (c09, LEARN-M7). A week just finished shows c08 (the week that
 * finishes the course opens c10); a finished course swaps Up next for the record (c10). A week with no lessons counts as done. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, Screen } from '../../../ui';
import { QuietError, QuietLoading, isConnectionFailure } from '../../../ui/states/QuietStates';
import { Skeleton } from '../../../ui/skeletons/Skeleton';
import FadeInView from '../../../components/FadeInView';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { CourseMark, CourseMasthead, makeCourseStyles } from './CourseParts';
import { LockedWeekSheet, WeekCompleteSheet, useWeekMoment, weekDone } from './CourseMomentSheet';
import { courseCopy, courseNow, dayLabel, doneIn, lessonMeta, today, useCourse, type CourseWeek } from './courseData';

export default function CourseHomeScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => ({ ...makeCourseStyles(sc), ...makeStyles(sc) }), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id } = (useRoute().params ?? {}) as { id?: string };
  const online = isEffectivelyOnline(useNetworkStatus());
  const { query, course, known } = useCourse(id);
  const copy = courseCopy(known?.coach ?? null);
  const [locked, setLocked] = useState<CourseWeek | null>(null);
  const moment = useWeekMoment(course);

  // Offline on first open: the page loads by itself once the phone is back online (as Learn).
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && !course) void query.refetch();
    wasOnline.current = online;
  }, [online, course, query]);

  if (!course) {
    const failed = query.error || !online;
    return (
      <Screen edges={[]} contentStyle={s.page} testID="course-home">
        <CourseMasthead navigation={navigation}>
          {known ? <Overline style={s.onDarkMuted}>{known.title}</Overline> : null}
          {failed ? null : <View style={s.skelHead}><Skeleton width="70%" height={36} borderRadius={radius.chip} /><Skeleton width="100%" height={8} borderRadius={radius.chip} /></View>}
        </CourseMasthead>
        <View style={s.body}>
          {failed ? (
            <QuietError layout="inline" testID="course-error" onRetry={() => void query.refetch()}
              message={!online ? copy.noAnswer : isConnectionFailure(query.error) ? `${copy.failed} ${copy.noAnswer}` : copy.failed} />
          ) : (
            <><QuietLoading label={copy.loading} rows={4} testID="course-loading" />
              <Text style={[s.muted, s.section]} importantForAccessibility="no" accessibilityElementsHidden>{copy.loading}</Text></>
          )}
        </View>
      </Screen>
    );
  }

  const on = today();
  const { week, until, next, nextWeek, done, total } = courseNow(course, on);
  const shown = week ?? course.weeks[0];
  const openWeek = (w: CourseWeek) => { void HapticService.selection(); if (w.open) navigation.navigate('CourseWeek', { id: course.id, week: w.id }); else setLocked(w); };

  return (
    <Screen edges={[]} contentStyle={s.page} testID="course-home">
      <CourseMasthead navigation={navigation}>
        <Overline style={s.onDarkMuted}>{course.title}</Overline>
        {shown ? <Text style={s.title} accessibilityRole="header">{copy.weekOf(shown.n, course.weeks.length)}</Text> : null}
        <Text style={s.onDarkBody}>{course.startsOn ? `${copy.from} · started ${dayLabel(course.startsOn, false)}` : copy.from}</Text>
        <View style={s.bars} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {course.weeks.map((w) => (
            <View key={w.id} style={s.barCol}>
              <View style={[s.bar, w === week && s.barNow]}>
                <View style={[s.barFill, { flex: w.lessons.length ? doneIn(w) : 1 }]} /><View style={{ flex: w.lessons.length - doneIn(w) }} />
              </View>
              <Text style={[s.barN, w === week && s.barNNow]}>{w.n}</Text>
            </View>
          ))}
        </View>
        <View style={s.foot}>
          <Text style={s.onDarkBody}>{copy.lessons(done, total)}</Text>
          {week && until ? <Text style={s.onDarkBody}>{copy.openUntil(week.n, until)}</Text> : null}
        </View>
      </CourseMasthead>
      <FadeInView duration={300} style={s.body}>
        {online ? null : (
          <View style={s.offline} testID="course-offline">
            <Ionicons name="cloud-offline-outline" size={20} color={sc.textPrimary} />
            <Text style={[s.ink, s.fill]}>{copy.offline}</Text>
          </View>
        )}
        {next && nextWeek ? (
          <View style={s.card} testID="course-up-next">
            <Overline>Up next</Overline>
            <Text style={s.cardTitle}>{next.title}</Text>
            <Text style={s.muted}>{`Week ${nextWeek.n} · lesson ${nextWeek.lessons.indexOf(next) + 1} of ${nextWeek.lessons.length} · ${lessonMeta(next)}`}</Text>
            <PrimaryButton label={next.kind === 'page' ? `Read lesson ${next.n}` : `Watch lesson ${next.n}`} style={s.cardButton} testID="course-next"
              onPress={() => navigation.navigate('CourseLesson', { id: course.id, lesson: next.id })} />
          </View>
        ) : total > 0 && done === total ? (
          <View style={s.card} testID="course-record-card">
            <Overline>Course complete</Overline>
            <Text style={s.cardTitle}>{course.title}</Text>
            <PrimaryButton label="Your record" style={s.cardButton} testID="course-record-open" onPress={() => navigation.navigate('CourseComplete', { id: course.id })} />
          </View>
        ) : null}
        <Overline style={s.section}>Weeks</Overline>
        <View style={s.list}>
          {course.weeks.map((w, i) => {
            const d = doneIn(w);
            const all = weekDone(w);
            const name = w.title ? `Week ${w.n} · ${w.title}` : `Week ${w.n}`;
            const line = !w.open ? (w.opensOn ? `Opens ${dayLabel(w.opensOn)}` : '')
              : all ? 'Done' : `${d} of ${w.lessons.length} done${w.finishBy && w.finishBy >= on ? ` · finish by ${dayLabel(w.finishBy)}` : ''}`;
            // A week not open yet opens its sheet (c09): no chevron, a lock.
            return (
              <Pressable key={w.id} onPress={() => openWeek(w)} accessibilityRole="button"
                accessibilityLabel={`${name}, ${line}`} testID={`course-week-${w.n}`} style={({ pressed }) => [s.row, i > 0 && s.rowLine, pressed && s.pressed]}>
                {w.open ? <CourseMark state={all ? 'done' : 'next'} n={w.n} /> : <CourseMark state="later" icon="locked" />}
                <View style={s.fill}><Text style={s.rowTitle}>{name}</Text><Text style={s.muted}>{line}</Text></View>
                {w.open ? <Ionicons name="chevron-forward" size={20} color={sc.textMuted} /> : null}
              </Pressable>
            );
          })}
        </View>
      </FadeInView>
      {locked ? <LockedWeekSheet course={course} week={locked} onClose={() => setLocked(null)} /> : null}
      {moment.week ? <WeekCompleteSheet course={course} week={moment.week} onClose={moment.close} /> : null}
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  skelHead: { gap: 14, marginTop: 10 },
  bars: { flexDirection: 'row', gap: 6, marginTop: 18 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  bar: { alignSelf: 'stretch', flexDirection: 'row', height: 8, borderRadius: radius.chip, backgroundColor: sc.surface.forestBand, overflow: 'hidden' },
  barNow: { borderWidth: 1, borderColor: sc.textOnAccent },
  barFill: { backgroundColor: sc.data.leaf },
  barN: { ...typography.caption, letterSpacing: 0, color: sc.textOnMastheadMuted, fontVariant: ['tabular-nums'] },
  barNNow: { color: sc.textOnAccent },
  offline: { flexDirection: 'row', gap: 12, backgroundColor: colors.cream, borderRadius: radius.card, padding: 16, marginBottom: 16 },
  ink: { ...typography.bodySmall, color: sc.textPrimary },
  card: { backgroundColor: sc.bgSurface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border, padding: 20, gap: 6 },
  cardTitle: { ...typography.h3, color: sc.textPrimary },
  cardButton: { marginTop: 12 },
  section: { marginTop: 28, marginHorizontal: 4, marginBottom: 4 },
});
