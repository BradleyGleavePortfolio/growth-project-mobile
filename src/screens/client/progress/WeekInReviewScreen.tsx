/**
 * C8 slice 3, Style C with v2 greens. Emotional target (5.1): reassured by
 * the week, not judged by it. Existing Report door; no forms or coach notes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen, useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import { getTodayString } from '../../../utils/date';
import { unitOf, type WeightUnit } from './progressV2';
import { loadWeekReview, reviewTrend, reviewWeek, sleepLine, weekDate, workoutLine, type WeekReviewData } from './weekReview';

const HABIT_CIRCUMFERENCE = 2 * Math.PI * 38;
type Nav = Pick<NavigationProp<ParamListBase>, 'goBack'>;
export default function WeekInReviewScreen({ navigation }: { navigation: Nav }) {
  const user = useCurrentUser();
  // Remount on identity change: no summary or late response crosses accounts.
  return <WeekReviewPage key={user?.id ?? 'signed-out'} userId={user?.id} unit={unitOf(user?.profile?.weight_unit)} navigation={navigation} />;
}

function WeekReviewPage({ userId, unit, navigation }: { userId?: string; unit: WeightUnit; navigation: Nav }) {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const { fontScale } = useWindowDimensions();
  const [data, setData] = useState<WeekReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const week = reviewWeek(getTodayString());
  const { start, end } = week;
  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const next = await loadWeekReview(userId, { start, end });
      if (mine === request.current) setData(next);
    } catch (err) {
      if (mine === request.current) setError(loadFailureMessage(err, 'Your week'));
    } finally {
      if (mine === request.current) setBusy(false);
    }
  }, [userId, start, end]);
  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const count = data?.habits;
  const habitFraction = count?.planned ? Math.min(count.done / count.planned, 1) : 0;
  const rows = data ? [
    ['Workouts', workoutLine(data)],
    ['Food logged', `${data.food} of 7 days`],
    ['Protein, average', data.protein === null ? 'No food logged' : `${Math.round(data.protein)} g`],
    ['Weight trend', reviewTrend(data.weights, week, unit)],
    ['Habits', count?.planned ? `${count.done} of ${count.planned}` : 'Nothing planned'],
    ['Sleep, average', sleepLine(data.sleepMinutes)],
  ] : [];
  return (
    <>
      <ForestStatusBar />
      <Screen edges={[]} testID="week-review" contentStyle={s.page}
        refreshControl={<RefreshControl refreshing={busy && !!data} onRefresh={() => void load()} tintColor={sc.textMuted} />}>
        <View style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" style={s.back} testID="week-back">
            <Ionicons name="chevron-back" size={22} color={sc.textOnAccent} />
          </Pressable>
          <Text style={[typography.eyebrow, muted]}>{`${weekDate(start)} to ${weekDate(end)}`}</Text>
          <Text style={[typography.h1, light]} accessibilityRole="header">Week in review</Text>
        </View>
        <View style={s.body}>
          {error ? <QuietError message={error} onRetry={() => void load()} retrying={busy} testID="week-error" /> : null}
          {!data && !error ? <QuietLoading label="Loading your week" rows={6} testID="week-loading" /> : null}
          {data ? (
            <>
              {data.empty ? <Text style={[typography.body, { color: sc.textMuted }]} testID="week-empty">No logs for this week.</Text> : null}
              <View style={[s.summary, { backgroundColor: sc.surface.sage }, fontScale > 1.15 && s.stack]}>
                {count?.planned ? <View style={s.ring} accessible accessibilityRole="image" accessibilityLabel={`Habits this week, ${count.done} of ${count.planned} done`}>
                  <Svg width={88} height={88} style={StyleSheet.absoluteFill} accessible={false}>
                    <Circle cx={44} cy={44} r={38} fill="none" stroke={sc.data.planned} strokeWidth={2} />
                    {habitFraction > 0 ? <Circle testID="week-habits-fill" cx={44} cy={44} r={38} fill="none" stroke={sc.data.forest} strokeWidth={7}
                      strokeLinecap="round" strokeDasharray={`${habitFraction * HABIT_CIRCUMFERENCE} ${HABIT_CIRCUMFERENCE}`} rotation={-90} origin="44, 44" /> : null}
                  </Svg>
                  <Text maxFontSizeMultiplier={1.15} style={[typography.h2, { color: sc.textPrimary }]}>{`${count.done}/${count.planned}`}</Text>
                </View> : null}
                <View style={s.summaryText}>
                  <Text style={[typography.h2, { color: sc.textPrimary }]} accessibilityRole="header">Habits this week</Text>
                  <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{`Daily check-ins: ${data.checkIns} of 7`}</Text>
                </View>
              </View>
              {rows.map(([label, value]) => (
                <View key={label} style={[s.row, { borderColor: sc.border }, fontScale > 1.15 && s.stack]} accessible accessibilityLabel={`${label}: ${value}`}>
                  <Text style={[typography.body, s.label, { color: sc.textPrimary }]}>{label}</Text>
                  <Text style={[typography.bodyMd, s.value, { color: sc.textPrimary }, fontScale > 1.15 && s.left]}>{value}</Text>
                </View>
              ))}
            </>
          ) : null}
        </View>
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 0 },
  mast: { paddingHorizontal: 24, paddingBottom: 28, gap: 12, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  back: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  body: { paddingHorizontal: 24, paddingTop: 24, gap: 8 },
  summary: { padding: 16, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  summaryText: { flexShrink: 1, gap: 6 },
  ring: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  label: { flex: 1 },
  value: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  stack: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  left: { textAlign: 'left' },
});
