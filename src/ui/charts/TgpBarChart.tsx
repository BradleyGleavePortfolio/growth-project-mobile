/**
 * TgpBarChart — Victory Native XL bar chart wrapper.
 *
 * Renders a vertical bar chart using react-native-svg.
 * Each bar is labelled on the x-axis; the y-axis auto-scales to the max value.
 *
 * Props:
 *   data          — Array of { x: number, y: number } points.
 *                   The x value is used as the bar label (rounded integer).
 *   height        — Chart height in logical pixels (default 200).
 *   themeOverride — Partial ThemeColors to override palette tokens.
 *
 * Theming:
 *   Bar fill  → colors.primary
 *   Axis text → colors.textMuted
 *   Grid      → colors.border (hairline, dashed)
 *   Tooltip   → bone bg (#F5EFE4), ink text (#1A1A18), oxblood border (#4A0404)
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import Svg, {
  Rect,
  Line as SvgLine,
  Text as SvgText,
} from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

const FALLBACK: Partial<ThemeColors> = {
  primary:       '#2C4A36',
  surface:       '#F1E8D5',
  textPrimary:   '#1A1A18',
  textMuted:     '#B1A89F',
  border:        '#B08D57',
};

export interface ChartDataPoint {
  x: number;
  y: number;
}

export interface TgpBarChartProps {
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
const BAR_GAP = 0.2; // fraction of bar width

export default function TgpBarChart({
  data,
  height = 200,
  themeOverride,
  accessibilityLabel = 'Bar chart',
}: TgpBarChartProps) {
  let themeColors: ThemeColors;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const theme = useTheme();
    themeColors = theme.colors;
  } catch {
    themeColors = FALLBACK as ThemeColors;
  }
  const colors: ThemeColors = { ...themeColors, ...themeOverride };

  const [tooltip, setTooltip] = useState<{ bx: number; by: number; bh: number; value: number } | null>(null);

  const W = SCREEN_WIDTH - 32;
  const H = height;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { maxY, barWidth, bars, yTicks } = useMemo(() => {
    if (data.length === 0) return { maxY: 0, barWidth: 0, bars: [], yTicks: [] };
    const ys = data.map((d) => d.y);
    const maxY = Math.max(...ys) * 1.1 || 1;
    const n = data.length;
    const slotW = plotW / n;
    const bw = slotW * (1 - BAR_GAP);
    const barsArr = data.map((d, i) => {
      const bh = (d.y / maxY) * plotH;
      return {
        x: PAD_L + i * slotW + slotW * (BAR_GAP / 2),
        y: PAD_T + plotH - bh,
        width: bw,
        height: bh,
        value: d.y,
        label: String(Math.round(d.x)),
      };
    });
    const ticks = [0, 1, 2, 3].map((i) => (maxY * i) / 3);
    return { maxY, barWidth: bw, bars: barsArr, yTicks: ticks };
  }, [data, plotW, plotH]);

  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .onStart((evt) => {
      const ix = Math.floor((evt.x - PAD_L) / ((plotW) / (data.length || 1)));
      if (ix >= 0 && ix < bars.length) {
        const b = bars[ix];
        setTooltip({ bx: b.x + barWidth / 2, by: b.y, bh: b.height, value: b.value });
        setTimeout(() => setTooltip(null), 1500);
      }
    });

  if (data.length === 0) {
    return (
      <View
        style={[styles.empty, { backgroundColor: colors.surface, height }]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
      >
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No data</Text>
      </View>
    );
  }

  return (
    <GestureDetector gesture={tapGesture}>
      <View accessibilityLabel={accessibilityLabel} accessibilityRole="image" style={{ height }}>
        <Svg width={W} height={H}>
          {/* Grid */}
          {yTicks.map((v, i) => (
            <SvgLine
              key={i}
              x1={PAD_L}
              y1={PAD_T + plotH - (v / (maxY || 1)) * plotH}
              x2={W - PAD_R}
              y2={PAD_T + plotH - (v / (maxY || 1)) * plotH}
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
              y={PAD_T + plotH - (v / (maxY || 1)) * plotH + 4}
              textAnchor="end"
              fontSize={9}
              fill={colors.textMuted}
            >
              {Math.round(v)}
            </SvgText>
          ))}
          {/* Bars */}
          {bars.map((b, i) => (
            <Rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.width}
              height={Math.max(b.height, 2)}
              rx={1}
              fill={colors.primary}
              opacity={tooltip && tooltip.bx === b.x + barWidth / 2 ? 1 : 0.85}
            />
          ))}
          {/* X labels */}
          {bars.map((b, i) => (
            <SvgText
              key={i}
              x={b.x + barWidth / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={colors.textMuted}
            >
              {b.label}
            </SvgText>
          ))}
          {/* Tooltip */}
          {tooltip && (
            <>
              <Rect
                x={Math.min(tooltip.bx - 28, W - PAD_R - 56)}
                y={tooltip.by - 28}
                width={56}
                height={22}
                rx={1}
                fill="#F5EFE4"
                stroke="#4A0404"
                strokeWidth={0.5}
              />
              <SvgText
                x={Math.min(tooltip.bx, W - PAD_R - 28)}
                y={tooltip.by - 13}
                textAnchor="middle"
                fontSize={10}
                fill="#1A1A18"
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
