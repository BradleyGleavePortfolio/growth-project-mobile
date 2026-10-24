/**
 * VoiceNoteComposer — the voice notes Style B record sheet body (VOICE-M; owner
 * "VOICE-PICK-VOICE ; I want style b"), hosted by VoiceRecordSheet and the
 * composer route. It records and reviews; Send hands the recording to the
 * outbox (useVoiceOutbox) and the sheet closes, so sending, failed and offline
 * live on the feed row. It owns NO transport logic of its own.
 *
 * States it renders honestly (no dead controls, no lies about capability):
 *   - unavailable → a calm "voice recording isn't available on this build"
 *     notice (the native recorder is not bundled yet); no record button.
 *   - denied      → a REAL mic-permission recovery state: a "try again" action,
 *     and when the OS will no longer prompt, an "Open Settings" deep-link
 *     instead of a no-op button (audit req — denial needs real recovery).
 *   - idle        → the sheet starts recording as it opens (GOAL 01b, one tap
 *     from Record); idle shows only after Try again, with the forest disc.
 *   - recording   → serif timer, live level bars, elapsed · line · 5:00, stop;
 *     "{time} left" and one warning tap from 15 s left; stops at 5:00.
 *   - error       → what failed (permission check / start / save), a Try again
 *     that returns to idle, and a support path with the reported reference.
 *   - recorded    → listen back (the feed's player), "Re-record", "Send".
 *
 * The audience disclosure (VoicePrivacyCopy) renders the REAL target audience
 * (DM recipient / named cohort / community), computed from the props.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, neutral, radius, spacing, typography, voiceShades } from '../../theme/tokens';
import { HapticService } from '../../ui/haptics/haptics.service';
import { LIVE_LEVEL_BARS, useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { VoiceRecorderPort, VoiceRecordingResult } from '../../hooks/voiceRecorderPort';
import type { VoicePlaybackPort } from './voicePlaybackPort';
import VoiceNoteRecordButton from './VoiceNoteRecordButton';
import VoiceNotePlayer from './VoiceNotePlayer';
import VoicePrivacyCopy, { type VoiceAudienceTarget } from './VoicePrivacyCopy';
import { formatDuration } from './voiceFormat';
import { COMMUNITY_SUPPORT_EMAIL } from '../../api/communityErrors';

export interface VoiceNoteComposerProps {
  /** The concrete send target → drives the audience disclosure. */
  target: VoiceAudienceTarget;
  /** Send hands the recording to the outbox. */
  onSend: (recording: VoiceRecordingResult) => void;
  /** Cancel, Not now and Delete close the sheet. */
  onClose: () => void;
  /** Inject a recorder port for tests; defaults to the resolved adapter. */
  recorder?: VoiceRecorderPort;
  /** Inject a playback port for the listen-back player in tests. */
  playback?: VoicePlaybackPort;
  testID?: string;
}

const SHEET_GUTTER = 20;
const WARN_LEFT_MS = 15_000; // one warning tap and "{time} left" from here
const HINT_MS = 3_000; // "Records up to 5:00 of audio." for the first seconds

