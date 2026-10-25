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
 * label ("Play voice note, 0:12" / "Pause"). The bars are the seek control:
 * tap a point to jump there; a screen reader swipes it up or down 5 seconds.
 *
 * Style B (VOICE-M): a full-width card: a row with the 52 pt play disc centred on the bars (GOAL
 * .brow), then the time under the bars (GOAL .bfoot, 64 pt in); `tone` picks the white member card,
 * the deep coach card or no card (the review sheet: 34 bars, 4 pt wide, 3 apart, left-aligned).
 * `disabled` greys the disc while the viewer's own note is sending or waiting (GOAL B-03, B-10a).
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { forestPop as fp, neutral, radius, spacing, voiceFaces, voiceShades } from '../../theme/tokens';
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
  /** Card style: member card, coach card, or none (review sheet). */
  tone?: 'light' | 'coach' | 'bare';
  /** No connection: a remote note cannot load, so Play is off. */
  offline?: boolean;
  /** Drawn at the end of the time row (the outbox row's waiting mark). */
  trailing?: React.ReactNode;
  /** Drawn inside the card under the row (the Not sent row). */
  footer?: React.ReactNode;
  /** The disc is grey and Play is off (the viewer's own note while it sends or waits). */
  disabled?: boolean;
  testID?: string;
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** GOAL B-02 review strip: 34 bars, 4 pt wide, 3 apart (34 x 4 + 33 x 3 = 235 pt). */
const REVIEW_BARS = 34;
const REVIEW_BAR_WIDTH = 4;
const REVIEW_GAP = 3;
const REVIEW_STRIP_WIDTH = REVIEW_BARS * REVIEW_BAR_WIDTH + (REVIEW_BARS - 1) * REVIEW_GAP;

