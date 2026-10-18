/**
 * MetricDetailV2 (HEALTH-2, `featureFlags.healthPages`, off; MOCK-HEALTH boards 5, 6 and 11): the Metric detail of a
 * daily total with a starter goal (Steps, Active energy, Workout duration) on the client's own data. A forest
 * masthead: Back to Health and sleep, Share, the title, Week | Month, the average a day not counting today ("No sample
 * yet", never 0), one leaf bar per local day (today open) with the starter goal as a gold dashed line. Then the Goal
 * card and Recent days. Share opens SHARE-A's sheet on a "Last 7 days" card. Other metrics keep MetricDetailScreen.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { configFor } from '../../../api/wearablesConnectionsApi';
import type { WearableMetricBucket, WearableMetricType } from '../../../api/wearablesSamplesApi';
import ShareSheet, { type ShareCardContent } from '../../../components/share/ShareSheet';
import { Figure, Frame, Ink } from '../../../components/share/shareCards';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { Headline, Overline, Screen } from '../../../ui';
import { useScreenInsets } from '../../../ui/layout/Screen';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, semantic, spacing, typography } from '../../../theme/tokens';
import { useReduceMotion } from './components/useReduceMotion';
import { localDayTotals, savedAt, useFitnessSamples } from './HealthFitnessTab';
import WeekStepBars, { type StepDay } from './cards/WeekStepBars';
import { goalDetail } from './MetricDetailScreen';

const HOUR_MS = 60 * 60 * 1000;
const DAYS = 30;
type Range = 'week' | 'month';
const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const us = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', o);
const SHORT = { month: 'short', day: 'numeric' } as const;
const LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;

/** The average a day over the days with a reading; null when none (never 0 for no data). */
export function dayAverage(days: readonly StepDay[]): number | null {
  const seen = days.flatMap((d) => (d.total == null ? [] : [d.total]));
  return seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : null;
}

/** Under the average. Week: against the 7 days before ("512 more a day than the week before"). Month: the days averaged. */
export function subLine(all: readonly StepDay[], range: Range): string | null {
  const t = all.length - 1;
  if (range === 'month') return `${us(all[0].date, SHORT)} to ${us(all[t - 1].date, SHORT)}`;
  const [now, before] = [dayAverage(all.slice(t - 6, t)), dayAverage(all.slice(t - 13, t - 6))];
  const diff = now == null || before == null ? 0 : Math.round(now) - Math.round(before);
  return diff === 0 ? null : `${whole(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} a day than the week before`;
}

interface Props {
  readonly metric: WearableMetricType;
  readonly bucket: WearableMetricBucket;
  readonly title: string;
  readonly goal: number;
  readonly unit: string;
}

