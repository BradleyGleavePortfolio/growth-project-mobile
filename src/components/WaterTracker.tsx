import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useSettings } from '../hooks/useSettings';
import { useTheme } from '../theme/useTheme';
import { QuietText as Text } from '../ui/progress/QuietBar';

interface WaterTrackerProps {
  currentOz: number;
  targetOz?: number;
  onAdd: (oz: number) => void;
}

const WATER_AMOUNTS = [8, 12, 16];

export default function WaterTracker({
  currentOz,
  targetOz: targetOzProp,
  onAdd,
}: WaterTrackerProps) {
  const { settings } = useSettings();
  const styles = makeStyles(useTheme().semanticColors);
  const targetOz = targetOzProp ?? settings.waterGoalOz;
  const progress = Math.min(currentOz / targetOz, 1);
  const glasses = Math.floor(currentOz / 8);

  // Round 3: a11y — progress track exposed as a progressbar, quick-add buttons labeled
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="water-outline" size={20} color={Colors.primary} />
          <Text style={styles.title}>Water</Text>
        </View>
        <Text style={styles.total}>
          {currentOz} / {targetOz} oz
        </Text>
      </View>

      <View
        style={styles.progressTrack}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Water progress"
        accessibilityValue={{ min: 0, max: targetOz, now: currentOz, text: `${currentOz} of ${targetOz} ounces` }}
      >
        <View
          style={[styles.progressFill, { width: `${progress * 100}%` }]}
        />
      </View>

      <View style={styles.buttonRow}>
        {WATER_AMOUNTS.map((oz) => (
          <TouchableOpacity
            key={oz}
            style={styles.addButton}
            onPress={() => onAdd(oz)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Add ${oz} ounces of water`}
          >
            <Text style={styles.addButtonText}>+{oz}oz</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.glasses}>
        {glasses === 1 ? '1 glass (8 oz)' : `${glasses} glasses (8 oz each)`}
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
    color: Colors.textPrimary,
  },
  total: {
    fontSize: 13,
    fontWeight: '600',
    color: sc.textMuted,
  },
  progressTrack: {
    height: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
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
    color: Colors.primary,
  },
  glasses: {
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'center',
  },
});