export default function VoiceNotePlayer({
  url,
  durationMs,
  peaks = [],
  playback,
  onPlaybackError,
  tone = 'light',
  offline = false,
  trailing = null,
  footer = null,
  disabled: held = false,
  testID,
}: VoiceNotePlayerProps): React.ReactElement {
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
  // B-314-8: single flight. The generation of the load in progress, or null.
  // Set synchronously on the first tap, so a second tap before React
  // re-renders (or before the load resolves) never starts a second native
  // player; a URL change or unmount ends that generation, so a tap for the
  // new URL is not blocked by the stale load.
  const loadingRef = useRef<number | null>(null);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onPlaybackErrorRef.current = onPlaybackError;
  // A point picked on the bars before the clip is loaded; Play starts there.
  const seekRef = useRef(0);
  const barsWidth = useRef(0);

  const unavailable = url === null || !port.isAvailable || offline;
  const disabled = unavailable || held;

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
    seekRef.current = 0;
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
    if (loadingRef.current !== null && loadingRef.current === generationRef.current) return;
    let generation = generationRef.current;
    let loadingGeneration: number | null = null;
    try {
      let loaded = loadedRef.current;
      if (!loaded || loaded.url !== url) {
        if (loaded) release();
        generation = generationRef.current;
        loadingGeneration = generation;
        loadingRef.current = generation;
        setState('loading');
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
        const previous = loadedRef.current;
        loaded = { url, handle };
        loadedRef.current = loaded;
        // Never orphan a handle: anything adopted before this one is released.
        if (previous && previous.handle !== handle) {
          void previous.handle.unload().catch(reportVoiceAudioCleanup('player_replaced_unload'));
        }
      }
      if (seekRef.current > 0) await loaded.handle.seek(seekRef.current);
      seekRef.current = 0;
      await loaded.handle.play();
      if (generation === generationRef.current) setState('playing');
    } catch {
      fail(generation);
    } finally {
      if (loadingGeneration !== null && loadingRef.current === loadingGeneration) {
        loadingRef.current = null;
      }
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

  const seekTo = useCallback(
    (ms: number) => {
      const to = Math.round(Math.min(durationMs, Math.max(0, ms)));
      setPositionMs(to);
      const loaded = loadedRef.current;
      if (!loaded) {
        seekRef.current = to;
        return;
      }
      const generation = generationRef.current;
      void loaded.handle.seek(to).catch(() => fail(generation));
    },
    [durationMs, fail],
  );

  const onPress = useCallback(() => {
    if (state === 'playing') void pause();
    else void start();
  }, [pause, start, state]);

  const total = Math.max(durationMs, positionMs);
  const progress = total > 0 ? positionMs / total : 0;
  const playing = state === 'playing';
  const iconName = playing ? 'pause' : 'play';

  const controlLabel = unavailable
    ? !port.isAvailable
      ? 'Audio playback is not available on this build'
      : 'Audio unavailable'
    : playing
      ? 'Pause voice note'
      : `Play voice note, ${formatDuration(durationMs)}`;

  const deep = tone === 'coach';
  const ink = deep ? fp.onDeep : fp.ink;
  const discBg = disabled ? voiceShades.hairline : deep ? fp.onDeep : fp.deep;
  const discFg = disabled ? voiceShades.track : deep ? fp.deep : fp.leaf;
  const time =
    url === null || !port.isAvailable
      ? '—:—'
      : playing || positionMs > 0
        ? `${formatDuration(positionMs)} / ${formatDuration(durationMs)}`
        : formatDuration(durationMs);

  const bare = tone === 'bare';
  return (
    <View
      style={[
        styles.box,
        bare
          ? styles.bare
          : [styles.card, { backgroundColor: deep ? fp.deep : neutral[0], borderColor: deep ? fp.deep : voiceShades.hairline }],
      ]}
      testID={testID ?? 'voice-player'}
    >
      <View style={styles.brow}>
        <HapticPressable
          intent="light"
          onPress={onPress}
          disabled={disabled || state === 'loading'}
          accessibilityRole="button"
          accessibilityLabel={controlLabel}
          accessibilityState={{ disabled: disabled || state === 'loading', busy: state === 'loading' }}
          testID="voice-player-toggle"
          style={[styles.control, { backgroundColor: discBg }]}
        >
          {state === 'loading' ? (
            // The audio is on its way: a quiet spinner in the disc, not a play icon that does nothing.
            <ActivityIndicator size="small" color={discFg} testID="voice-player-loading" />
          ) : (
            <Ionicons name={iconName} size={22} color={discFg} />
          )}
        </HapticPressable>
        <Pressable
          disabled={disabled}
          onLayout={(e) => { barsWidth.current = e.nativeEvent.layout.width; }}
          onPress={(e) => {
            // The review strip is a fixed 235 pt from the left; a tap past its end is the end.
            const width = bare ? Math.min(barsWidth.current, REVIEW_STRIP_WIDTH) : barsWidth.current;
            if (width > 0) seekTo((Math.min(e.nativeEvent.locationX, width) / width) * durationMs);
          }}
          accessible={!disabled}
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note position"
          accessibilityValue={{ text: `${formatDuration(positionMs)} of ${formatDuration(durationMs)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => seekTo(positionMs + (e.nativeEvent.actionName === 'increment' ? 5000 : -5000))}
          style={styles.seek}
          testID="voice-player-seek"
        >
          {/* GOAL: the card strip is 48 thin bars, 34 high, 2 apart; the review sheet 34 bars 4 wide, 44 high, 3 apart, with a playhead. */}
          <VoiceNoteWaveform peaks={peaks} progress={progress} tone={deep ? 'deep' : 'light'}
            {...(bare
              ? { height: 44, barCount: REVIEW_BARS, barWidth: REVIEW_BAR_WIDTH, gap: REVIEW_GAP, playhead: true }
              : { height: 34, barCount: 48, gap: 2 })} />
        </Pressable>
      </View>
      {bare ? null : (
        <View style={styles.bfoot}>
          <Text
            style={[styles.duration, { color: ink }]}
            accessibilityElementsHidden
            testID="voice-player-duration"
          >
            {time}
          </Text>
          {trailing}
        </View>
      )}

      {state === 'error' ? (
        <Text
          style={[styles.retry, { color: deep ? fp.onDeep : fp.error }]}
          accessibilityRole="text"
          testID="voice-player-error"
        >
          Could not play this voice note. Tap play to try again.
        </Text>
      ) : null}
      {footer ? <View style={styles.full}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // GOAL .bcard: padding 10 10 8 12, a 1 pt hairline, radius 16.
  box: {
    paddingTop: 10,
    paddingRight: 10,
    paddingBottom: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  // GOAL .bcard box-shadow 0 2px 8px rgba(26,26,24,.05)
  card: { shadowColor: fp.ink, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, shadowOpacity: 0.05, elevation: 1 },
  bare: { padding: 0, borderWidth: 0 },
  control: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // GOAL .brow: the disc and the bars on one row, centred on each other, 12 apart.
  brow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  seek: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', pointerEvents: 'box-only' },
  // GOAL .bfoot: under the bars (64 = disc 52 + gap 12), 6 below the row.
  bfoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginTop: 6, paddingLeft: 64, minHeight: 20 },
  duration: { fontFamily: voiceFaces.semibold, fontSize: 14, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  retry: {
    marginTop: spacing.sm,
    fontFamily: voiceFaces.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  full: { marginTop: spacing.md },
});
