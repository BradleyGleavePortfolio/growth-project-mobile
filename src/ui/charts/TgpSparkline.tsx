/**
 * TgpSparkline — Inline micro-chart for card surfaces.
 *
 * A compact, label-free line sparkline designed to sit inside a stat card or
 * list row. No axes, no grid lines, no tooltips — purely visual momentum cue.
 *
 * Props:
 *   data          — Array of { x: number, y: number } data points.
 *   width         — Spark width in px (default 80).
 *   height        — Spark height in px (default 32).
 *   color         — Override stroke color (falls back to colors.primary).
 *   themeOverride — Partial ThemeColors to override palette tokens.
 *
 * Usage example (inside a card):
 *   <TgpSparkline data={weeklySteps} width={80} height={32} />
 *
 * See docs/charting.md §Sparkline for usage rules.
 */

import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Path } from 'react-native-svg';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

const FALLBACK: Partial<ThemeColors> = {
  primary:     '#2C4A36',
  primaryPale: '#D6E4DA',
};

export interface ChartDataPoint {
  x: number;
  y: number;
}

export interface TgpSparklineProps {
  data: ChartDataPoint[];
  width?: number;
  height?: number;
  color?: string;
  themeOverride?: Partial<ThemeColors>;
  accessibilityLabel?: string;
}

export default function TgpSparkline({
  data,
  width = 80,
  height = 32,
  color,
  themeOverride,
  accessibilityLabel = 'Trend sparkline',
}: TgpSparklineProps) {
  let themeColors: ThemeColors;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const theme = useTheme();
    themeColors = theme.colors;
  } catch {
    themeColors = FALLBACK as ThemeColors;
  }
  const colors: ThemeColors = { ...themeColors, ...themeOverride };
  const strokeColor = color ?? colors.primary;
  const areaColor = colors.primaryPale || '#D6E4DA';

  const { linePts, areaPath } = useMemo(() => {
    if (data.length < 2) return { linePts: '', areaPath: '' };
    const ys = data.map((d) => d.y);
    const xs = data.map((d) => d.x);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    const toX = (x: number) => ((x - minX) / rangeX) * width;
    const toY = (y: number) => height - ((y - minY) / rangeY) * height;

    const pts = data.map((d) => `${toX(d.x)},${toY(d.y)}`).join(' ');
    const first = data[0];
    const last = data[data.length - 1];
    let d = `M ${toX(first.x)},${height}`;
    d += ` L ${toX(first.x)},${toY(first.y)}`;
    data.forEach((pt) => { d += ` L ${toX(pt.x)},${toY(pt.y)}`; });
    d += ` L ${toX(last.x)},${height} Z`;

    return { linePts: pts, areaPath: d };
  }, [data, width, height]);

  if (data.length < 2) {
    return <View style={{ width, height }} accessibilityLabel={accessibilityLabel} />;
  }

  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="image">
      <Svg width={width} height={height}>
        <Path d={areaPath} fill={areaColor} fillOpacity={0.35} />
        <Polyline
          points={linePts}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
