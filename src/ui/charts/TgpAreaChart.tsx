/**
 * TgpAreaChart — Victory Native XL area chart wrapper.
 *
 * Renders a filled area chart (line + shaded region under the curve).
 * Supports pan gesture for interactive cross-hair tooltip.
 *
 * Props:
 *   data          — Array of { x: number, y: number } data points.
 *   height        — Chart height in logical pixels (default 200).
 *   themeOverride — Partial ThemeColors to override palette tokens.
 *
 * Theming:
 *   Line stroke  → colors.primary
 *   Area fill    → colors.primaryPale (semi-transparent)
 *   Tooltip      → bone bg (#F5EFE4), ink text (#1A1A18), oxblood border (#4A0404)
 *
 * Performance:
 *   SVG path rendered via react-native-svg; runs synchronously on the JS thread.
 *   For Skia GPU acceleration, see docs/charting.md §Skia upgrade path.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import Svg, {
  Path,
  Polyline,
  Line as SvgLine,
  Circle,
  Text as SvgText,
  Rect,
} from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Colors } from '../../constants/colors';

const FALLBACK: Partial<ThemeColors> = {
  primary:     Colors.primary,
  primaryPale: Colors.primaryPale,
  surface:     Colors.surface,
  textMuted:   Colors.textMuted,
  border:      Colors.border,
};

export interface ChartDataPoint {
  x: number;
  y: number;
}

export interface TgpAreaChartProps {
  data: ChartDataPoint[];
  height?: number;
  themeOverride?: Partial<ThemeColors>;
  accessibilityLabel?: string;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 32;

export default function TgpAreaChart({
  data,
  height = 200,
  themeOverride,
  accessibilityLabel = 'Area chart',
}: TgpAreaChartProps) {
  let themeColors: ThemeColors;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const theme = useTheme();
    themeColors = theme.colors;
  } catch {
    themeColors = FALLBACK as ThemeColors;
  }
  const colors: ThemeColors = { ...themeColors, ...themeOverride };

  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number } | null>(null);

  const W = SCREEN_WIDTH - 32;
  const H = height;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { toSvgX, toSvgY, linePts, areaPath, yTicks, xLabels } = useMemo(() => {
    if (data.length === 0) {
      return { toSvgX: () => 0, toSvgY: () => 0, linePts: '', areaPath: '', yTicks: [], xLabels: [] };
    }
    const ys = data.map((d) => d.y);
    const xs = data.map((d) => d.x);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    const toX = (x: number) => PAD_L + ((x - minX) / rangeX) * plotW;
    const toY = (y: number) => PAD_T + plotH - ((y - minY) / rangeY) * plotH;

    const pts = data.map((d) => `${toX(d.x)},${toY(d.y)}`).join(' ');

    // Build filled area path: line across, then down to baseline, back to start
    const first = data[0];
    const last = data[data.length - 1];
    const baseline = PAD_T + plotH;
    let d = `M ${toX(first.x)},${baseline}`;
    d += ` L ${toX(first.x)},${toY(first.y)}`;
    data.forEach((pt) => {
      d += ` L ${toX(pt.x)},${toY(pt.y)}`;
    });
    d += ` L ${toX(last.x)},${baseline} Z`;

    const ticks = [0, 1, 2, 3].map((i) => minY + (rangeY * i) / 3);
    const step = Math.max(1, Math.floor(data.length / 4));
    const xLbls = data.filter((_, i) => i % step === 0 || i === data.length - 1);

    return { toSvgX: toX, toSvgY: toY, linePts: pts, areaPath: d, yTicks: ticks, xLabels: xLbls };
  }, [data, plotW, plotH]);

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((evt) => {
      if (data.length === 0) return;
      const xs = data.map((d) => d.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const rangeX = maxX - minX || 1;
      const normX = ((evt.x - PAD_L) / plotW) * rangeX + minX;
      let nearest = data[0];
      let minDist = Math.abs(data[0].x - normX);
      data.forEach((d) => {
        const dist = Math.abs(d.x - normX);
        if (dist < minDist) { minDist = dist; nearest = d; }
      });
      setTooltip({ x: toSvgX(nearest.x), y: toSvgY(nearest.y), value: nearest.y });
    })
    .onEnd(() => setTooltip(null));

  if (data.length < 2) {
    return (
      <View
        style={[styles.empty, { backgroundColor: colors.surface, height }]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
      >
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          Not enough data points
        </Text>
      </View>
    );
  }

  return (
    <GestureDetector gesture={panGesture}>
      <View accessibilityLabel={accessibilityLabel} accessibilityRole="image" style={{ height }}>
        <Svg width={W} height={H}>
          {/* Grid lines */}
          {yTicks.map((v, i) => (
            <SvgLine
              key={i}
              x1={PAD_L}
              y1={toSvgY(v)}
              x2={W - PAD_R}
              y2={toSvgY(v)}
              stroke={colors.border}
              strokeWidth={0.5}
              strokeDasharray="4,4"
            />
          ))}
          {/* Y labels */}
          {yTicks.map((v, i) => (
            <SvgText
              key={i}
              x={PAD_L - 6}
              y={toSvgY(v) + 4}
              textAnchor="end"
              fontSize={9}
              fill={colors.textMuted}
            >
              {Math.round(v)}
            </SvgText>
          ))}
          {/* Filled area */}
          <Path
            d={areaPath}
            fill={colors.primaryPale || Colors.primaryPale}
            fillOpacity={0.5}
          />
          {/* Line */}
          <Polyline
            points={linePts}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Dots at data points */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={toSvgX(d.x)}
              cy={toSvgY(d.y)}
              r={3}
              fill={colors.primary}
            />
          ))}
          {/* X labels */}
          {xLabels.map((d, i) => (
            <SvgText
              key={i}
              x={toSvgX(d.x)}
              y={H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={colors.textMuted}
            >
              {String(Math.round(d.x))}
            </SvgText>
          ))}
          {/* Tooltip */}
          {tooltip && (
            <>
              <SvgLine
                x1={tooltip.x}
                y1={PAD_T}
                x2={tooltip.x}
                y2={H - PAD_B}
                stroke={colors.primary}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Circle cx={tooltip.x} cy={tooltip.y} r={5} fill={colors.primary} />
              <Rect
                x={Math.min(tooltip.x - 28, W - PAD_R - 56)}
                y={tooltip.y - 30}
                width={56}
                height={22}
                rx={1}
                fill={Colors.background}
                stroke={Colors.earningsAccent}
                strokeWidth={0.5}
              />
              <SvgText
                x={Math.min(tooltip.x, W - PAD_R - 28)}
                y={tooltip.y - 15}
                textAnchor="middle"
                fontSize={10}
                fill={Colors.textPrimary}
              >
                {tooltip.value.toFixed(1)}
              </SvgText>
            </>
          )}
        </Svg>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },
});
