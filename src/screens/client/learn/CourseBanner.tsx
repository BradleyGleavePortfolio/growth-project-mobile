/** LEARN-M5 (flag learnCourses): the dark green course banner at the bottom of Train (#TRAIN-START-TOP, #LEARN-TRAIN-BANNER); its button opens the course
 * home (#LEARN-TRAIN-DOOR). Nothing shows without a course (c11). */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui';
import { featureFlags } from '../../../config/featureFlags';
import { useRefreshOnOpen } from '../../../hooks/useRefreshOnOpen';
import { courseCopy, courseNow, doneIn, today, useCourses } from './courseData';

// The flag is fixed for a build, so with it off Train runs no course hook and reads nothing.
export default function CourseBanner({ refreshing = false }: { refreshing?: boolean }) {
  return featureFlags.learnCourses ? <Banner refreshing={refreshing} /> : null;
}

function Banner({ refreshing }: { refreshing: boolean }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { data: [course] = [], refetch } = useCourses();
  // Train stays mounted, so its pull to refresh, a return to Train and a return to the app re-read the courses (as FU-WORKLOG-126).
  useEffect(() => { if (refreshing) void refetch(); }, [refreshing, refetch]);
  useRefreshOnOpen(() => void refetch());
  if (!course) return null;
  const copy = courseCopy(course.coach);
  const { week, until, done, total } = courseNow(course, today());
  const body = week ? `${copy.banner} ${copy.bannerWeek(week.n, doneIn(week), week.lessons.length)}` : copy.banner;
  return (
    <View style={s.card} testID="course-banner">
      <Text style={s.title} accessibilityRole="header">{course.title}</Text>
      <Text style={s.body}>{body}</Text>
      <View style={s.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[s.fill, { flex: done }]} />
        <View style={{ flex: total - done }} />
      </View>
      <View style={s.foot}>
        <Text style={s.muted}>{copy.lessons(done, total)}</Text>
        {week && until ? <Text style={s.muted}>{copy.openUntil(week.n, until)}</Text> : null}
      </View>
      <PrimaryButton tone="cream" label="Open the course" onPress={() => navigation.navigate('Course', { id: course.id })} testID="course-banner-open" />
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  card: { backgroundColor: sc.surface.masthead, borderRadius: radius.card, padding: 20, marginTop: 24, marginBottom: 8, gap: 10 },
  title: { ...typography.h2, color: sc.textOnAccent },
  body: { ...typography.bodySmall, color: sc.textOnMastheadMuted },
  track: { flexDirection: 'row', height: 6, borderRadius: radius.chip, backgroundColor: sc.surface.forestBand, overflow: 'hidden', marginTop: 4 },
  fill: { backgroundColor: sc.data.leaf },
  foot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2, marginBottom: 6 },
  muted: { ...typography.bodySmall, color: sc.textOnMastheadMuted, fontVariant: ['tabular-nums'] },
});
