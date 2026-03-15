import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface WaterTrackerProps {
  currentOz: number;
  targetOz?: number;
  onAdd: (oz: number) => void;
}

const WATER_AMOUNTS = [8, 12, 16];

export default function WaterTracker({
  currentOz,
  targetOz = 128,
  onAdd,
}: WaterTrackerProps) {
  const progress = Math.min(currentOz / targetOz, 1);
  const glasses = Math.floor(currentOz / 8);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="water" size={20} color={Colors.water} />
          <Text style={styles.title}>Water</Text>
        </View>
        <Text style={styles.total}>
          {currentOz} / {targetOz} oz
        </Text>
      </View>

      <View style={styles.progressTrack}>
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
          >
            <Text style={styles.addButtonText}>+{oz}oz</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.glasses}>{glasses} glasses today</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
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
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  total: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  progressTrack: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.water,
    borderRadius: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addButton: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.water,
  },
  glasses: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
