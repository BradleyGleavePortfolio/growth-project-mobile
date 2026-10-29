/**
 * VoiceNoteRecordButton — the primary capture control for the v3-3 composer.
 * A single, large, accessible button whose label + icon + intent reflect the
 * recorder status it is handed (it is presentational — the state machine lives
 * in useVoiceRecorder).
 *
 * States:
 *   idle      → mic icon on the Style B forest disc, tap starts capture.
 *   recording → a stop square, tap stops (the sheet shows the timer).
 *   stopping  → disabled and busy, labelled "Finishing".
 *
 * Accessibility:
 *   - A real `accessibilityRole="button"` with a status-aware label and an
 *     `accessibilityState.busy` while finishing, so AT announces the action and
 *     the transient busy state rather than a silent icon swap.
 *   - The elapsed time is announced through the label.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { forestPop as fp, radius } from '../../theme/tokens';
import { formatDuration } from './voiceFormat';

export type RecordButtonStatus = 'idle' | 'recording' | 'stopping';

export interface VoiceNoteRecordButtonProps {
  status: RecordButtonStatus;
  /** Live elapsed ms while recording (drives the read-out + label). */
  elapsedMs: number;
  /** Hard cap ms, surfaced in the label so the user knows the limit. */
  maxDurationMs: number;
  onStart: () => void;
  onStop: () => void;
  testID?: string;
}

export default function VoiceNoteRecordButton({
  status,
  elapsedMs,
  maxDurationMs,
  onStart,
  onStop,
  testID,
}: VoiceNoteRecordButtonProps): React.ReactElement {
  const recording = status === 'recording';
  const stopping = status === 'stopping';

  const label = stopping
    ? 'Finishing'
    : recording
      ? `Stop recording at ${formatDuration(elapsedMs)}`
      : 'Record a voice note';
  const handlePress = () => {
    if (stopping) return;
    if (recording) onStop();
    else onStart();
  };

  return (
    <View style={styles.wrap}>
      <HapticPressable
        intent={recording ? 'light' : 'medium'}
        onPress={handlePress}
        disabled={stopping}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: stopping, disabled: stopping }}
        accessibilityHint={
          recording
            ? 'Stops the recording and lets you review it before sending.'
            : `Records up to ${formatDuration(maxDurationMs)} of audio.`
        }
        testID={testID ?? 'voice-record-button'}
        style={[styles.button, { opacity: stopping ? 0.6 : 1 }]}
      >
        {recording || stopping ? (
          <View style={styles.square} />
        ) : (
          <Ionicons name="mic-outline" size={28} color={fp.onDeep} />
        )}
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  button: {
    // GOAL .bbig: a 76 pt disc with a 13 pt stop square (the 28 pt icon's 11/24 rect).
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    backgroundColor: fp.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: { width: 13, height: 13, borderRadius: 3, backgroundColor: fp.onDeep },
});
