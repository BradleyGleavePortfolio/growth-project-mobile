/** C8 v2 focus/explore layer. Receives caller-authorized history, never fetches. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import TgpLineChart from '../../ui/charts/TgpLineChart';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, radius, typography } from '../../theme/tokens';
import { useReduceMotion } from '../../screens/client/wearables/components/useReduceMotion';
import { weightDomain, weightPeriod, weightSegments, weightTrend, type WeightPeriod, type WeightSample } from './weightTrend';

export interface WeightTrendDarkProps {
  data: WeightSample[];
  period?: WeightPeriod;
  overview?: boolean;
  goal?: { value: number; coachName?: string };
  through?: number;
  height?: number;
  testID?: string;
}
const date = (x: number) => new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const pounds = (n: number) => n.toFixed(1);

export default function WeightTrendChartDark({
  data, period = 'All', overview = false, goal, through = Date.now(), height = 248, testID,
}: WeightTrendDarkProps) {
  const { semanticColors: sc } = useTheme();
  const days = useMemo(() => weightPeriod(weightTrend(data, through), period), [data, through, period]);
  const last = days[days.length - 1];
  const first = days[0];
  const showGoal = goal != null && (overview || period !== '7D');
  const band = !overview && !!last && last.count > 1;
  const goalLabel = showGoal ? goal.coachName
    ? `Goal ${goal.value} lb, set with ${goal.coachName}` : `Your goal ${goal.value} lb` : '';
  const [selectedX, setSelectedX] = useState<number | null>(null);
  const selected = days.find((p) => p.x === selectedX);
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    setSelectedX(null);
    opacity.setValue(reduceMotion ? 1 : 0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true });
    if (!reduceMotion) animation.start();
    return () => animation.stop();
  }, [period, reduceMotion, opacity]);
  if (!last) return <View testID={testID} />;
  const range = `Usual range today: ${pounds(last.low)} to ${pounds(last.high)} lb`;
  const heading = period === '7D' ? 'Weight trend this week' : period === '30D'
    ? 'Weight trend for 30 days' : `Weight trend since ${date(data.length ? Math.min(...data.map((p) => p.x)) : first.x)}`;
  const delta = last.y - first.y;
  const change = `${delta < 0 ? 'Down' : 'Up'} ${pounds(Math.abs(delta))} lb`;
  const lastReading = [...days].reverse().find((p) => p.weight != null)
    ?? weightTrend(data, through).filter((p) => p.weight != null).pop();
  const missed = last.gap && last.weight == null;
  const label = last.count === 1
    ? `First weigh-in, ${pounds(last.y)} lb, ${date(lastReading?.x ?? first.x)}. This is your starting point.`
    : `${heading}, now ${pounds(last.y)} lb, ${change}.${band ? ` ${range}.` : ''}${showGoal ? ` ${goalLabel}.` : ''}`;
  const describe = (index: number) => {
    const p = days[index];
    return `${date(p.x)}, Trend ${pounds(p.y)}, ${p.weight == null ? 'No weigh-ins.' : `Weigh-in ${pounds(p.weight)} lb${p.pending ? ', on this phone' : ''}.`}`;
  };
  const text = { color: sc.textOnMastheadMuted };
  const legend: Array<[string, string, 'line' | 'dot' | 'band' | 'dash']> = [
    ['Trend', sc.data.trend, 'line'], ['Weigh-in', sc.data.weighIn, 'dot'],
    ...(band ? [['Usual range', sc.data.range, 'band'] as [string, string, 'band']] : []),
    ...(days.some((p) => p.gap) ? [['No weigh-ins.', sc.data.trend, 'dash'] as [string, string, 'dash']] : []),
  ];
  return (
    <View style={{ backgroundColor: sc.bgPrimary }}>
    <View testID={testID} style={{ backgroundColor: sc.surface.masthead, paddingHorizontal: 24, paddingBottom: 16 }}>
      <Animated.View style={{ opacity }}>
        <TgpLineChart key={period} data={days} height={height} accessibilityLabel={label} xFormatter={date}
          themeOverride={{ primary: sc.data.trend, textMuted: sc.textOnMastheadMuted, border: sc.surface.forestBand }}
          plot={{
            domain: weightDomain(days, period === '7D' && !overview ? 1 : 2, band, showGoal ? goal.value : undefined),
            tickStep: period === '7D' && !overview ? 1 : 2,
            describe,
            onSelect: (index) => {
              setSelectedX(index == null ? null : days[index].x);
              if (index != null) void HapticService.selection();
            },
            overlay: ({ x, y, right }) => <>
              {showGoal && <View pointerEvents="none" style={{ position: 'absolute', left: 44, right: 16, top: y(goal.value) + 4, backgroundColor: sc.surface.masthead }}>
                <Text testID="weight-goal-label" style={[styles.caption, { color: sc.data.goal }]}>{goalLabel}</Text>
              </View>}
              {selected && <View pointerEvents="none" testID="weight-touch-chip" style={[styles.chip, {
                backgroundColor: sc.textOnAccent, position: 'absolute', top: 0,
                width: Math.min(212, right - 44), left: Math.max(44, Math.min(x(selected.x) - 106, right - Math.min(212, right - 44))),
              }]}><Text style={[styles.caption, { color: colors.ink }]}>{describe(days.indexOf(selected))}</Text></View>}
            </>,
            render: ({ x, y, right, bottom }) => (
              <>
                {band && <Path testID="weight-usual-band" fill={sc.data.range}
                  d={`${days.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.high)}`).join(' ')} ${[...days].reverse().map((p) => `L${x(p.x)},${y(p.low)}`).join(' ')} Z`} />}
                {showGoal && <Line testID="weight-goal-line" x1={x(first.x)} x2={right}
                  y1={y(goal.value)} y2={y(goal.value)} stroke={sc.data.goal} strokeWidth={1.5} strokeDasharray="5 5" />}
                {weightSegments(days).map((run, i) => <Path key={i} testID={run.gap ? 'weight-gap' : 'weight-segment'}
                  d={run.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join(' ')} fill="none"
                  stroke={sc.data.trend} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={run.gap ? '4 4' : undefined} />)}
                {days.filter((p) => p.weight != null).map((p) => <Circle key={p.x} testID={p.pending ? 'weight-pending' : 'weight-reading'}
                  cx={x(p.x)} cy={y(p.weight!)} r={p.pending ? 5 : 2.5} fill={p.pending ? 'none' : sc.data.weighIn}
                  stroke={p.pending ? sc.data.pending : 'none'} strokeWidth={1.5} strokeDasharray={p.pending ? '3 2.4' : undefined} />)}
                {last.count > 1 && <Circle testID="weight-latest" cx={x(last.x)} cy={y(last.y)} r={5}
                  fill={missed ? sc.surface.masthead : sc.data.trend}
                  stroke={missed ? sc.data.trend : sc.textOnAccent} strokeWidth={1.5} />}
                {selected && <Line testID="weight-cursor" x1={x(selected.x)} x2={x(selected.x)} y1={16} y2={bottom}
                  stroke={sc.data.weighIn} strokeWidth={1} />}
              </>
            ),
          }} />
      </Animated.View>
      {last.count === 1 ? <Text style={[styles.caption, text]}>The trend line starts at your second weigh-in.</Text> : <>
        {!overview && <View style={styles.legend}>{legend.map(([name, color, kind]) => <View key={name} style={styles.key}>
          <Svg width={20} height={12} accessible={false}>
            {kind === 'dot' ? <Circle cx={10} cy={6} r={2.5} fill={color} /> :
              <Line x1={0} x2={20} y1={6} y2={6} stroke={color} strokeWidth={kind === 'band' ? 8 : 2}
                strokeDasharray={kind === 'dash' ? '3 3' : undefined} />}
          </Svg><Text style={[styles.caption, text]}>{name}</Text>
        </View>)}</View>}
        {band && <Text style={[styles.caption, text]}>{range}</Text>}
        {missed && lastReading && <Text style={[styles.caption, text]}>No weigh-ins since {date(lastReading.x)}. Your trend is kept where it was.</Text>}
        {!overview && <Text style={[styles.caption, text]}>Touch and hold the chart to read any day.</Text>}
      </>}
    </View>
    {!overview && <Text style={[styles.caption, { color: sc.textPrimary, padding: 24 }]}>
      Each weigh-in moves your trend a tenth of the way toward it, so one high or low morning barely moves the line. The band is your usual day-to-day range.
    </Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  caption: { ...typography.body, fontSize: 13, lineHeight: 20, letterSpacing: 0, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { borderRadius: radius.button, padding: 10, marginBottom: 12 },
});