export default function MetricDetailV2({ metric, bucket, title, goal, unit }: Props) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const reduceMotion = useReduceMotion();
  const online = isEffectivelyOnline(useNetworkStatus());
  const user = useCurrentUser();
  const [range, setRange] = useState<Range>('week');
  const [sharing, setSharing] = useState(false);

  // The Fitness tab's own query (30 days to the end of this hour, every metric of the bucket), stable for the hour:
  // online it is already loaded, and offline a first open finds the copy the tab saved. The series is picked below.
  const span = useMemo(() => {
    const to = new Date();
    to.setMinutes(0, 0, 0);
    const end = to.getTime() + HOUR_MS;
    return { from: new Date(end - DAYS * 24 * HOUR_MS).toISOString(), to: new Date(end).toISOString() };
  }, []);
  const query = useFitnessSamples({ bucket, ...span, granularity: 'day' }, online, user?.id);
  const { data, isLoading } = query;
  const series = data?.series.find((s) => s.metric === metric);
  const all = useMemo(() => localDayTotals(series, new Date(), DAYS), [series]);
  const days = range === 'week' ? all.slice(-7) : all;
  const average = dayAverage(days.slice(0, -1));
  const sub = average == null ? null : subLine(all, range);
  const reached = goalDetail(days.flatMap((d) => (d.total == null ? [] : [{ x: d.date.getTime(), y: d.total }])), goal);
  const recent = all.slice(-7).flatMap((d, i) => (d.total == null ? [] : [{ date: d.date, total: d.total, today: i === 6 }])).reverse();
  const source = series?.provider_used ? configFor(series.provider_used).displayName : null;
  const amount = (n: number) => `${whole(n)} ${unit}`;
  const failed = !isLoading && !data;

  const card = useMemo<ShareCardContent | null>(() => {
    const week = all.slice(-7);
    const avg = dayAverage(week.slice(0, -1));
    if (avg == null) return null;
    const foot = [source && `From ${source}`, us(week[6].date, LONG)].filter(Boolean).join(' · ');
    return {
      type: 'health',
      label: `Picture of your card: ${title}, last 7 days, ${whole(avg)} ${unit} a day. ${foot}.`,
      inIt: `In this card: your ${title.toLowerCase()} for the last 7 days and your daily average.`,
      notInIt: 'Not in it: your other health data or where you were.',
      view: (
        <Frame eyebrow="Last 7 days">
          <Ink text={title} style={styles.cardTitle} />
          <Figure value={whole(avg)} unit={`${unit} a day`} />
          <View style={styles.cardBars}>
            <WeekStepBars days={week} goal={goal} title={title} dark bare height={64} reduceMotion />
          </View>
          <Ink muted text={foot} style={styles.cardFoot} />
        </Frame>
      ),
    };
  }, [all, source, title, unit, goal]);

  const back = navigation.canGoBack() ? (
    <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back to Health and sleep"
      style={styles.back} testID="metric-detail-back">
      <Ionicons name="chevron-back" size={24} color={sc.textOnAccent} />
      <Text style={[styles.backText, styles.shrink, { color: sc.textOnAccent }]}>Health and sleep</Text>
    </Pressable>
  ) : <View />;
  const share = card && !failed ? (
    <Pressable
      onPress={() => { void HapticService.softImpact(); setSharing(true); }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.share, { borderColor: sc.textOnMastheadMuted }, pressed && styles.pressed]}
      testID="metric-detail-share"
    >
      <Ionicons name="share-outline" size={18} color={sc.textOnAccent} />
      <Text style={[styles.backText, { color: sc.textOnAccent }]}>Share</Text>
    </Pressable>
  ) : null;
  const pick = (r: Range) => {
    if (r === range) return;
    void HapticService.selection();
    setRange(r);
  };
  const shape = (height: number) => <View style={[styles.shape, { height, backgroundColor: sc.surface.forestBand }]} />;

  return (
    <Screen edges={[]} scroll={false} contentStyle={styles.column} testID="metric-detail-v2">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.masthead, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + layout.statusBarGap }]}>
          {/* A pull-down shows forest above the masthead, never a bone gap. */}
          <View style={[styles.bleed, { backgroundColor: sc.surface.masthead }]} />
          <View style={styles.top}>{back}{share}</View>
          <Overline style={{ color: sc.textOnMastheadMuted }}>Fitness</Overline>
          <Headline level="h1" style={{ color: sc.textOnAccent }}>{title}</Headline>
          {isLoading ? (
            <View style={styles.rows} accessible accessibilityLabel={`Loading ${title.toLowerCase()}`}>{shape(44)}{shape(64)}{shape(150)}</View>
          ) : failed ? null : (
            <View style={styles.rows}>
              {!online || query.isError ? (
                <View style={[styles.warm, { backgroundColor: semantic.warning.bg, borderColor: semantic.warning.border }]} testID="metric-detail-saved">
                  <Ionicons name="cloud-offline-outline" size={18} color={semantic.warning.fg} />
                  <Text style={[styles.grow, styles.body1, { color: semantic.warning.fg }]} accessibilityRole="alert">
                    {!online && <Text style={styles.strong}>{"You're offline. "}</Text>}
                    {`Showing your last synced data from ${savedAt(query.dataUpdatedAt)}.`}
                  </Text>
                </View>
              ) : null}
              <View style={styles.tabs} accessibilityRole="tablist">
                {(['week', 'month'] as const).map((r) => (
                  <Pressable key={r} onPress={() => pick(r)} accessibilityRole="tab" accessibilityState={{ selected: r === range }}
                    style={styles.tab} testID={`metric-range-${r}`}>
                    <Text style={[styles.backText, { color: r === range ? sc.textOnAccent : sc.textOnMastheadMuted }, r === range && styles.strong]}>
                      {r === 'week' ? 'Week' : 'Month'}
                    </Text>
                    {r === range ? <View style={[styles.underline, { backgroundColor: sc.data.leaf }]} /> : null}
                  </Pressable>
                ))}
              </View>
              <View accessible testID="metric-hero"
                accessibilityLabel={`Average a day, not counting today: ${average == null ? 'No sample yet' : `${amount(average)} a day`}${sub ? `. ${sub}` : ''}`}>
                <Text style={[styles.body1, { color: sc.textOnMastheadMuted }]}>Average a day, not counting today</Text>
                {average == null ? (
                  <Text style={[styles.none, { color: sc.textOnMastheadMuted }]}>No sample yet</Text>
                ) : (
                  <View style={styles.figure}>
                    <Text style={[styles.hero, { color: sc.textOnAccent }]}>{whole(average)}</Text>
                    <Text style={[styles.body1, { color: sc.textOnMastheadMuted }]}>{`${unit} a day`}</Text>
                  </View>
                )}
                {sub ? <Text style={[styles.body1, { color: sc.textOnMastheadMuted }]}>{sub}</Text> : null}
              </View>
              <WeekStepBars days={days} goal={goal} title={title} dark goalUnit={unit} height={150} reduceMotion={reduceMotion} />
            </View>
          )}
        </View>
        {isLoading ? (
          <View style={styles.body} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.card, { height: 96, borderColor: sc.border, backgroundColor: sc.data.trackLight }]} />
          </View>
        ) : failed ? (
          <View style={styles.body}>
            <QuietError layout="inline" message={loadFailureMessage(query.error, title)} retryHint={`Loads ${title.toLowerCase()} again`}
              onRetry={() => void query.refetch().then((r) => { if (r.isError) void HapticService.error(); })} testID="metric-detail-error-state" />
          </View>
        ) : (
          <View style={styles.body}>
            <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} accessible testID="metric-goal"
              accessibilityLabel={`Starter goal, ${amount(goal)}${reached ? `, ${reached}` : ''}`}>
              <Overline>Goal</Overline>
              <View style={styles.row}>
                <Text style={[styles.value, { color: sc.textPrimary }]}>Starter goal</Text>
                <Text style={[styles.value, { color: sc.textPrimary }]}>{amount(goal)}</Text>
              </View>
              {reached ? <Text style={[styles.small, { color: sc.textMuted }]}>{reached}</Text> : null}
            </View>
            {recent.length > 0 && (
              <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} testID="metric-recent">
                <View style={styles.row}>
                  <Overline accessibilityRole="header">Recent days</Overline>
                  {source ? <Text style={[styles.small, styles.grow, styles.end, { color: sc.textMuted }]}>{`From ${source}`}</Text> : null}
                </View>
                {recent.map((d, i) => {
                  const date = us(d.date, { weekday: 'short', month: 'short', day: 'numeric' });
                  return (
                    <View key={date} accessible accessibilityLabel={`${date}, ${amount(d.total)}${d.today ? ', so far' : ''}`}
                      style={[styles.row, styles.reading, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <View>
                        <Text style={[styles.small, { color: sc.textMuted }]}>{date}</Text>
                        {d.today ? <Text style={[styles.small, { color: sc.textMuted }]}>So far</Text> : null}
                      </View>
                      <Text style={[styles.value, { color: sc.textPrimary }]}>{amount(d.total)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      <ShareSheet card={sharing ? card : null} onClose={() => setSharing(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { paddingHorizontal: 0, paddingBottom: 0 },
  content: { paddingBottom: spacing['3xl'] },
  masthead: { paddingHorizontal: layout.gutter, paddingBottom: spacing.xl, gap: spacing.xs, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  bleed: { position: 'absolute', left: 0, right: 0, top: -1000, height: 1000 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: layout.touchMin },
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.touchMin, marginLeft: -spacing.xs, flexShrink: 1 },
  backText: { ...typography.bodyMd },
  share: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.touchMin, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.button },
  pressed: { opacity: 0.8 },
  rows: { gap: spacing.lg, marginTop: spacing.md },
  shape: { borderRadius: radius.card },
  warm: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: spacing.xl },
  tab: { minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center' },
  underline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: radius.chip },
  figure: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.md },
  hero: { ...typography.display, fontVariant: ['lining-nums', 'tabular-nums'] },
  none: { ...typography.h2, marginVertical: spacing.sm },
  body1: { ...typography.body },
  strong: { fontFamily: 'Inter_600SemiBold' },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  end: { textAlign: 'right' },
  body: { padding: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  reading: { minHeight: layout.touchMin, paddingVertical: spacing.sm },
  value: { ...typography.bodyMd, fontVariant: ['tabular-nums'] },
  small: { ...typography.bodySmall, fontVariant: ['tabular-nums'] },
  cardTitle: { ...typography.h2, marginTop: spacing.md },
  cardBars: { marginTop: spacing.md },
  cardFoot: { ...typography.bodySmall, marginTop: spacing.md },
});
