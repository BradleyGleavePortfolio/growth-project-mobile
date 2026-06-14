/**
 * VoiceNotePlayer — plays back a published voice note (v3-3). Renders a calm
 * row: a play/pause control, the waveform with played-progress tint, and the
 * remaining/total duration. Depends on the VoicePlaybackPort (injectable for
 * tests; resolved adapter at runtime).
 *
 * Degradation (honest capability, no dead controls):
 *   - `url === null` (storage unconfigured / signing failed): the control is
 *     disabled and labelled "Audio unavailable" — never a broken play button.
 *   - No playback adapter bundled (`isAvailable === false`): same disabled
 *     state with a "playback isn't available on this build" label.
 *   - A load/transport error during play surfaces a calm inline retry, never a
 *     thrown crash.
 *
 * Accessibility: the play/pause control is a real button with a status-aware
 * label ("Play voice note, 0:12" / "Pause"). The waveform is decorative and
 * hidden from AT (the control carries the meaning).
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { formatDuration } from './voiceFormat';
import VoiceNoteWaveform from './VoiceNoteWaveform';
import {
  resolveVoicePlayback,
  type VoicePlaybackPort,
  type VoicePlaybackHandle,
} from './voicePlaybackPort';

export interface VoiceNotePlayerProps {
  /** Signed download URL, or null when storage signing is unavailable. */
  url: string | null;
  /** Total clip duration (ms) from the note metadata. */
  durationMs: number;
  /** Optional waveform peaks for the visualization (empty → flat baseline). */
  peaks?: number[];
  /** Inject a playback port for tests; defaults to the resolved adapter. */
  playback?: VoicePlaybackPort;
  testID?: string;
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export default function VoiceNotePlayer({
  url,
  durationMs,
  peaks = [],
  playback,
  testID,
}: VoiceNotePlayerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const port = playback ?? resolveVoicePlayback();

  const [state, setState] = useState<PlayState>('idle');
  const [positionMs, setPositionMs] = useState(0);
  const handleRef = useRef<VoicePlaybackHandle | null>(null);

  const disabled = url === null || !port.isAvailable;

  // Release the native resource on unmount so a scrolled-away note never leaks.
  useEffect(() => {
    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) void handle.unload();
    };
  }, []);

  const start = useCallback(async () => {
    if (disabled || url === null) return;
    setState('loading');
    try {
      if (!handleRef.current) {
        handleRef.current = await port.load(url, {
          onProgress: (ms) => setPositionMs(ms),
          onEnd: () => {
            setState('paused');
            setPositionMs(0);
          },
          onError: () => setState('error'),
        });
      }
      await handleRef.current.play();
      setState('playing');
    } catch {
      setState('error');
    }
  }, [disabled, port, url]);

  const pause = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      await handle.pause();
      setState('paused');
    } catch {
      setState('error');
    }
  }, []);

  const onPress = useCallback(() => {
    if (state === 'playing') void pause();
    else void start();
  }, [pause, start, state]);

  const total = Math.max(durationMs, positionMs);
  const progress = total > 0 ? positionMs / total : 0;
  const playing = state === 'playing';
  const iconName = playing ? 'pause' : 'play';

  const controlLabel = disabled
    ? !port.isAvailable
      ? 'Audio playback is not available on this build'
      : 'Audio unavailable'
    : playing
      ? 'Pause voice note'
      : `Play voice note, ${formatDuration(durationMs)}`;

  const controlBg = disabled
    ? semanticColors.disabledBg
    : semanticColors.accent;
  const controlFg = disabled
    ? semanticColors.textOnDisabled
    : semanticColors.textOnAccent;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
      testID={testID ?? 'voice-player'}
    >
      <HapticPressable
        intent="light"
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={controlLabel}
        accessibilityState={{ disabled, busy: state === 'loading' }}
        testID="voice-player-toggle"
        style={[styles.control, { backgroundColor: controlBg }]}
      >
        <Ionicons name={iconName} size={18} color={controlFg} />
      </HapticPressable>

      <View style={styles.middle}>
        <VoiceNoteWaveform peaks={peaks} progress={progress} height={28} />
      </View>

      <Text
        style={[styles.duration, { color: semanticColors.textMuted }]}
        accessibilityElementsHidden
        testID="voice-player-duration"
      >
        {disabled ? '—:—' : formatDuration(playing ? positionMs : durationMs)}
      </Text>

      {state === 'error' ? (
        <Text
          style={[styles.retry, { color: semanticColors.accentText }]}
          accessibilityRole="text"
          testID="voice-player-error"
        >
          Tap to retry
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  control: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1 },
  duration: {
    fontSize: 13,
    fontWeight: '500',
    minWidth: 40,
    textAlign: 'right',
  },
  retry: {
    fontSize: 13,
    fontWeight: '500',
  },
});
