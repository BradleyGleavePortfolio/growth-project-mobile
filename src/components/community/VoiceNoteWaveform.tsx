/**
 * VoiceNoteWaveform — a calm static bar visualization of a voice recording's
 * amplitude (v3-3). Used by the composer (preview of the just-recorded clip)
 * and the player (the published note). The peaks come from recorder metering;
 * a note without stored peaks (older server or note) degrades to a flat
 * baseline rather than an error.
 *
 * Posture:
 *   - A fixed bar count (downsampled from the raw peaks) so the strip is a
 *     stable width regardless of clip length.
 *   - An optional `progress` in [0,1] tints the played portion (player
 *     scrubbing); bars past the progress head use the muted color.
 *   - Decorative by default: the strip carries `accessibilityElementsHidden`
 *     so a screen reader announces the parent control's label (duration), not
 *     a meaningless list of bars (DESIGN_INTELLIGENCE — no noise to AT).
 *   - Style B tones (VOICE-M): `light` (white card / sheet: leaf bars, moss edge, played forest)
 *     and `deep` (the coach card: unplayed voiceShades.barOnDeep, played leaf).
 *   - Tokens only (no raw hex). No emoji, no heavy font weights.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { forestPop as fp, voiceShades } from '../../theme/tokens';
import { downsamplePeaks } from './voiceFormat';

export type VoiceWaveTone = 'light' | 'deep';

const TONES: Record<VoiceWaveTone, { played: string; unplayed: string; edge?: string }> = {
  light: { played: fp.forest, unplayed: fp.leaf, edge: fp.moss },
  deep: { played: fp.leaf, unplayed: voiceShades.barOnDeep },
};

export interface VoiceNoteWaveformProps {
  /** Raw normalised amplitude samples in [0,1]; may be empty (flat baseline). */
  peaks: number[];
  /** Played fraction in [0,1]; bars before it use the accent tint. */
  progress?: number;
  /** Number of bars to render. */
  barCount?: number;
  /** Strip height in px. */
  height?: number;
  /** Ground the strip sits on (Style B). */
  tone?: VoiceWaveTone;
  /** Space between bars (GOAL: 2 on the feed card, 3 in the review sheet). */
  gap?: number;
  /** Draw the review sheet's 2 pt ink playhead at `progress` (GOAL 02 .bscrub .ph). */
  playhead?: boolean;
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
  tone = 'light',
  gap = 3,
  playhead = false,
  testID,
}: VoiceNoteWaveformProps): React.ReactElement {
  const t = TONES[tone];
  const bars = useMemo(
    () => downsamplePeaks(peaks, barCount),
    [peaks, barCount],
  );
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const headIndex = Math.round(clampedProgress * bars.length);

  return (
    <View
      style={[styles.row, { height, gap }]}
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
                height: Math.max(4, Math.round(height * scale)),
                backgroundColor: played ? t.played : t.unplayed,
                borderColor: !played && t.edge ? t.edge : 'transparent',
              },
            ]}
          />
        );
      })}
      {playhead ? (
        <View testID="voice-waveform-playhead" style={[styles.playhead, { left: `${clampedProgress * 100}%` }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    gap: 3,
  },
  bar: {
    flex: 1,
    maxWidth: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  playhead: { position: 'absolute', top: -4, bottom: -4, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: fp.ink },
});
