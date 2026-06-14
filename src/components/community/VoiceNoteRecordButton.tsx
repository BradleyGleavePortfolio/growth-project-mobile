/**
 * VoiceNoteRecordButton — the primary capture control for the v3-3 composer.
 * A single, large, accessible button whose label + icon + intent reflect the
 * recorder status it is handed (it is presentational — the state machine lives
 * in useVoiceRecorder).
 *
 * States:
 *   idle      → "Record" (mic icon), tap starts capture.
 *   recording → "Stop" (stop icon) + a live elapsed read-out, tap stops.
 *   stopping  → disabled "Finishing…" (no spinner-only dead state).
 *
 * Accessibility:
 *   - A real `accessibilityRole="button"` with a status-aware label and an
 *     `accessibilityState.busy` while finishing, so AT announces the action and
 *     the transient busy state rather than a silent icon swap.
 *   - The elapsed read-out is a sibling Text (not baked into the icon) so it is
 *     announced and re-announced as it changes via the label.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
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
  const { semanticColors } = useTheme();
  const recording = status === 'recording';
  const stopping = status === 'stopping';

  const iconName = recording ? 'stop' : 'mic-outline';
  const label = stopping
    ? 'Finishing'
    : recording
      ? `Stop recording at ${formatDuration(elapsedMs)}`
      : 'Record a voice note';
  const visibleText = stopping
    ? 'Finishing…'
    : recording
      ? formatDuration(elapsedMs)
      : 'Record';

  const handlePress = () => {
    if (stopping) return;
    if (recording) onStop();
    else onStart();
  };

  const bg = stopping
    ? semanticColors.disabledBg
    : semanticColors.accent;
  const fg = stopping
    ? semanticColors.textOnDisabled
    : semanticColors.textOnAccent;

  return (
    <View style={styles.wrap}>
      <HapticPressable
        intent={recording ? 'warning' : 'medium'}
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
        style={[styles.button, { backgroundColor: bg }]}
      >
        <Ionicons name={iconName} size={22} color={fg} />
        <Text style={[styles.label, { color: fg }]}>{visibleText}</Text>
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignSelf: 'stretch',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
