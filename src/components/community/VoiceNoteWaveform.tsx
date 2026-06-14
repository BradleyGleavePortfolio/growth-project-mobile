/**
 * VoiceNoteWaveform — a calm static bar visualization of a voice recording's
 * amplitude (v3-3). Used by the composer (preview of the just-recorded clip)
 * and the player (the published note). The waveform is purely a CLIENT-SIDE
 * cue derived from recorder metering; the backend does not store peaks, so an
 * empty/unknown waveform degrades to a flat baseline rather than an error.
 *
 * Posture:
 *   - A fixed bar count (downsampled from the raw peaks) so the strip is a
 *     stable width regardless of clip length.
 *   - An optional `progress` in [0,1] tints the played portion (player
 *     scrubbing); bars past the progress head use the muted color.
 *   - Decorative by default: the strip carries `accessibilityElementsHidden`
 *     so a screen reader announces the parent control's label (duration), not
 *     a meaningless list of bars (DESIGN_INTELLIGENCE — no noise to AT).
 *   - Tokens only (no raw hex). No emoji, no heavy font weights.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { downsamplePeaks } from './voiceFormat';

export interface VoiceNoteWaveformProps {
  /** Raw normalised amplitude samples in [0,1]; may be empty (flat baseline). */
  peaks: number[];
  /** Played fraction in [0,1]; bars before it use the accent tint. */
  progress?: number;
  /** Number of bars to render. */
  barCount?: number;
  /** Strip height in px. */
  height?: number;
  testID?: string;
}

const DEFAULT_BARS = 32;
const DEFAULT_HEIGHT = 36;
const MIN_BAR_SCALE = 0.12; // a floor so silent stretches still show a hairline

export default function VoiceNoteWaveform({
  peaks,
  progress = 0,
  barCount = DEFAULT_BARS,
  height = DEFAULT_HEIGHT,
  testID,
}: VoiceNoteWaveformProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const bars = useMemo(
    () => downsamplePeaks(peaks, barCount),
    [peaks, barCount],
  );
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const headIndex = Math.round(clampedProgress * bars.length);

  return (
    <View
      style={[styles.row, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? 'voice-waveform'}
    >
      {bars.map((value, i) => {
        const scale = MIN_BAR_SCALE + (1 - MIN_BAR_SCALE) * value;
        const played = i < headIndex;
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: Math.max(2, Math.round(height * scale)),
                backgroundColor: played
                  ? semanticColors.accent
                  : semanticColors.border,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 1,
  },
});
