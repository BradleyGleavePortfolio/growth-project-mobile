/**
 * WearablePromptSourcePill — a small coach-only audit chip showing WHICH real
 * wearable sample drove a generated coaching prompt (the metric key + observed
 * value). This is the source-attribution surface required so a coach can see
 * the prompt is grounded in the client's actual opted-in data, not a guess.
 *
 * COACH-ONLY: this is rendered inside the coach prompts surface only. It shows
 * the metric and its numeric value (a value the coach is already entitled to
 * see via the client's consent grant) — never on any client-visible screen.
 *
 * Tokens only (no raw hex), line Ionicons only (no emoji), fontWeight <= '600'.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import type { PromptSourceView } from '../../api/communityWearablePromptsApi';

/** Human-readable labels for the allowlisted metric keys. */
const METRIC_LABELS: Record<string, string> = {
  HRV_MS: 'HRV',
  RECOVERY_SCORE: 'Recovery',
  READINESS_SCORE: 'Readiness',
  SLEEP_EFFICIENCY_PCT: 'Sleep efficiency',
  SLEEP_TOTAL_MIN: 'Sleep',
  RESTING_HEART_RATE_BPM: 'Resting HR',
};

/** Short unit suffix per metric key (empty when the value is unitless/score). */
const METRIC_UNITS: Record<string, string> = {
  HRV_MS: ' ms',
  SLEEP_EFFICIENCY_PCT: '%',
  SLEEP_TOTAL_MIN: ' min',
  RESTING_HEART_RATE_BPM: ' bpm',
};

export function formatMetricLabel(metricKey: string): string {
  return METRIC_LABELS[metricKey] ?? metricKey;
}

export function formatObservedValue(source: PromptSourceView): string {
  const unit = METRIC_UNITS[source.metricKey] ?? '';
  const rounded = Math.round(source.observedValue * 10) / 10;
  return `${rounded}${unit}`;
}

export interface WearablePromptSourcePillProps {
  source: PromptSourceView;
  testID?: string;
}

export default function WearablePromptSourcePill({
  source,
  testID,
}: WearablePromptSourcePillProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const label = formatMetricLabel(source.metricKey);
  const value = formatObservedValue(source);

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: semanticColors.bgPrimary,
          borderColor: semanticColors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Source: ${label} ${value}`}
      testID={testID ?? `wearable-prompt-source-${source.sampleId}`}
    >
      <Text style={[styles.label, { color: semanticColors.textMuted }]}>
        {label}
      </Text>
      <Text style={[styles.value, { color: semanticColors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
  },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  value: { fontSize: 12 },
});
