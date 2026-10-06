/**
 * RomanAdjustmentsSection — Roman's workout suggestions in the coach Action
 * Queue. Renders nothing while the backend kill switch is off (404), while
 * loading the first time, or when there is nothing to decide, so it never
 * adds noise to the queue.
 *
 * `refreshKey` lets the host screen's pull-to-refresh reload this section.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../../theme/tokens';
import { listAdjustments, type RomanAdjustment } from '../../../api/romanAdjustApi';
import RomanAdjustmentCard, { type RomanAdjustDeps } from './RomanAdjustmentCard';
import { adjustErrorView } from './romanAdjustCopy';

export interface RomanAdjustmentsSectionProps {
  refreshKey?: number;
  load?: typeof listAdjustments;
  deps?: Partial<RomanAdjustDeps>;
}

export default function RomanAdjustmentsSection({ refreshKey = 0, load = listAdjustments, deps }: RomanAdjustmentsSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<RomanAdjustment[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A suggestion that settled elsewhere leaves its reason here after the card goes.
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    load()
      .then((res) => {
        if (!alive) return;
        setEnabled(res.enabled);
        setItems(res.proposals);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setEnabled(true);
        setError(adjustErrorView(err, 'load').message);
      });
    return () => {
      alive = false;
    };
  }, [load, refreshKey, tick]);

  if (!enabled) return null;
  if (!error && !notice && items.length === 0) return null;

  return (
    <View style={styles.section} testID="roman-adjust-section">
      <Text style={styles.heading} accessibilityRole="header">
        Suggestions from Roman
      </Text>
      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error} accessibilityRole="alert" testID="roman-adjust-section-error">
            {error}
          </Text>
          <Pressable onPress={reload} accessibilityRole="button" style={styles.retry} testID="roman-adjust-section-retry">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="roman-adjust-section-notice">
          {notice}
        </Text>
      ) : null}
      {items.map((p) => (
        <RomanAdjustmentCard
          key={p.id}
          proposal={p}
          deps={deps}
          testID={`roman-adjust-card-${p.id}`}
          onChanged={(next) => setItems((list) => list.map((x) => (x.id === next.id ? next : x)))}
          onSettled={(id, { refresh, notice: why }) => {
            setItems((list) => list.filter((x) => x.id !== id));
            setNotice(why ?? null);
            if (refresh) reload();
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  heading: { ...typography.eyebrow, color: colors.charcoal, marginBottom: spacing.sm },
  errorRow: { gap: spacing.sm, marginBottom: spacing.md },
  error: { ...typography.bodySmall, color: colors.charcoal },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  retryText: { ...typography.bodySmall, color: colors.forest },
});
