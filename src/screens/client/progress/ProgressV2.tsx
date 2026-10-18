/**
 * C8 v2 PR 2b, the Progress page behind `clientProgressV2` (planning/MOCKUP3/C8/index-v2.md): weight on the
 * deep forest masthead (Log weight, the trend in the client's unit, one sentence or the saved moment, Week /
 * Month / All, the 2a chart with its usual-range band), then the weigh-ins. Pounds on the wire. Up and down
 * share words and colour; no red, no BMI, no streak.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, RefreshControl, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { weightApi } from '../../../services/api';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../../hooks/useCoachlessClient';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, motion, radius, typography } from '../../../theme/tokens';
import { useReduceMotion } from '../wearables/components/useReduceMotion';
import { QuietRow, QuietSection, Screen } from '../../../ui';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import PeriodTabs from '../../../components/progress/PeriodTabs';
import WeightTrendChartDark from '../../../components/progress/WeightTrendChartDark';
import WeighInRows from '../../../components/progress/WeighInRows';
import type { WeightPeriod } from '../../../components/progress/weightTrend';
import { featureFlags } from '../../../config/featureFlags';
import { getTodayString } from '../../../utils/date';
import { errorMessage } from '../../../types/common';
import { logger } from '../../../utils/logger';
import type { WeightLog } from '../../../types';
import { parseWeightLogRow, weightHistoryRows } from './weightHistory';
import LogWeightSheetV2 from './LogWeightSheetV2';
import * as P from './progressV2';

const short = (day: string) => new Date(P.dayX(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = (at: Date) => at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toLowerCase();
const fail = (what: string) => (err: unknown) => logger.error('progress', `${what} load failed`, { reason: errorMessage(err, what) });

export default function ProgressV2({ onSaved, logWeightAt }: { onSaved?: () => void; logWeightAt?: number }) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const user = useCurrentUser();
  const coachless = useCoachlessClient();
  const coaches = useMyCoaches(!!user?.id && !coachless).data;
  const coach = coaches?.find((c) => c.coach_id === user?.coach_id) ?? coaches?.[0];
  // null: no coach, so no sharing words. undefined: not read yet ("Your coach").
  const coachName = coachless ? null : coach?.name.trim().split(/\s+/)[0] || undefined;
  const unit = P.unitOf(user?.profile?.weight_unit);
  const today = getTodayString();
  const [logs, setLogs] = useState<WeightLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<WeightPeriod>('30D');
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState<{ lbs: number; at: Date; move: number | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (logWeightAt) setSheet(true); }, [logWeightAt]);

  const userId = user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    await weightApi.getHistory(3650).then((res) => {
      setLogs(weightHistoryRows(res.data).map((r) => parseWeightLogRow(r, userId))
        .filter((l): l is WeightLog => l !== null).sort((a, b) => a.date.localeCompare(b.date)));
      setFailed(false);
    }, (err: unknown) => { setFailed(true); fail('weight history')(err); });
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  // The saved moment (index-v2 section 7): a 300 ms decelerating fade, 150 ms with Reduce Motion.
  const reduce = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!saved) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: reduce ? 150 : 300, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true }).start();
  }, [saved, reduce, fade]);
  const logged = (lbs: number) => {
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
  const has = !!logs?.length;
  const trend = logs && has ? P.trendNow(logs, today) : null;
  const sentence = logs && has ? P.trendSentence(logs, period, unit, today) : null;
  const num = (lbs: number) => P.one(P.toUnit(lbs, unit));
  const retry = () => { setRefreshing(true); void load().then(() => setRefreshing(false)); };
  const since = logs?.[0] ? `Since ${P.monthDay(logs[0].date)}` : null;
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
          ) : sentence ? <Text style={[typography.body, muted]}>{sentence}</Text> : null}
          {has ? <PeriodTabs variant="dark" value={period} onChange={(p) => { if (p !== '90D') setPeriod(p); }} /> : null}
        </View>
        {logs && has ? <WeightTrendChartDark data={P.samplesOf(logs)} period={period} through={P.dayX(today)} unit={unit}
          goal={user?.profile?.target_weight_lbs ? { value: user.profile.target_weight_lbs } : undefined} testID="progress-weight-chart" /> : null}

        <View style={[s.gutter, !has && s.gutterTop]}>
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
        onClose={() => setSheet(false)} onSaved={logged} />
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
  mast: { paddingHorizontal: 24, paddingTop: 12, gap: 16 },
  mastEnd: { paddingBottom: 24, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  avatar: { width: 44, height: 44, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  initial: { ...serif, fontSize: 24, lineHeight: 30, color: colors.ink },
  fail: { alignItems: 'center', gap: 16, padding: 24, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.card },
  center: { textAlign: 'center' },
  chip: { gap: 6, minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: radius.button },
  big: { ...serif, fontSize: 64, lineHeight: 80 },
  disc: { width: 32, height: 32, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  gutter: { paddingHorizontal: 24, gap: 24 },
  gutterTop: { paddingTop: 24 },
});
