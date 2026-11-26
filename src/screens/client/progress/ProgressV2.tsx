/**
 * C8 v2 PR 2b, the Progress page behind `clientProgressV2` (planning/MOCKUP3/C8/index-v2.md): weight on the
 * deep forest masthead (Log weight, the trend in the client's unit, one sentence or the saved moment, Week /
 * Month / All, the 2a chart with its usual-range band), then Strength and Training. Pounds on the wire. Up and
 * down share words and colour; no red, no BMI, no streak.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { weightApi, workoutApi } from '../../../services/api';
import { workoutBuilderApi } from '../../../api/workoutBuilderApi';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../../hooks/useCoachlessClient';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, motion, radius, typography } from '../../../theme/tokens';
import { useReduceMotion } from '../wearables/components/useReduceMotion';
import { QuietRow, QuietSection, Screen } from '../../../ui';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { PeakStar, SegmentedRing } from '../../../ui/charts/StyleCMarks';
import PeriodTabs from '../../../components/progress/PeriodTabs';
import WeightTrendChartDark from '../../../components/progress/WeightTrendChartDark';
import WeighInRows from '../../../components/progress/WeighInRows';
import type { WeightPeriod } from '../../../components/progress/weightTrend';
import { formatWeight } from '../../../components/progress/progressFormat';
import type { WorkoutWeek } from '../../coach/client-detail/thisWeek';
import { featureFlags } from '../../../config/featureFlags';
import { getTodayString } from '../../../utils/date';
import { errorMessage } from '../../../types/common';
import { logger } from '../../../utils/logger';
import type { WeightLog } from '../../../types';
import { parseWeightLogRow, weightHistoryRows } from './weightHistory';
import { settleWeighInsHeld, useSentWeighInKeys, useWeighInsOnPhone } from './offlineWeighIn';
import LogWeightSheetV2 from './LogWeightSheetV2';
import * as P from './progressV2';

const short = (day: string) => new Date(P.dayX(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = (at: Date) => at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toLowerCase();
const fail = (what: string) => (err: unknown) => logger.error('progress', `${what} load failed`, { reason: errorMessage(err, what) });

export default function ProgressV2({ onSaved, logWeightAt }: { onSaved?: () => void; logWeightAt?: number }) {
  const { semanticColors: sc } = useTheme();
  const { fontScale } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const user = useCurrentUser();
  const coachless = useCoachlessClient();
  const coaches = useMyCoaches(!!user?.id && !coachless).data;
  const coach = coaches?.find((c) => c.coach_id === user?.coach_id) ?? coaches?.[0];
  // null: no coach, so no sharing words. undefined: not read yet ("Your coach").
  const coachName = coachless ? null : coach?.name.trim().split(/\s+/)[0] || undefined;
  // REFINE-972 (C8 C2_offline): with no signal the page says so on the masthead (the sheet's own network read).
  const network = useNetworkStatus();
  const offline = featureFlags.offlineFoodInDay && !isEffectivelyOnline(network);
  const phoneLine = coachName === null ? 'On this phone. Sends when you are back online.'
    : `On this phone. Goes to ${coachName ?? 'your coach'} when you are back online.`;
  const unit = P.unitOf(user?.profile?.weight_unit);
  const today = getTodayString();
  const [read, setLogs] = useState<WeightLog[] | null>(null);
  // OFFLINE-WATER-WEIGHT-M: this phone's weigh-ins (waiting, and sent until a read holds their key) count once.
  const logs = useWeighInsOnPhone(read, user?.id);
  const [failed, setFailed] = useState(false);
  const [sessions, setSessions] = useState<P.Session[]>([]);
  const [plan, setPlan] = useState<WorkoutWeek | null>(null);
  const [period, setPeriod] = useState<WeightPeriod>('30D');
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState<{ lbs: number; at: Date; move: number | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [readAt, setReadAt] = useState<Date | null>(null);
  useEffect(() => { if (logWeightAt) setSheet(true); }, [logWeightAt]);

  const userId = user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    await Promise.all([
      weightApi.getHistory(3650).then((res) => {
        const rows = weightHistoryRows(res.data).map((r) => parseWeightLogRow(r, userId))
          .filter((l): l is WeightLog => l !== null).sort((a, b) => a.date.localeCompare(b.date));
        setLogs(rows);
        setFailed(false);
        setReadAt(new Date());
        void settleWeighInsHeld(rows);
      }, (err: unknown) => { setFailed(true); fail('weight history')(err); }),
      workoutApi.getAll(P.SESSIONS).then((res) => setSessions(Array.isArray(res.data) ? res.data : []), fail('workouts')),
      coachless ? null : workoutBuilderApi.listMyAssignments().then((rows) => setPlan(P.trainingWeek(rows, getTodayString())), fail('assignments')),
    ]);
  }, [userId, coachless]);
  useEffect(() => { void load(); }, [load]);
  // OFFLINE-WATER-WEIGHT-M (G2): a weigh-in this phone sent is read back once the history holds it.
  const sentKeys = useSentWeighInKeys();
  useEffect(() => { if (sentKeys) void load(); }, [sentKeys, load]);

  // The saved moment (index-v2 section 7): a 300 ms decelerating fade, 150 ms with Reduce Motion.
  const reduce = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!saved) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: reduce ? 150 : 300, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true }).start();
  }, [saved, reduce, fade]);
  const logged = (lbs: number, queued?: boolean) => {
    if (queued) {
      // OFFLINE-WATER-WEIGHT-M: no saved moment for a weigh-in the coach cannot see yet. REFINE-972 (index-v2.md:232):
      // with offlineFoodInDay on the page draws it (the ring, its callout, the line under the chart) and says the line.
      // FIX-972R2 (B2): an earlier online weigh-in's saved moment ends here (coached and coachless), so the page never
      // says the coach sees a weigh-in while this one waits on the phone, and "Updated" shows again when offline.
      setSaved(null);
      setSheet(false);
      if (featureFlags.offlineFoodInDay) AccessibilityInfo.announceForAccessibility(phoneLine);
      onSaved?.();
      return;
    }
    const earlier = (logs ?? []).filter((l) => l.date !== today);
    const before = P.trendNow(earlier, today);
    const after = P.trendNow([...earlier, { id: '', userId: '', coachId: '', date: today, weight: lbs, unit: 'lbs', createdAt: '' }], today);
    setSaved({ lbs, at: new Date(), move: before == null || after == null ? null : after - before });
    setSheet(false);
    AccessibilityInfo.announceForAccessibility('Weigh-in saved');
    void load();
    onSaved?.();
  };

  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const ink = { color: sc.textPrimary };
  const has = !!logs?.length;
  const trend = logs && has ? P.trendNow(logs, today) : null;
  const sentence = logs && has ? P.trendSentence(logs, period, unit, today) : null;
  const num = (lbs: number) => P.one(P.toUnit(lbs, unit));
  const best = P.latestBest(sessions, today);
  const counts = P.weeklyWorkouts(sessions, today);
  const training = plan || counts.some((c) => c > 0);
  const tile = [s.tile, fontScale <= 1.15 && s.grow];
  const retry = () => { setRefreshing(true); void load().then(() => setRefreshing(false)); };
  const since = logs?.[0] ? `Since ${P.monthDay(logs[0].date)}` : null;
  const waiting = !!logs?.some((l) => l.pending);
  return (
    <>
      <ForestStatusBar />
      <Screen edges={[]} testID="progress-screen" contentStyle={s.page} refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={retry} tintColor={sc.textMuted} />}>
        <View style={[s.mast, { backgroundColor: sc.surface.masthead }, !has && s.mastEnd]} testID="progress-masthead">
          <View style={s.row}>
            {coachName ? <View style={[s.avatar, { backgroundColor: sc.textOnAccent }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.initial}>{coachName.charAt(0).toUpperCase()}</Text></View> : null}
            <View style={s.flex}>
              {since ? <Text style={[typography.eyebrow, muted]}>{since}</Text> : null}
              <Text style={[typography.h1, light]} accessibilityRole="header">Your progress</Text>
            </View>
          </View>
          {offline ? (
            <View testID="progress-offline-card" role="status" accessibilityLiveRegion="polite" style={[s.row, s.top, s.card]}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.warningInk} style={s.glyph} />
              <Text style={[typography.body, s.flex, { color: colors.charcoal }]}>No connection. Weigh-ins are kept on this phone and send when you are back online.</Text>
            </View>
          ) : null}
          <View style={[s.row, s.apart]}>
            <Text style={[typography.eyebrow, muted]}>Weight</Text>
            <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="Log weight" testID="progress-log-weight"
              style={[s.row, s.chip, { borderColor: sc.textOnMastheadMuted }]}>
              <Ionicons name="add" size={20} color={sc.textOnAccent} />
              <Text style={[typography.bodyMd, light]}>Log weight</Text>
            </Pressable>
          </View>
          {failed && !has ? (
            <View style={[s.fail, { borderColor: sc.textOnMastheadMuted }]}>
              <Text style={[typography.body, light, s.center]}>The weight chart did not load. Pull down to try again.</Text>
              <Pressable onPress={retry} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Try again" testID="progress-retry"
                style={[s.row, s.chip, { borderColor: sc.textOnMastheadMuted }]}>
                <Ionicons name="refresh" size={18} color={sc.textOnAccent} />
                <Text style={[typography.bodyMd, light]}>Try again</Text>
              </Pressable>
            </View>
          ) : logs && !has ? <Text style={[typography.body, light]}>No weigh-ins yet. The first one sets the starting point.</Text> : null}
          {trend != null ? (
            <View style={[s.row, s.base]}>
              <Text style={[s.big, light]} maxFontSizeMultiplier={1.3}>{num(trend)}</Text>
              <Text style={[typography.body, muted]}>{unit} trend</Text>
            </View>
          ) : null}
          {saved ? (
            <Animated.View style={[s.row, s.top, { opacity: fade }]} testID="progress-saved" accessibilityLiveRegion="polite">
              <View style={[s.disc, { backgroundColor: sc.data.trend }]}><Ionicons name="checkmark" size={20} color={colors.ink} /></View>
              <View style={s.flex}>
                <Text style={[typography.bodyMd, light]}>Weigh-in saved</Text>
                <Text style={[typography.body, muted]}>{`${num(saved.lbs)} ${unit} at ${clock(saved.at)}.${coachless ? '' : ` ${coachName ?? 'Your coach'} sees it.`}`}</Text>
                {saved.move != null ? <Text style={[typography.body, light]}>{P.trendMove(saved.move, unit)}</Text> : null}
              </View>
            </Animated.View>
          ) : offline && readAt && sentence ? <Text style={[typography.body, muted]} testID="progress-updated">{`Updated ${clock(readAt)}`}</Text>
            : sentence ? <Text style={[typography.body, muted]}>{sentence}</Text> : null}
          {has ? <PeriodTabs variant="dark" value={period} onChange={(p) => { if (p !== '90D') setPeriod(p); }} /> : null}
        </View>
        {logs && has ? <WeightTrendChartDark data={P.samplesOf(logs)} period={period} through={P.dayX(today)} unit={unit}
          goal={user?.profile?.target_weight_lbs ? { value: user.profile.target_weight_lbs } : undefined}
          phoneLine={waiting ? phoneLine : undefined} testID="progress-weight-chart" /> : null}

        <View style={[s.gutter, !has && s.gutterTop]}>
          {best || training ? (
            <View style={[s.row, s.top, fontScale > 1.15 && s.stack]}>
              {best ? (
                <View style={[tile, { backgroundColor: sc.surface.masthead }]} testID="progress-strength">
                  <Text style={[typography.eyebrow, muted]}>Strength</Text>
                  {best.isNew ? <View style={s.row}><PeakStar onDark /><Text style={[typography.bodyMd, { color: sc.data.peak }]}>New best</Text></View> : null}
                  <Text style={[s.mid, light]}>{formatWeight(P.toUnit(best.weight, unit))}
                    <Text style={[typography.bodyMd, light]}>{` ${unit} \u00d7 ${best.reps}`}</Text></Text>
                  <Text style={[typography.bodySmall, muted]}>{`${best.name}, ${short(best.date)}`}</Text>
                </View>
              ) : null}
              {training ? (
                <View style={[tile, { backgroundColor: sc.surface.sage }]} testID="progress-training">
                  <Text style={[typography.eyebrow, { color: sc.textMuted }]}>Training</Text>
                  {plan ? (
                    <View style={[s.row, s.wrap]} accessible accessibilityLabel={`${plan.done} of ${plan.total} done, this week`}>
                      <SegmentedRing segments={plan.segments} size={64} label={`${plan.done} of ${plan.total} done`}>
                        <Text style={[typography.bodyMd, ink]}>{`${plan.done}/${plan.total}`}</Text>
                      </SegmentedRing>
                      <View style={s.ringText}>
                        <Text style={[typography.bodyMd, ink]}>{`${plan.done} of ${plan.total} done`}</Text>
                        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>This week</Text>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Text style={[s.mid, ink]}>{counts[7]}</Text>
                      <Text style={[typography.bodySmall, ink]}>{counts[7] === 1 ? 'workout this week' : 'workouts this week'}</Text>
                      <View style={[s.row, s.bars]} accessible accessibilityRole="image" accessibilityLabel={`Workouts in the last 8 weeks: ${counts.join(', ')}`}>
                        {counts.map((c, i) => <View key={`week-${i}`} style={{ width: 10, height: 2 + (34 * c) / Math.max(1, ...counts),
                          backgroundColor: i === 7 ? sc.data.forest : sc.data.moss }} />)}
                      </View>
                      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Last 8 weeks</Text>
                    </>
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
          {logs && has ? (
            <QuietSection title="Recent weigh-ins">
              <WeighInRows unit={unit} rows={logs.slice(-10).reverse().map((l) => ({ id: l.id, day: short(l.date), weight: Number(num(l.weight)), notes: l.notes }))} />
            </QuietSection>
          ) : null}
          {featureFlags.clientTimelineV2 ? (
            <QuietRow label="Timeline" detail="Weigh-ins and wins, newest first." onPress={() => navigation.navigate('Timeline')} accessibilityHint="Opens your timeline" testID="progress-timeline" />
          ) : null}
          <QuietRow label="View progress report" onPress={() => navigation.navigate('Report')} testID="progress-report" />
        </View>
      </Screen>
      <LogWeightSheetV2 visible={sheet} unit={unit} today={today} lastLog={logs?.[logs.length - 1] ?? null} coachName={coachName}
        onClose={() => setSheet(false)} onSaved={logged} userId={user?.id} />
    </>
  );
}

const serif: TextStyle = { fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', fontVariant: ['lining-nums', 'tabular-nums'] };
const s = StyleSheet.create({
  page: { paddingHorizontal: 0 },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  apart: { justifyContent: 'space-between' },
  base: { alignItems: 'baseline', flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  mast: { paddingHorizontal: 24, paddingTop: 12, gap: 16 },
  mastEnd: { paddingBottom: 24, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  avatar: { width: 44, height: 44, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  initial: { ...serif, fontSize: 24, lineHeight: 30, color: colors.ink },
  fail: { alignItems: 'center', gap: 16, padding: 24, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.card },
  card: { padding: 16, borderWidth: 1, borderRadius: radius.card, backgroundColor: colors.warningBg, borderColor: colors.warningInk },
  glyph: { marginTop: 2 },
  center: { textAlign: 'center' },
  chip: { gap: 6, minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: radius.button },
  big: { ...serif, fontSize: 64, lineHeight: 80 },
  mid: { ...serif, fontSize: 30, lineHeight: 38 },
  disc: { width: 32, height: 32, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  gutter: { paddingHorizontal: 24, gap: 24 },
  gutterTop: { paddingTop: 24 },
  tile: { alignSelf: 'stretch', borderRadius: radius.card, padding: 16, gap: 8 },
  grow: { flex: 1 },
  bars: { alignItems: 'flex-end', gap: 6, height: 40 },
  wrap: { flexWrap: 'wrap' },
  ringText: { flexBasis: 50, flexGrow: 1, gap: 2 },
});
