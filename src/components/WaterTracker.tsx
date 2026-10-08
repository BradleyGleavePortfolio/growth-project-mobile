import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_SETTINGS, useSettings } from '../hooks/useSettings';
import { useTheme } from '../theme/useTheme';
import { QuietText as Text } from '../ui/progress/QuietBar';

interface WaterTrackerProps {
  currentOz: number;
  targetOz?: number;
  onAdd: (oz: number) => void;
}

const WATER_AMOUNTS = [8, 12, 16];
const METRIC_WATER_AMOUNTS = [250, 350, 500];
const ML_PER_OZ = 29.5735;

export default function WaterTracker({
  currentOz,
  targetOz: targetOzProp,
  onAdd,
}: WaterTrackerProps) {
  const { settings } = useSettings();
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const targetOz = targetOzProp ?? settings.waterGoalOz;
  const isStarterGoal = targetOzProp == null && targetOz === DEFAULT_SETTINGS.waterGoalOz;
  const metric = settings.unit === 'kg';
  const unit = metric ? 'ml' : 'oz';
  const spokenUnit = metric ? 'milliliters' : 'ounces';
  const current = metric ? Math.round(currentOz * ML_PER_OZ) : currentOz;
  const target = metric ? Math.round(targetOz * ML_PER_OZ) : targetOz;
  const amounts = metric ? METRIC_WATER_AMOUNTS : WATER_AMOUNTS;
  const progress = Math.min(currentOz / targetOz, 1);
  const glasses = Math.floor(currentOz / 8);
  const glassSize = metric ? `about ${Math.round(8 * ML_PER_OZ)} ml` : '8 oz';
  // Day reads round to ounces in the store; converted ml totals are approximate.
  const progressText = `${metric ? 'About ' : ''}${current} of ${target} ${spokenUnit}${isStarterGoal ? ', starter goal' : ''}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="water-outline" size={20} color={sc.accent} />
          <Text style={styles.title}>Water</Text>
        </View>
        <Text style={styles.total}>
          {metric ? '≈ ' : ''}{current} / {target} {unit}
        </Text>
      </View>
      {isStarterGoal && <Text style={styles.goalLabel}>Starter goal</Text>}

      <View
        style={styles.progressTrack}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Water progress"
        accessibilityValue={{ min: 0, max: target, now: current, text: progressText }}
      >
        <View
          style={[styles.progressFill, { width: `${progress * 100}%` }]}
        />
      </View>

      <View style={styles.buttonRow}>
        {amounts.map((amount) => (
          <TouchableOpacity
            key={amount}
            style={styles.addButton}
            onPress={() => onAdd(metric ? amount / ML_PER_OZ : amount)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Add ${amount} ${spokenUnit} of water`}
          >
            <Text style={styles.addButtonText}>+{amount}{metric ? ' ml' : 'oz'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.glasses}>
        {glasses === 1 ? `1 glass (${glassSize})` : `${glasses} glasses (${glassSize} each)`}
      </Text>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingVertical: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: sc.textPrimary,
  },
  total: {
    fontSize: 13,
    fontWeight: '600',
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  goalLabel: {
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'right',
  },
  progressTrack: {
    height: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: sc.accent,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addButton: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: sc.accent,
    fontVariant: ['tabular-nums'],
  },
  glasses: {
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
