/**
 * HolisticInsightsTile — home-screen surface for the cross-pillar
 * holistic insights envelope.
 *
 * Renders one of three states based on `envelope.status`:
 *   - 'ok'                  — top insight text (truncated to 2 lines)
 *                             with a small "View all" affordance the
 *                             caller wires to navigation. Up to 3
 *                             insights total, but the tile shows 1.
 *   - 'insufficient_data'   — hidden.
 *   - 'finance_unavailable' — hidden.
 *
 * The tile is read-only. No mutations, no navigation prop required;
 * the caller passes an optional `onPress` to wire navigation to the
 * future full insights screen.
 *
 * Sprint B-2 wiring: home-screen integration is a follow-up commit;
 * this file ships the component itself so the home screen can import
 * it when ready.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type {
  HolisticInsight,
} from '../../api/holisticInsightsApi';
import { useHolisticInsights } from '../../hooks/useHolisticInsights';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

interface HolisticInsightsTileProps {
  /** Optional press handler. When omitted the tile renders without a CTA. */
  onPress?: () => void;
  /** Window passed to the envelope endpoint. Defaults to 90. */
  windowDays?: number;
}

export default function HolisticInsightsTile({
  onPress,
  windowDays,
}: HolisticInsightsTileProps) {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const { data, isLoading, isError } = useHolisticInsights({ windowDays });

  // Loading + error states are intentionally quiet — the tile lives on
  // a home screen and should not flash a spinner block. Render nothing
  // when loading, unavailable, or without a verified insight.
  if (isLoading || isError || !data || data.status !== 'ok' || data.insights.length === 0) return null;

  if (data.status === 'ok' && data.insights.length > 0) {
    return (
      <Tile sc={sc} styles={styles} onPress={onPress}>
        <Eyebrow sc={sc}>Holistic insights</Eyebrow>
        <TopInsight insight={data.insights[0] as HolisticInsight} sc={sc} />
        {data.insights.length > 1 ? (
          <Text style={[typography.bodySmall, { color: onPress ? sc.accentText : sc.textMuted }]}>
            {data.insights.length - 1} more
          </Text>
        ) : null}
      </Tile>
    );
  }

  return null;
}

function Tile({
  children,
  styles,
  onPress,
  sc,
}: {
  children: React.ReactNode;
  styles: Styles;
  onPress?: () => void;
  sc: SemanticTokens;
}) {
  if (onPress) {
    return (
      <TouchableOpacity
        testID="holistic-insights-tile"
        style={styles.card}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="View holistic insights"
      >
        {children}
      </TouchableOpacity>
    );
  }
  return <View testID="holistic-insights-tile" style={[styles.card, { borderColor: sc.border }]}>{children}</View>;
}

function Eyebrow({
  children,
  sc,
}: {
  children: React.ReactNode;
  sc: SemanticTokens;
}) {
  return (
    <Text style={[typography.eyebrow, { color: sc.textMuted }]}>{children}</Text>
  );
}

function TopInsight({
  insight,
  sc,
}: {
  insight: HolisticInsight;
  sc: SemanticTokens;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text
        style={[typography.body, { color: sc.textPrimary }]}
        numberOfLines={2}
      >
        {insight.text}
      </Text>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        Correlation {formatCorrelation(insight.correlation)} over {insight.weeks}{' '}
        weeks
      </Text>
    </View>
  );
}

function formatCorrelation(r: number): string {
  const sign = r >= 0 ? '+' : '-';
  return `${sign}${Math.abs(r).toFixed(2)}`;
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    // DES-K2-128: one hairline above, no box, fill or radius (A23 section).
    card: {
      paddingVertical: 18,
      marginBottom: 24,
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
  });
}
