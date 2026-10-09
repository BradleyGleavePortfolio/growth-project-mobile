/**
 * WeightTrendChart — the calm static weight line the shipped build shows
 * (romanFirstPaymentBodyweightPolish is off). Drawn like the Workout volume
 * chart in progress-details/luxury.jpg: dashed hairline guides, muted tabular
 * axis labels, one ink line, the latest point marked. No box, no animation.
 */
import React, { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { formatWeight } from './progressFormat';

export interface WeightPoint {
  x: number; // epoch ms of the logged day
  y: number; // pounds
}

const AXIS_WIDTH = 36;
const PAD = 6;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

export default function WeightTrendChart({
  data,
  height = 168,
  testID,
}: {
  data: WeightPoint[];
  height?: number;
  testID?: string;
}): React.ReactElement | null {
  const { semanticColors: sc } = useTheme();
  // Measured width; the first frame assumes the 24 pt page gutters.
  const [width, setWidth] = useState(Dimensions.get('window').width - 48);
  const plotWidth = Math.max(width - AXIS_WIDTH, 0);

  const chart = useMemo(() => {
    if (data.length < 2 || plotWidth <= 0) return null;
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    // Whole-pound bounds with a little air so a flat line is not glued to an edge.
    const lo = Math.floor(Math.min(...ys) - 1);
    const hi = Math.ceil(Math.max(...ys) + 1);
    const spanX = maxX - minX || 1;
    const spanY = hi - lo || 1;
    const innerW = plotWidth - PAD * 2;
    const innerH = height - PAD * 2;
    const pts = data.map((d) => ({
      cx: PAD + ((d.x - minX) / spanX) * innerW,
      cy: PAD + (1 - (d.y - lo) / spanY) * innerH,
    }));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(2)},${p.cy.toFixed(2)}`).join(' ');
    const guides = [0, 0.5, 1].map((f) => ({ y: PAD + f * innerH, label: formatWeight(hi - f * spanY) }));
    return { path, last: pts[pts.length - 1], guides, firstDay: shortDay(minX), lastDay: shortDay(maxX) };
  }, [data, height, plotWidth]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  if (!chart) return <View onLayout={onLayout} />;
  const first = data[0].y;
  const last = data[data.length - 1].y;

  return (
    <View onLayout={onLayout}>
      <View style={styles.plotRow}>
        <View style={[styles.axis, { height }]}>
          {chart.guides.map((g) => (
            <Text key={g.y} style={[styles.axisLabel, styles.tick, { color: sc.textMuted, top: g.y - 9 }]}>{g.label}</Text>
          ))}
        </View>
        <Svg
          width={plotWidth}
          height={height}
          testID={testID}
          accessibilityRole="image"
          accessibilityLabel={`Weight trend line chart, ${formatWeight(first)} to ${formatWeight(last)} pounds`}
        >
          {chart.guides.map((g) => (
            <Line key={g.y} x1={0} x2={plotWidth} y1={g.y} y2={g.y} stroke={sc.border} strokeWidth={1} strokeDasharray="3 4" />
          ))}
          <Path d={chart.path} stroke={sc.textPrimary} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={chart.last.cx} cy={chart.last.cy} r={3.5} fill={sc.accent} />
        </Svg>
      </View>
      <View style={[styles.days, { marginLeft: AXIS_WIDTH }]}>
        <Text style={[styles.axisLabel, { color: sc.textMuted }]}>{chart.firstDay}</Text>
        <Text style={[styles.axisLabel, { color: sc.textMuted }]}>{chart.lastDay}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plotRow: { flexDirection: 'row' },
  axis: { width: AXIS_WIDTH },
  axisLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  tick: { position: 'absolute', left: 0 },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
