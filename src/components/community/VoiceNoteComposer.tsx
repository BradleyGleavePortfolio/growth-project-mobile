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
 *   - first use   → the once-only card (backend #1122; none on an older server).
 *   - idle        → the timer at 0:00 and the forest record disc.
 *   - recording   → serif timer, live level bars, a line filling to 5:00, stop;
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { forestPop as fp, radius, spacing, typography, voiceShades } from '../../theme/tokens';
import { HapticService } from '../../ui/haptics/haptics.service';
import { LIVE_LEVEL_BARS, useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useVoiceConsent } from '../../hooks/useVoiceStudio';
import type { VoiceRecorderPort, VoiceRecordingResult } from '../../hooks/voiceRecorderPort';
import type { VoicePlaybackPort } from './voicePlaybackPort';
import VoiceNoteRecordButton from './VoiceNoteRecordButton';
import VoiceNotePlayer from './VoiceNotePlayer';
import VoicePrivacyCopy, { describeVoiceAudience, type VoiceAudienceTarget } from './VoicePrivacyCopy';
import { formatDuration } from './voiceFormat';
import { COMMUNITY_SUPPORT_EMAIL } from '../../api/communityErrors';

export interface VoiceNoteComposerProps {
  /** The concrete send target → drives the audience disclosure. */
  target: VoiceAudienceTarget;
  /** Send hands the recording to the outbox. */
  onSend: (recording: VoiceRecordingResult) => void;
  /** Cancel, Not now and Delete close the sheet. */
  onClose: () => void;
  /** Sheet title; a coach's voice reply reads "Reply to {name}". */
  title?: string;
  /** A coach has no coach: the first-use card leaves out the report line. */
  coachView?: boolean;
  /** Inject a recorder port for tests; defaults to the resolved adapter. */
  recorder?: VoiceRecorderPort;
  /** Inject a playback port for the listen-back player in tests. */
  playback?: VoicePlaybackPort;
  testID?: string;
}

const WARN_LEFT_MS = 15_000; // one warning tap and "{time} left" from here
const HINT_MS = 3_000; // "Records up to 5:00 of audio." for the first seconds

export default function VoiceNoteComposer({
  target,
  onSend,
  onClose,
  title = 'Voice note',
  coachView = false,
  recorder,
  playback,
  testID,
}: VoiceNoteComposerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const rec = useVoiceRecorder(recorder ? { recorder } : {});
  const consent = useVoiceConsent();
  const [agreed, setAgreed] = useState(false);
  const warned = useRef(false);
  const showCard = consent.needsCard && !agreed;
  const { start, status } = rec;

  const left = rec.maxDurationMs - rec.elapsedMs;
  useEffect(() => {
    if (status !== 'recording') warned.current = false;
    else if (left <= WARN_LEFT_MS && !warned.current) {
      warned.current = true;
      void HapticService.warning();
    }
  }, [left, status]);

  const restart = () => {
    rec.reset();
    void start();
  };

  const recordStatus = useMemo<'idle' | 'recording' | 'stopping'>(() => {
    if (rec.status === 'recording') return 'recording';
    if (rec.status === 'stopping') return 'stopping';
    return 'idle';
  }, [rec.status]);

  // ── First use: the once-only card ───────────────────────────────────────────
  if (showCard) {
    const lines: [React.ComponentProps<typeof Ionicons>['name'], string][] = [
      ['lock-closed-outline', describeVoiceAudience(target)],
      ['flag-outline', 'If someone reports a voice note, your coach and the TGP Fitness team can listen to it.'],
      ['trash-outline', 'You can delete your voice note at any time.'],
    ];
    if (coachView) lines.splice(1, 1);
    return (
      <View style={styles.container} testID={`${testID ?? 'voice-composer'}-consent`}>
        <Text style={styles.cardTitle} accessibilityRole="header">Voice notes</Text>
        {lines.map(([icon, line]) => (
          <View key={icon} style={styles.consentRow}>
            <View style={styles.wash}>
              <Ionicons name={icon} size={22} color={fp.forest} />
            </View>
            <Text style={styles.consentText}>{line}</Text>
          </View>
        ))}
        <HapticPressable
          intent="medium"
          onPress={() => {
            setAgreed(true);
            consent.record();
            void start();
          }}
          accessibilityRole="button"
          accessibilityLabel="Record"
          testID="voice-composer-consent-record"
          style={[styles.secondaryAction, { flexDirection: 'row', gap: spacing.sm }]}
        >
          <Ionicons name="mic-outline" size={20} color={fp.onDeep} />
          <Text style={[styles.primaryLabel, { color: fp.onDeep }]}>Record</Text>
        </HapticPressable>
        <NotNow onPress={onClose} />
      </View>
    );
  }

  // ── Unavailable build ───────────────────────────────────────────────────────
  if (rec.status === 'unavailable') {
    return (
      <View
        style={styles.notice}
        accessibilityRole="text"
        testID={testID ?? 'voice-composer-unavailable'}
      >
        <SheetHeader onCancel={onClose} />
        <Ionicons
          name="mic-off-outline"
          size={22}
          color={semanticColors.textMuted}
        />
        <Text style={[styles.noticeText, { color: semanticColors.textMuted }]}>
          Voice recording isn’t available on this build yet. You can still send a
          written note.
        </Text>
      </View>
    );
  }

  // ── Mic permission denied — real recovery ───────────────────────────────────
  if (rec.status === 'denied') {
    return (
      <View
        style={styles.notice}
        accessibilityRole="text"
        testID={testID ?? 'voice-composer-denied'}
      >
        <View style={[styles.wash, { width: 80, height: 80 }]}>
          <Ionicons name="mic-off-outline" size={36} color={fp.forest} />
        </View>
        <Text style={[styles.noticeText, { color: semanticColors.textPrimary }]}>
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
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryLabel}>
            {rec.mustOpenSettings ? 'Open Settings' : 'Try again'}
          </Text>
        </HapticPressable>
        <NotNow onPress={onClose} />
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
        <SheetHeader
          onCancel={() => {
            rec.reset();
            onClose();
          }}
          discard
        />
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
          <HapticPressable
            intent="light"
            onPress={() => {
              onSend(recording);
              rec.reset();
            }}
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
      <SheetHeader title={title} onCancel={onClose} cancelLabel={live ? 'Cancel recording' : 'Cancel'} />
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
            <View key={i} style={[styles.level, { height: 8 + Math.round(v * 48) }]} />
          );
        })}
      </View>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.trackFill, { width: `${Math.min(1, rec.elapsedMs / rec.maxDurationMs) * 100}%` }]} />
      </View>
      <VoiceNoteRecordButton
        status={recordStatus}
        elapsedMs={rec.elapsedMs}
        maxDurationMs={rec.maxDurationMs}
        disabled={consent.loading}
        onStart={() => void start()}
        onStop={() => void rec.stop()}
      />
      <VoicePrivacyCopy target={target} />
    </View>
  );
}

