/**
 * BucketSwitcher — the segmented `Fitness | Recovery` control that lives in the
 * WearablesShell header. Pure presentational + a callback; the shell owns the
 * active bucket state and the cross-fade animation (brief §3b).
 *
 * Accessibility: the control is a `tablist`; each segment is a `tab` with
 * `selected` state so VoiceOver/TalkBack announce "Fitness, tab, 1 of 2,
 * selected". A light haptic confirms the switch (gated for safety).
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  radius,
  spacing,
  typography,
  withAlpha,
} from '../../../../theme/tokens';
import { lightTap } from '../../../../utils/haptics';
import type { WearableMetricBucket } from '../../../../api/wearablesSamplesApi';
import { toneForBucket, toneTokens } from '../wearablesTheme';

interface Segment {
  readonly bucket: WearableMetricBucket;
  readonly label: string;
  readonly icon: 'fitness-outline' | 'moon-outline';
}

const SEGMENTS: readonly Segment[] = [
  { bucket: 'HEALTH_FITNESS', label: 'Fitness', icon: 'fitness-outline' },
  { bucket: 'SLEEP_RECOVERY', label: 'Recovery', icon: 'moon-outline' },
];

interface Props {
  readonly active: WearableMetricBucket;
  readonly onChange: (bucket: WearableMetricBucket) => void;
}

export default function BucketSwitcher({ active, onChange }: Props) {
  const handlePress = useCallback(
    (bucket: WearableMetricBucket) => {
      if (bucket === active) return;
      lightTap();
      onChange(bucket);
    },
    [active, onChange],
  );

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {SEGMENTS.map((segment) => {
        const selected = segment.bucket === active;
        const tone = toneTokens(toneForBucket(segment.bucket));
        return (
          <Pressable
            key={segment.bucket}
            onPress={() => handlePress(segment.bucket)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Ionicons
              name={segment.icon}
              size={16}
              color={selected ? tone.accent : colors.charcoal}
            />
            <Text
              style={[
                styles.label,
                { color: selected ? colors.ink : colors.charcoal },
              ]}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// `colors` has no dedicated "switch surface" token; use a tinted neutral that
// reads as a raised pill on the bone/cream track (matches the app's chip
// treatment) without inventing an off-palette hex.
const SWITCH_SURFACE = withAlpha(colors.bone, 1);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: withAlpha(colors.ink, 0.05),
    borderRadius: radius.pill,
    padding: spacing.xs / 2,
    alignSelf: 'center',
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  segmentSelected: {
    backgroundColor: SWITCH_SURFACE,
  },
  label: {
    ...typography.bodySmall,
    fontFamily: 'Inter_500Medium',
  },
});
