/**
 * VoiceNoteComposer — the v3-3 record→review→send surface, embedded by the
 * community composer screen when the user picks the voice mode. It orchestrates
 * the recorder hook (capture) and the upload hook (the two-hop publish), and
 * composes the smaller presentational pieces (record button, waveform, privacy
 * copy). It owns NO transport logic of its own — it is the glue.
 *
 * States it renders honestly (no dead controls, no lies about capability):
 *   - unavailable → a calm "voice recording isn't available on this build"
 *     notice (the native recorder is not bundled yet); no record button.
 *   - denied      → a REAL mic-permission recovery state: a "try again" action,
 *     and when the OS will no longer prompt, an "Open Settings" deep-link
 *     instead of a no-op button (audit req — denial needs real recovery).
 *   - idle        → the privacy disclosure + the record button.
 *   - recording   → the live record/stop button (elapsed + cap).
 *   - recorded    → a waveform preview + duration, a "Re-record" reset, and a
 *     "Send" that runs the publish pipeline. A publish failure preserves the
 *     recording so "Send" can be retried without re-recording.
 *
 * The audience disclosure (VoicePrivacyCopy) renders the REAL target audience
 * (DM recipient / named cohort / community), computed from the props.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import {
  useVoiceUpload,
  type VoiceUploadInput,
} from '../../hooks/useVoiceUpload';
import type { VoiceRecorderPort } from '../../hooks/voiceRecorderPort';
import VoiceNoteRecordButton from './VoiceNoteRecordButton';
import VoiceNoteWaveform from './VoiceNoteWaveform';
import VoicePrivacyCopy, { type VoiceAudienceTarget } from './VoicePrivacyCopy';
import { formatDuration } from './voiceFormat';

export interface VoiceNoteComposerProps {
  /** Workspace the note is published into (null disables Send). */
  workspaceId: string | null;
  /** The concrete send target → drives the audience disclosure + routing. */
  target: VoiceAudienceTarget;
  /** Optional cohort id when target.kind === 'cohort'. */
  cohortId?: string;
  /** Optional conversation id when target.kind === 'dm'. */
  conversationId?: string;
  /** Fired after a note is published, so the screen can pop / confirm. */
  onPublished?: () => void;
  /** Inject a recorder port for tests; defaults to the resolved adapter. */
  recorder?: VoiceRecorderPort;
  /** Inject a byte reader for tests (passed through to the upload hook). */
  readBytes?: (uri: string) => Promise<ArrayBuffer>;
  testID?: string;
}

export default function VoiceNoteComposer({
  workspaceId,
  target,
  cohortId,
  conversationId,
  onPublished,
  recorder,
  readBytes,
  testID,
}: VoiceNoteComposerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const rec = useVoiceRecorder(recorder ? { recorder } : {});
  const upload = useVoiceUpload(workspaceId, readBytes ? { readBytes } : {});

  const send = useCallback(() => {
    if (!rec.recording || !workspaceId) return;
    const input: VoiceUploadInput = {
      uri: rec.recording.uri,
      durationMs: rec.recording.durationMs,
      bytes: rec.recording.bytes,
      mimeType: rec.recording.mimeType,
      ...(cohortId ? { cohortId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    upload.mutate(input, {
      onSuccess: () => {
        rec.reset();
        onPublished?.();
      },
    });
  }, [cohortId, conversationId, onPublished, rec, upload, workspaceId]);

  const recordStatus = useMemo<'idle' | 'recording' | 'stopping'>(() => {
    if (rec.status === 'recording') return 'recording';
    if (rec.status === 'stopping') return 'stopping';
    return 'idle';
  }, [rec.status]);

  // ── Unavailable build ───────────────────────────────────────────────────────
  if (rec.status === 'unavailable') {
    return (
      <View
        style={styles.notice}
        accessibilityRole="text"
        testID={testID ?? 'voice-composer-unavailable'}
      >
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
        <Ionicons
          name="lock-closed-outline"
          size={22}
          color={semanticColors.accentText}
        />
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
          style={[
            styles.secondaryAction,
            { borderColor: semanticColors.border },
          ]}
        >
          <Text
            style={[styles.secondaryLabel, { color: semanticColors.accentText }]}
          >
            {rec.mustOpenSettings ? 'Open Settings' : 'Try again'}
          </Text>
        </HapticPressable>
      </View>
    );
  }

  // ── Recorded — review + send ────────────────────────────────────────────────
  if (rec.status === 'recorded' && rec.recording) {
    const sending = upload.isPending;
    const failed = upload.isError;
    return (
      <View style={styles.container} testID={testID ?? 'voice-composer-review'}>
        <VoicePrivacyCopy target={target} />

        <View
          style={[
            styles.previewRow,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
        >
          <View style={styles.previewWave}>
            <VoiceNoteWaveform peaks={rec.recording.peaks} height={32} />
          </View>
          <Text
            style={[styles.previewDuration, { color: semanticColors.textMuted }]}
            accessibilityLabel={`Recorded ${formatDuration(rec.recording.durationMs)}`}
            testID="voice-composer-preview-duration"
          >
            {formatDuration(rec.recording.durationMs)}
          </Text>
        </View>

        {failed ? (
          <Text
            style={[styles.errorText, { color: semanticColors.accentText }]}
            accessibilityRole="text"
            testID="voice-composer-send-error"
          >
            That didn’t send. Your recording is safe — try sending again.
          </Text>
        ) : null}

        <View style={styles.reviewActions}>
          <HapticPressable
            intent="light"
            onPress={() => rec.reset()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel="Discard and record again"
            accessibilityState={{ disabled: sending }}
            testID="voice-composer-rerecord"
            style={[
              styles.secondaryAction,
              { borderColor: semanticColors.border },
            ]}
          >
            <Text
              style={[styles.secondaryLabel, { color: semanticColors.textMuted }]}
            >
              Re-record
            </Text>
          </HapticPressable>

          <HapticPressable
            intent="success"
            onPress={send}
            disabled={sending || !workspaceId}
            accessibilityRole="button"
            accessibilityLabel={failed ? 'Try sending the voice note again' : 'Send voice note'}
            accessibilityState={{ disabled: sending || !workspaceId, busy: sending }}
            testID="voice-composer-send"
            style={[
              styles.primaryAction,
              {
                backgroundColor:
                  sending || !workspaceId
                    ? semanticColors.disabledBg
                    : semanticColors.accent,
              },
            ]}
          >
            <Text
              style={[
                styles.primaryLabel,
                {
                  color:
                    sending || !workspaceId
                      ? semanticColors.textOnDisabled
                      : semanticColors.textOnAccent,
                },
              ]}
            >
              {sending ? 'Sending…' : failed ? 'Try again' : 'Send'}
            </Text>
          </HapticPressable>
        </View>
      </View>
    );
  }

  // ── Idle / recording — capture ──────────────────────────────────────────────
  return (
    <View style={styles.container} testID={testID ?? 'voice-composer'}>
      <VoicePrivacyCopy target={target} />
      <VoiceNoteRecordButton
        status={recordStatus}
        elapsedMs={rec.elapsedMs}
        maxDurationMs={rec.maxDurationMs}
        onStart={() => void rec.start()}
        onStop={() => void rec.stop()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  notice: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewWave: { flex: 1 },
  previewDuration: {
    fontSize: 13,
    fontWeight: '500',
    minWidth: 40,
    textAlign: 'right',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  secondaryAction: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  primaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
