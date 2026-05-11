/**
 * HolisticInsightsTile — home-screen surface for the cross-pillar
 * holistic insights envelope.
 *
 * Renders one of three states based on `envelope.status`:
 *   - 'ok'                  — top insight text (truncated to 2 lines)
 *                             with a small "View all" affordance the
 *                             caller wires to navigation. Up to 3
 *                             insights total, but the tile shows 1.
 *   - 'insufficient_data'   — honest empty-state copy from envelope.notes
 *                             (or a built-in fallback).
 *   - 'finance_unavailable' — same as above but using the finance-
 *                             specific copy from the backend.
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
  HolisticInsightsEnvelope,
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
  // while loading; render a low-key message on error.
  if (isLoading) return null;
  if (isError || !data) {
    return (
      <Tile sc={sc} styles={styles} onPress={onPress}>
        <Eyebrow sc={sc}>Holistic insights</Eyebrow>
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Insights are temporarily unavailable.
        </Text>
      </Tile>
    );
  }

  if (data.status === 'ok' && data.insights.length > 0) {
    return (
      <Tile sc={sc} styles={styles} onPress={onPress}>
        <Eyebrow sc={sc}>Holistic insights</Eyebrow>
        <TopInsight insight={data.insights[0] as HolisticInsight} sc={sc} />
        {data.insights.length > 1 ? (
          <Text style={[typography.bodySmall, { color: sc.accent }]}>
            {data.insights.length - 1} more
          </Text>
        ) : null}
      </Tile>
    );
  }

  return (
    <Tile sc={sc} styles={styles} onPress={onPress}>
      <Eyebrow sc={sc}>Holistic insights</Eyebrow>
      <EmptyNote envelope={data} sc={sc} />
    </Tile>
  );
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
  return <View style={[styles.card, { borderColor: sc.border }]}>{children}</View>;
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

function EmptyNote({
  envelope,
  sc,
}: {
  envelope: HolisticInsightsEnvelope;
  sc: SemanticTokens;
}) {
  const note =
    envelope.notes[0] ??
    (envelope.status === 'finance_unavailable'
      ? 'Your finance pillar is not connected yet.'
      : 'Keep logging — patterns will appear here as they emerge.');
  return (
    <Text style={[typography.body, { color: sc.textMuted }]} numberOfLines={3}>
      {note}
    </Text>
  );
}

function formatCorrelation(r: number): string {
  const sign = r >= 0 ? '+' : '-';
  return `${sign}${Math.abs(r).toFixed(2)}`;
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
  });
}
