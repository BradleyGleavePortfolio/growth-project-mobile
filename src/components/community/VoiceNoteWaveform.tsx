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
 *   - `barWidth` draws fixed-width bars packed from the left (GOAL B-02 review strip: 34 x 4 pt, 3
 *     apart); without it the bars share the row (the feed card).
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
  /** Fixed bar width, packed from the left (the review sheet); omit to share the row. */
  barWidth?: number;
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
  barWidth,
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
      style={[styles.row, { height, gap }, barWidth ? styles.packed : styles.fill]}
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
              // Fixed bars carry no flex at all: on react-native-web `flex: 0` is CSS `0 1 0%`, which drops
              // the width to the border (a 2 pt bar in the web preview); a plain width holds on both.
              barWidth ? [styles.fixedBar, { width: barWidth }] : styles.bar,
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
    gap: 3,
  },
  fill: { flex: 1 },
  packed: { justifyContent: 'flex-start' },
  bar: {
    flex: 1,
    maxWidth: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  fixedBar: { borderRadius: 2, borderWidth: 1 },
  playhead: { position: 'absolute', top: -4, bottom: -4, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: fp.ink },
});