function SheetHeader({
  onCancel,
  title,
  cancelLabel = 'Cancel',
  discard = false,
}: {
  onCancel: () => void;
  title: string;
  cancelLabel?: string;
  discard?: boolean;
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
          <Ionicons name="trash-outline" size={24} color={fp.ink} />
        ) : (
          <Text style={styles.cancel}>Cancel</Text>
        )}
      </HapticPressable>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      <View style={styles.headerAction} />
    </View>
  );
}

function NotNow({ onPress }: { onPress: () => void }): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Not now"
      testID="voice-composer-not-now"
      style={styles.quiet}
    >
      <Text style={[styles.primaryLabel, { color: fp.forest }]}>Not now</Text>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  notice: {
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  noticeText: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  header: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  cancel: { fontSize: 17, fontWeight: '500', color: fp.forest },
  title: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600', color: fp.ink },
  cardTitle: { fontSize: 24, lineHeight: 30, fontWeight: '600', color: fp.ink },
  timer: { fontFamily: typography.display.fontFamily, fontSize: 64, lineHeight: 80, color: fp.ink, textAlign: 'center' },
  hint: { fontSize: 16, lineHeight: 22, minHeight: 22, color: fp.n700, textAlign: 'center' },
  hintWarn: { color: fp.ink, fontWeight: '600' },
  levels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 56 },
  level: { width: 6, borderRadius: 3, backgroundColor: fp.leaf, borderWidth: 1, borderColor: fp.moss },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: voiceShades.hairline },
  track: { height: 4, borderRadius: 2, backgroundColor: voiceShades.hairline, overflow: 'hidden' },
  trackFill: { height: 4, backgroundColor: fp.forest },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  wash: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: voiceShades.leafWash, borderWidth: 1, borderColor: voiceShades.washEdge },
  consentText: { flex: 1, fontSize: 17, lineHeight: 24, color: fp.ink },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.md,
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
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { backgroundColor: fp.forest },
  outlined: { borderWidth: 1, borderColor: fp.forest, backgroundColor: fp.surface },
  primaryLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  quiet: { alignSelf: 'stretch', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
