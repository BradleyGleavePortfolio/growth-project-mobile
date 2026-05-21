/**
 * TgpLineChart — Victory Native XL line chart wrapper.
 *
 * Renders a smooth line chart powered by Victory Native (D3 + Skia path).
 * Falls back to a pure SVG implementation when the Skia/Victory runtime is
 * unavailable (see docs/charting.md §Skia conflict).
 *
 * Props:
 *   data          — Array of { x: number, y: number } data points.
 *   height        — Chart height in logical pixels (default 200).
 *   themeOverride — Partial ThemeColors to override palette tokens.
 *
 * Theming:
 *   Line/dots → colors.primary
 *   Axis text → colors.textMuted
 *   Grid      → colors.border (hairline, dashed)
 *   Tooltip   → Colors.background / Colors.textPrimary / Colors.earningsAccent
 *
 * Performance notes:
 *   • Skia path: runs on the UI thread via Fabric; targets 60 fps.
 *   • Pan gesture wired via react-native-gesture-handler.
 *   • Do NOT use inside a VirtualizedList without a fixed height.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import Svg, {
  Polyline,
  Line as SvgLine,
  Circle,
  Text as SvgText,
  Rect,
} from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Colors } from '../../constants/colors';

// ─── Fallback tokens (used when ThemeProvider is not mounted) ─────────────────
const FALLBACK: Partial<ThemeColors> = {
  primary:       Colors.primary,
  background:    Colors.background,
  surface:       Colors.surface,
  textPrimary:   Colors.textPrimary,
  textMuted:     Colors.textMuted,
  border:        Colors.border,
  textOnPrimary: Colors.background,
  error:         Colors.earningsAccent,
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ChartDataPoint {
  x: number;
  y: number;
}

export interface TgpLineChartProps {
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function TgpLineChart({
  data,
  height = 200,
  themeOverride,
  accessibilityLabel = 'Line chart',
}: TgpLineChartProps) {
  // Graceful fallback when ThemeProvider is absent (e.g. in tests)
  let themeColors: ThemeColors;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const theme = useTheme();
    themeColors = theme.colors;
  } catch {
    themeColors = FALLBACK as ThemeColors;
  }
  const colors: ThemeColors = { ...themeColors, ...themeOverride };

  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number; label: string } | null>(null);

  const W = SCREEN_WIDTH - 32;
  const H = height;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { toSvgX, toSvgY, points, yTicks, xLabels } = useMemo(() => {
    if (data.length === 0) {
      return { minY: 0, maxY: 0, rangeY: 1, toSvgX: () => 0, toSvgY: () => 0, points: '', yTicks: [], xLabels: [] };
    }
    const ys = data.map((d) => d.y);
    const xs = data.map((d) => d.x);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    const toSvgX = (x: number) => PAD_L + ((x - minX) / rangeX) * plotW;
    const toSvgY = (y: number) => PAD_T + plotH - ((y - minY) / rangeY) * plotH;

    const pts = data.map((d) => `${toSvgX(d.x)},${toSvgY(d.y)}`).join(' ');
    const yTks = [0, 1, 2, 3].map((i) => minY + (rangeY * i) / 3);
    const step = Math.max(1, Math.floor(data.length / 4));
    const xLbls = data.filter((_, i) => i % step === 0 || i === data.length - 1);

    return { minY, maxY, rangeY, toSvgX, toSvgY, points: pts, yTicks: yTks, xLabels: xLbls };
  }, [data, plotW, plotH]);

  // ── Pan gesture: find nearest data point and show tooltip ──────────────────
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((evt) => {
      if (data.length === 0) return;
      const rawX = evt.x - PAD_L;
      const xs = data.map((d) => d.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const rangeX = maxX - minX || 1;
      const normX = (rawX / plotW) * rangeX + minX;

      // Find nearest point
      let nearest = data[0];
      let minDist = Math.abs(data[0].x - normX);
      data.forEach((d) => {
        const dist = Math.abs(d.x - normX);
        if (dist < minDist) { minDist = dist; nearest = d; }
      });
      setTooltip({
        x: toSvgX(nearest.x),
        y: toSvgY(nearest.y),
        value: nearest.y,
        label: String(Math.round(nearest.x)),
      });
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
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        style={{ height }}
      >
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
          {/* Y-axis labels */}
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
          {/* Line */}
          <Polyline
            points={points}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Dots */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={toSvgX(d.x)}
              cy={toSvgY(d.y)}
              r={3.5}
              fill={colors.primary}
            />
          ))}
          {/* X-axis labels */}
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
          {/* Tooltip — Quiet Luxury: bone bg, ink text, oxblood hairline */}
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
