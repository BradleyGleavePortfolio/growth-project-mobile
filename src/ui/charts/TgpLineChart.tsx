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

import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  useWindowDimensions,
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

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ChartDataPoint {
  /** Numeric x value. For time-series charts, pass epoch milliseconds. */
  x: number;
  y: number;
}

export interface TgpLineChartProps {
  data: ChartDataPoint[];
  height?: number;
  themeOverride?: Partial<ThemeColors>;
  accessibilityLabel?: string;
  /**
   * Optional formatter for x-axis tick labels and the tooltip header.
   * When omitted the raw rounded x value is rendered (back-compat).
   */
  xFormatter?: (x: number) => string;
  /** Optional layered plot; axes and touch/assistive exploration stay shared. */
  plot?: {
    domain: [number, number];
    tickStep: number;
    render: (p: { x: (v: number) => number; y: (v: number) => number; right: number; bottom: number }) => React.ReactNode;
    overlay?: (p: { x: (v: number) => number; y: (v: number) => number; right: number }) => React.ReactNode;
    describe: (index: number) => string;
    onSelect: (index: number | null) => void;
  };
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
  xFormatter,
  plot,
}: TgpLineChartProps) {
  // ThemeProvider exposes a sensible default via createContext(defaultTheme),
  // so useTheme() is always safe to call unconditionally — no try/catch needed.
  const theme = useTheme();
  const colors: ThemeColors = { ...theme.colors, ...themeOverride };

  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number; label: string } | null>(null);
  const [width, setWidth] = useState(SCREEN_WIDTH - 32);
  const selected = useRef<number | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const { fontScale } = useWindowDimensions();

  const W = width;
  const H = height;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { toSvgX, toSvgY, points, yTicks, xLabels } = useMemo(() => {
    if (data.length === 0) {
      return { minY: 0, maxY: 0, rangeY: 1, toSvgX: () => 0, toSvgY: () => 0, points: '', yTicks: [], xLabels: [] };
    }
    const ys = data.map((d) => d.y);
    const xs = data.map((d) => d.x);
    const minY = plot?.domain[0] ?? Math.min(...ys);
    const maxY = plot?.domain[1] ?? Math.max(...ys);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    const toSvgX = (x: number) => data.length === 1 ? PAD_L + plotW / 2 : PAD_L + ((x - minX) / rangeX) * plotW;
    const toSvgY = (y: number) => PAD_T + plotH - ((y - minY) / rangeY) * plotH;

    const pts = data.map((d) => `${toSvgX(d.x)},${toSvgY(d.y)}`).join(' ');
    const tickCount = plot ? Math.round(rangeY / plot.tickStep) : 3;
    const stride = plot ? Math.max(1, Math.ceil(tickCount / (fontScale >= 1.3 ? 2 : 4))) : 1;
    const yTks = Array.from({ length: tickCount + 1 }, (_, i) => minY + rangeY * i / tickCount)
      .filter((_, i) => i % stride === 0 || i === tickCount);
    const step = Math.max(1, Math.floor(data.length / 4));
    const xLbls = data.filter((_, i) => plot ? i === 0 || i === data.length - 1 : i % step === 0 || i === data.length - 1);

    return { minY, maxY, rangeY, toSvgX, toSvgY, points: pts, yTicks: yTks, xLabels: xLbls };
  }, [data, plotW, plotH, plot, fontScale]);

  const select = (index: number | null) => {
    if (selected.current === index) return;
    selected.current = index;
    setSelectedLabel(index == null ? '' : plot?.describe(index) ?? '');
    plot?.onSelect(index);
  };
  const selectAt = (px: number) => {
    if (!plot || !data.length) return;
    const target = data[0].x + Math.max(0, Math.min(1, (px - PAD_L) / plotW)) * (data[data.length - 1].x - data[0].x);
    const index = data.reduce((best, p, i) => Math.abs(p.x - target) < Math.abs(data[best].x - target) ? i : best, 0);
    select(index);
  };

  // ── Pan gesture: find nearest data point and show tooltip ──────────────────
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(plot ? 180 : 0)
    .onStart((evt) => selectAt(evt.x))
    .onUpdate((evt) => {
      if (plot) { selectAt(evt.x); return; }
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
        label: xFormatter ? xFormatter(nearest.x) : String(Math.round(nearest.x)),
      });
    })
    .onEnd(() => setTooltip(null))
    .onFinalize(() => { if (plot) select(null); });

  if (!data.length || (!plot && data.length < 2)) {
    return (
      <View
        accessible={plot ? true : undefined}
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
        accessible={plot ? true : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={plot ? 'adjustable' : 'image'}
        accessibilityValue={plot ? { text: selectedLabel || accessibilityLabel } : undefined}
        accessibilityActions={plot ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
        onAccessibilityAction={plot ? ({ nativeEvent: { actionName } }) => {
          const from = selected.current ?? data.length - 1;
          select(Math.max(0, Math.min(data.length - 1, from + (actionName === 'increment' ? 1 : -1))));
        } : undefined}
        onLayout={plot ? (e) => { if (e.nativeEvent.layout.width > 0) setWidth(e.nativeEvent.layout.width); } : undefined}
        style={{ height }}
      >
        <Svg width={W} height={H} accessible={plot ? false : undefined}>
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
              fontSize={plot ? 12 * fontScale : 9}
              fill={colors.textMuted}
            >
              {Math.round(v)}
            </SvgText>
          ))}
          {/* Line */}
          {plot ? plot.render({ x: toSvgX, y: toSvgY, right: W - PAD_R, bottom: H - PAD_B }) : <Polyline
            points={points}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />}
          {/* Dots — only when the series is small enough that per-point
              markers stay readable. Above ~30 points the dots blur into a
              solid stripe along the line and tank fps on low-end Android,
              so the line alone is the better signal. */}
          {!plot && data.length <= 30 &&
            data.map((d, i) => (
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
              textAnchor={plot ? (i === 0 ? 'start' : 'end') : 'middle'}
              fontSize={plot ? 12 * fontScale : 9}
              fill={colors.textMuted}
            >
              {xFormatter ? xFormatter(d.x) : String(Math.round(d.x))}
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
                x={Math.min(tooltip.x - 36, W - PAD_R - 72)}
                y={tooltip.y - 42}
                width={72}
                height={34}
                rx={1}
                fill={Colors.background}
                stroke={Colors.earningsAccent}
                strokeWidth={0.5}
              />
              <SvgText
                x={Math.min(tooltip.x, W - PAD_R - 36)}
                y={tooltip.y - 28}
                textAnchor="middle"
                fontSize={9}
                fill={Colors.textMuted}
              >
                {tooltip.label}
              </SvgText>
              <SvgText
                x={Math.min(tooltip.x, W - PAD_R - 36)}
                y={tooltip.y - 15}
                textAnchor="middle"
                fontSize={11}
                fill={Colors.textPrimary}
              >
                {tooltip.value.toFixed(1)}
              </SvgText>
            </>
          )}
        </Svg>
        {plot?.overlay?.({ x: toSvgX, y: toSvgY, right: W - PAD_R })}
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