export default function VoiceNoteComposer({
  target,
  onSend,
  onClose,
  recorder,
  playback,
  testID,
}: VoiceNoteComposerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const rec = useVoiceRecorder(recorder ? { recorder } : {});
  const warned = useRef(false);
  const { start, status } = rec;
  // One tap from Record (GOAL 01b): the sheet starts recording as it opens. Once per mount, so a
  // re-render or a later idle (after Try again) never starts a second take on its own.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [start]);

  const left = rec.maxDurationMs - rec.elapsedMs;
  useEffect(() => {
    if (status !== 'recording') warned.current = false;
    else if (left <= WARN_LEFT_MS && !warned.current) {
      warned.current = true;
      void HapticService.warning();
    }
  }, [left, status]);

  const restart = () => { rec.reset(); void start(); };

  const recordStatus = useMemo<'idle' | 'recording' | 'stopping'>(() => {
    if (rec.status === 'recording') return 'recording';
    if (rec.status === 'stopping') return 'stopping';
    return 'idle';
  }, [rec.status]);

  // ── Unavailable build ───────────────────────────────────────────────────────
  if (rec.status === 'unavailable') {
    return (
      <View style={styles.container} testID={testID ?? 'voice-composer-unavailable'}>
        {/* GOAL 10b: no header; the reason beside a wash circle, then one full-width Close. */}
        <View style={styles.unavailableRow} accessibilityRole="text">
          <View style={styles.wash}>
            <Ionicons name="mic-off-outline" size={24} color={fp.forest} />
          </View>
          <Text style={[styles.noticeText, styles.unavailableText]}>
            Voice recording isn’t available on this build yet. You can still send a
            written note.
          </Text>
        </View>
        <HapticPressable intent="light" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
          testID="voice-composer-close" style={[styles.primaryAction, styles.outlined]}>
          <Text style={[styles.primaryLabel, { color: fp.forest }]}>Close</Text>
        </HapticPressable>
      </View>
    );
  }

  // ── Mic permission denied — real recovery ───────────────────────────────────
  if (rec.status === 'denied') {
    return (
      <View style={styles.container} testID={testID ?? 'voice-composer-denied'}>
        <View style={[styles.wash, styles.washLarge]} testID="voice-composer-denied-wash">
          <Ionicons name="mic-off-outline" size={32} color={fp.forest} />
        </View>
        <Text style={[styles.noticeText, styles.centered]} accessibilityRole="text">
          Microphone access is off, so a voice note can’t be recorded. Turn it on
          to record.
        </Text>
        <HapticPressable
          intent="medium"
          onPress={() => {
            if (rec.mustOpenSettings) void Linking.openSettings();
            else void rec.retryPermission();
          }}
          accessibilityRole="button"
          accessibilityLabel={
            rec.mustOpenSettings
              ? 'Open Settings to enable the microphone'
              : 'Try enabling the microphone again'
          }
          testID="voice-composer-permission-action"
          style={[styles.primaryAction, styles.filled]}
        >
          <Text style={[styles.primaryLabel, { color: fp.onDeep }]}>
            {rec.mustOpenSettings ? 'Open Settings' : 'Try again'}
          </Text>
        </HapticPressable>
        <HapticPressable intent="light" onPress={onClose} accessibilityRole="button" accessibilityLabel="Not now"
          testID="voice-composer-not-now" style={styles.quiet}>
          <Text style={[styles.primaryLabel, { color: fp.forest }]}>Not now</Text>
        </HapticPressable>
      </View>
    );
  }

  // ── Recorder failure — what happened, what to do next, a reference ─────────
  if (rec.status === 'error') {
    const what =
      rec.error?.kind === 'permission_check'
        ? 'Microphone access could not be checked on this phone.'
        : rec.error?.kind === 'stop'
          ? 'The recording could not be finished and saved.'
          : 'The microphone could not start recording.';
    return (
      <View
        style={styles.notice}
        accessibilityRole="text"
        testID={testID ?? 'voice-composer-error'}
      >
        <SheetHeader onCancel={onClose} />
        <Ionicons name="alert-circle-outline" size={22} color={semanticColors.accentText} />
        <Text style={[styles.noticeText, { color: semanticColors.textPrimary }]}>
          {what} Try again. If it keeps happening, close other apps that use the
          microphone, or email {COMMUNITY_SUPPORT_EMAIL}
          {rec.error ? ` and mention reference ${rec.error.reference}` : ''}.
        </Text>
        <HapticPressable
          intent="medium"
          onPress={() => rec.reset()}
          accessibilityRole="button"
          accessibilityLabel="Try recording again"
          testID="voice-composer-error-retry"
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryLabel}>
            Try again
          </Text>
        </HapticPressable>
      </View>
    );
  }

  // ── Recorded — listen back, Re-record, Send ────────────────────────────────
  if (rec.status === 'recorded' && rec.recording) {
    const recording = rec.recording;
    return (
      <View style={styles.container} testID={testID ?? 'voice-composer-review'}>
        <SheetHeader onCancel={() => { rec.reset(); onClose(); }} discard />
        <Text style={styles.timer} accessibilityElementsHidden testID="voice-composer-preview-duration">
          {formatDuration(recording.durationMs)}
        </Text>
        <Text style={styles.hint}>Listen back before you send.</Text>
        <VoiceNotePlayer
          url={recording.uri}
          durationMs={recording.durationMs}
          peaks={recording.peaks}
          tone="bare"
          {...(playback ? { playback } : {})}
          testID="voice-composer-listen"
        />
        <VoicePrivacyCopy target={target} />
        <View style={styles.reviewActions}>
          <View style={styles.fill}>
          <HapticPressable
            intent="light"
            onPress={restart}
            accessibilityRole="button"
            accessibilityLabel="Discard and record again"
            testID="voice-composer-rerecord"
            style={[styles.primaryAction, styles.outlined]}
          >
            <Ionicons name="refresh" size={20} color={fp.forest} />
            <Text style={[styles.primaryLabel, { color: fp.forest }]}>Re-record</Text>
          </HapticPressable>
          </View>
          <View style={styles.fill}>
          <HapticPressable
            intent="light"
            onPress={() => { onSend(recording); rec.reset(); }}
            accessibilityRole="button"
            accessibilityLabel="Send voice note"
            testID="voice-composer-send"
            style={[styles.primaryAction, styles.filled]}
          >
            <Ionicons name="arrow-up" size={20} color={fp.onDeep} />
            <Text style={[styles.primaryLabel, { color: fp.onDeep }]}>Send</Text>
          </HapticPressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Idle / recording — capture ──────────────────────────────────────────────
  const live = recordStatus !== 'idle';
  const warn = live && left <= WARN_LEFT_MS;
  const hint = warn
    ? `${formatDuration(left)} left`
    : !live || rec.elapsedMs < HINT_MS
      ? `Records up to ${formatDuration(rec.maxDurationMs)} of audio.`
      : '';
  return (
    <View style={styles.container} testID={testID ?? 'voice-composer'}>
      {/* Closing unmounts the recorder hook, which releases the microphone. */}
      <SheetHeader onCancel={onClose} cancelLabel={live ? 'Cancel recording' : 'Cancel'} />
      <Text style={styles.timer} accessibilityElementsHidden testID="voice-composer-timer">
        {formatDuration(rec.elapsedMs)}
      </Text>
      <Text style={[styles.hint, warn && styles.hintWarn]} accessibilityLiveRegion="polite">
        {hint}
      </Text>
      <View style={styles.levels} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: LIVE_LEVEL_BARS }, (_, i) => {
          const v = rec.levels[i];
          return v === undefined ? (
            <View key={i} style={styles.dot} />
          ) : (
            <View key={i} style={[styles.level, { height: 8 + Math.round(v * 56) }]} />
          );
        })}
      </View>
      <View style={styles.line} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.lineLabel} testID="voice-composer-line-elapsed">{formatDuration(rec.elapsedMs)}</Text>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.min(1, rec.elapsedMs / rec.maxDurationMs) * 100}%` }]} />
        </View>
        <Text style={styles.lineLabel} testID="voice-composer-line-max">{formatDuration(rec.maxDurationMs)}</Text>
      </View>
      <VoiceNoteRecordButton
        status={recordStatus}
        elapsedMs={rec.elapsedMs}
        maxDurationMs={rec.maxDurationMs}
        onStart={() => void start()}
        onStop={() => void rec.stop()}
      />
      <VoicePrivacyCopy target={target} />
    </View>
  );
}

function SheetHeader({ onCancel, cancelLabel = 'Cancel', discard = false }: {
  onCancel: () => void; cancelLabel?: string; discard?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.header}>
      <HapticPressable
        intent="light"
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={discard ? 'Delete' : cancelLabel}
        testID={discard ? 'voice-composer-discard' : 'voice-composer-cancel'}
        style={styles.headerAction}
      >
        {discard ? (
          <Ionicons name="trash-outline" size={24} color={fp.n700} />
        ) : (
          <Text style={styles.cancel}>Cancel</Text>
        )}
      </HapticPressable>
      <Text style={styles.title} accessibilityRole="header">Voice note</Text>
      <View style={styles.headerAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  // GOAL sheet: 20 pt gutters (.bsheet padding 8 20 0).
  container: {
    gap: spacing.md,
    paddingHorizontal: SHEET_GUTTER,
    paddingBottom: spacing.md,
  },
  notice: {
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: SHEET_GUTTER,
  },
  noticeText: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    color: fp.ink,
  },
  centered: { paddingHorizontal: spacing.sm },
  unavailableRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  unavailableText: { flex: 1, textAlign: 'left' },
  fill: { flex: 1, alignSelf: 'stretch' },
  header: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  cancel: { fontSize: 16, lineHeight: 20, fontWeight: '600', color: fp.forest },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: fp.ink },
  // GOAL .btime: Cormorant 500 at 56/70 — the loaded Medium face (h3), not a synthesised weight.
  timer: { fontFamily: typography.h3.fontFamily, fontSize: 56, lineHeight: 70, fontWeight: '500', color: fp.ink,
    textAlign: 'center', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 14, lineHeight: 20, minHeight: 20, color: fp.n700, textAlign: 'center' },
  hintWarn: { color: fp.ink, fontWeight: '600' },
  levels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64 },
  level: { width: 5, borderRadius: 3, backgroundColor: fp.leaf, borderWidth: 1, borderColor: fp.moss },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: voiceShades.hairline },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineLabel: { fontSize: 13, lineHeight: 16, fontWeight: '500', color: fp.n700, fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: voiceShades.hairline, overflow: 'hidden' },
  trackFill: { height: 4, backgroundColor: fp.forest },
  wash: { width: 56, height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: voiceShades.leafWash, borderWidth: 1, borderColor: voiceShades.washEdge },
  washLarge: { width: 72, height: 72, alignSelf: 'center', marginTop: 14 },
  reviewActions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryAction: {
    alignSelf: 'stretch',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: fp.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: fp.onDeep,
  },
  primaryAction: {
    minHeight: 54,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { backgroundColor: fp.forest },
  outlined: { borderWidth: 1.5, borderColor: fp.forest, backgroundColor: neutral[0] },
  primaryLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  quiet: { alignSelf: 'stretch', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
