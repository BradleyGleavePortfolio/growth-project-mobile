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
 *     thrown crash. The failed clip is released so the retry reloads, and
 *     `onPlaybackError` lets the parent fetch a fresh signed URL.
 *   - The clip is keyed to its URL (B-314-5): a new URL releases the old clip
 *     and the next Play loads the new one; late loads are released.
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
import { reportVoiceAudioCleanup } from '../../services/voiceAudio';

export interface VoiceNotePlayerProps {
  /** Signed download URL, or null when storage signing is unavailable. */
  url: string | null;
  /** Total clip duration (ms) from the note metadata. */
  durationMs: number;
  /** Optional waveform peaks for the visualization (empty → flat baseline). */
  peaks?: number[];
  /** Inject a playback port for tests; defaults to the resolved adapter. */
  playback?: VoicePlaybackPort;
  /**
   * Called when loading or playing fails, so the parent can fetch a fresh
   * signed URL (they expire). The new URL replaces the failed clip.
   */
  onPlaybackError?: () => void;
  testID?: string;
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export default function VoiceNotePlayer({
  url,
  durationMs,
  peaks = [],
  playback,
  onPlaybackError,
  testID,
}: VoiceNotePlayerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const port = playback ?? resolveVoicePlayback();

  const [state, setState] = useState<PlayState>('idle');
  const [positionMs, setPositionMs] = useState(0);
  // The loaded clip is keyed to the URL it was loaded from (B-314-5): a
  // refreshed signed URL (queue refetch, expired link) must never keep
  // playing, or retrying, the old one.
  const loadedRef = useRef<{ url: string; handle: VoicePlaybackHandle } | null>(null);
  // Bumped on every URL change, release and unmount; a load that resolves
  // after its generation ended is released instead of adopted.
  const generationRef = useRef(0);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onPlaybackErrorRef.current = onPlaybackError;

  const disabled = url === null || !port.isAvailable;

  const release = useCallback(() => {
    generationRef.current += 1;
    const loaded = loadedRef.current;
    loadedRef.current = null;
    if (loaded) void loaded.handle.unload().catch(reportVoiceAudioCleanup('player_unload'));
  }, []);

  // A new URL releases the old clip and resets the control; the
  // next Play loads the new URL. Unmount releases it too, so a scrolled-away
  // note never leaks a native player.
  useEffect(() => {
    setState('idle');
    setPositionMs(0);
    return release;
  }, [url, release]);

  const fail = useCallback(
    (generation: number) => {
      if (generation !== generationRef.current) return;
      // Drop the failed clip so Retry reloads (an expired signed URL is the
      // usual cause; the parent can fetch a fresh one).
      release();
      setState('error');
      onPlaybackErrorRef.current?.();
    },
    [release],
  );

  const start = useCallback(async () => {
    if (disabled || url === null) return;
    setState('loading');
    let generation = generationRef.current;
    try {
      let loaded = loadedRef.current;
      if (!loaded || loaded.url !== url) {
        if (loaded) release();
        generation = generationRef.current;
        const handle = await port.load(url, {
          onProgress: (ms) => {
            if (generation === generationRef.current) setPositionMs(ms);
          },
          onEnd: () => {
            if (generation !== generationRef.current) return;
            setState('paused');
            setPositionMs(0);
          },
          onError: () => fail(generation),
        });
        if (generation !== generationRef.current) {
          // The URL changed or the player unmounted while loading.
          void handle.unload().catch(reportVoiceAudioCleanup('late_load_unload'));
          return;
        }
        loaded = { url, handle };
        loadedRef.current = loaded;
      }
      await loaded.handle.play();
      if (generation === generationRef.current) setState('playing');
    } catch {
      fail(generation);
    }
  }, [disabled, fail, port, release, url]);

  const pause = useCallback(async () => {
    const loaded = loadedRef.current;
    if (!loaded) return;
    const generation = generationRef.current;
    try {
      await loaded.handle.pause();
      if (generation === generationRef.current) setState('paused');
    } catch {
      fail(generation);
    }
  }, [fail]);

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
          Could not play this voice note. Tap play to try again.
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
