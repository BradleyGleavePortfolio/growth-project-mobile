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
            // P0: this is the most-tapped control on the screen. Guarantee a
            // ≥44pt tap surface (HIG floor) with minHeight + symmetric hitSlop
            // so edge taps near the pill track still register.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
                {
                  color: selected ? colors.ink : colors.charcoal,
                  // P2: non-color disambiguator — weight bump complements the
                  // underline below so the active segment never relies on
                  // color alone (a11y: contrast-independent state).
                  fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_500Medium',
                },
              ]}
            >
              {segment.label}
            </Text>
            {/* P2: position-anchored underline — a non-color active indicator
                that harmonises with the segmented pill chrome. */}
            {selected && <View style={styles.activeUnderline} />}
          </Pressable>
        );
      })}
    </View>
  );
}

// `colors` has no dedicated "switch surface" token; the raised pill reads as a
// solid neutral on the bone/cream track (matches the app's chip treatment)
// without inventing an off-palette hex. (R1 P3: drop the withAlpha(_, 1) no-op.)
const SWITCH_SURFACE = colors.bone;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: withAlpha(colors.ink, 0.05),
    borderRadius: radius.pill,
    // P2: snap to the 4pt grid (was spacing.xs / 2 = 2pt, off-grid).
    padding: spacing.xs,
    alignSelf: 'center',
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    // P0: HIG 44pt minimum tap height for the primary header control.
    minHeight: 44,
    borderRadius: radius.pill,
  },
  segmentSelected: {
    backgroundColor: SWITCH_SURFACE,
  },
  label: {
    ...typography.bodySmall,
    // fontFamily is set per-segment (selected → SemiBold) as a non-color
    // active disambiguator; the base weight is Medium.
  },
  // P2: non-color active indicator — a thin bar anchored to the segment
  // baseline, in the primary ink so it reads regardless of hue.
  activeUnderline: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.lg,
    right: spacing.lg,
    height: 1.5,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
});
