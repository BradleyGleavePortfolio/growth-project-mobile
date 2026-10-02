/**
 * AiConsentSheet: the in-place "Allow AI help" choice (box 2 of the D2
 * consent) opened from an `ai_consent_required` refusal on a client AI
 * surface (Roman, AI Guide, AI wearable insights).
 *
 * It is the same choice as Settings > Privacy > Roman and AI, over the same
 * consent ledger routes (backend R2a #622, `src/api/aiConsentApi.ts`):
 *   GET  /me/ai-consent        current state + the server's own copy
 *   POST /me/ai-consent/roman  { version, copy_sha256, platform } (idempotent)
 *
 * Informed consent: the sheet shows the SERVER copy for the current version
 * (the AI paragraph and the box 2 label) and records that copy's sha256, so
 * the ledger stores exactly what was shown. Nothing is granted until the
 * person taps "Allow AI help"; "Not now" changes nothing. Every failure says
 * what happened and what to do next (owner rule 2026-10-01 13:34).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import defaultAiConsentApi, {
  isLiveGrant,
  type AiConsentStatusResponse,
} from '../../api/aiConsentApi';
import { shortReference } from '../../utils/correlation';
import { captureError } from '../../services/sentry';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';

export type AiConsentSheetApi = Pick<typeof defaultAiConsentApi, 'getStatus' | 'grantRoman'>;

export interface AiConsentSheetProps {
  visible: boolean;
  /** Called after a live grant is recorded (or found already in place). */
  onGranted: () => void;
  onClose: () => void;
  /** Opens the support path (for failures that need it). */
  onContactSupport?: () => void;
  /** Injected in tests. */
  api?: AiConsentSheetApi;
  testID?: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; status: AiConsentStatusResponse; paragraph: string; label: string }
  | { kind: 'saving'; status: AiConsentStatusResponse; paragraph: string; label: string }
  | { kind: 'already_on' }
  | { kind: 'unavailable' }
  | { kind: 'update_app' }
  | { kind: 'failed'; reference: string | null; during: 'load' | 'save' };

export const AI_CONSENT_SHEET_COPY = {
  title: 'Allow AI help',
  coachNote:
    'Your coach still sees your training information as usual. This choice only decides whether Roman and your coach’s AI tools can use it.',
  changeLater: 'You can change this later in Settings > Privacy.',
  allow: 'Allow AI help',
  notNow: 'Not now',
  alreadyOn: 'AI help is already on for your account. Try your request again.',
  unavailable:
    'This choice cannot be changed right now, so nothing has changed. Try again in a few minutes, or contact support if it keeps happening.',
  updateApp:
    'The wording for this choice has changed since this version of the app. Update the app from the App Store or Google Play, then allow AI help.',
  loadFailed: 'We could not load this choice, so nothing has changed. Check your connection and try again.',
  saveFailed: 'We could not save your choice, so AI help is still off. Check your connection and try again.',
  tryAgain: 'Try again',
  contactSupport: 'Contact support',
  close: 'Close',
} as const;

function platformTag(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

/** The copy to show, only when the server sent both parts for its current version. */
function serverCopyOf(status: AiConsentStatusResponse): { paragraph: string; label: string } | null {
  const c = status.copy;
  if (!c || c.version !== status.current_version) return null;
  const paragraph = c.paragraph?.text?.trim();
  const label = c.box_label?.text?.trim();
  return paragraph && label ? { paragraph, label } : null;
}

export default function AiConsentSheet({
  visible,
  onGranted,
  onClose,
  onContactSupport,
  api = defaultAiConsentApi,
  testID = 'ai-consent-sheet',
}: AiConsentSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    const out = await api.getStatus();
    if (!active.current) return;
    if (out.kind === 'unavailable') return setPhase({ kind: 'unavailable' });
    if (out.kind === 'version_mismatch') return setPhase({ kind: 'update_app' });
    if (out.kind === 'error' || !out.status) {
      const reference = out.kind === 'error' ? out.requestId ?? null : null;
      captureError(new Error('ai consent status load failed'), { reference });
      return setPhase({ kind: 'failed', reference, during: 'load' });
    }
    const status = out.status;
    if (isLiveGrant(status, status.current_version)) return setPhase({ kind: 'already_on' });
    const copy = serverCopyOf(status);
    if (!copy) {
      // A status without the wording for its current version cannot be
      // consented to honestly; never fall back to wording the server did
      // not send.
      captureError(new Error('ai consent status without current copy'), {
        version: status.current_version,
      });
      return setPhase({ kind: 'failed', reference: null, during: 'load' });
    }
    setPhase({ kind: 'ready', status, ...copy });
  }, [api]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const allow = useCallback(async () => {
    if (phase.kind !== 'ready') return;
    const { status } = phase;
    setPhase({ ...phase, kind: 'saving' });
    const out = await api.grantRoman({
      version: status.current_version,
      ...(status.copy?.sha256 ? { copy_sha256: status.copy.sha256 } : {}),
      platform: platformTag(),
    });
    if (!active.current) return;
    if (out.kind === 'ok') {
      // A reply without a readable status still means the POST succeeded
      // (idempotent grant); a readable one must show the live grant.
      if (out.status && !isLiveGrant(out.status, status.current_version)) {
        captureError(new Error('ai consent grant did not report a live grant'), {
          state: out.status.state,
        });
        return setPhase({ kind: 'failed', reference: null, during: 'save' });
      }
      onGranted();
      return;
    }
    if (out.kind === 'unavailable') return setPhase({ kind: 'unavailable' });
    if (out.kind === 'version_mismatch') return setPhase({ kind: 'update_app' });
    captureError(new Error('ai consent grant failed'), { status: out.status, code: out.code });
    setPhase({ kind: 'failed', reference: out.requestId ?? null, during: 'save' });
  }, [api, onGranted, phase]);

  const renderBody = () => {
    switch (phase.kind) {
      case 'loading':
        return (
          <View style={styles.center} testID={`${testID}-loading`}>
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading the AI help choice" />
          </View>
        );
      case 'ready':
      case 'saving': {
        const saving = phase.kind === 'saving';
        return (
          <>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Text style={styles.paragraph} testID={`${testID}-paragraph`}>
                {phase.paragraph}
              </Text>
              <Text style={styles.label} testID={`${testID}-label`}>
                {phase.label}
              </Text>
              <Text style={styles.note}>{AI_CONSENT_SHEET_COPY.coachNote}</Text>
              <Text style={styles.note}>{AI_CONSENT_SHEET_COPY.changeLater}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.primary, saving && styles.disabled]}
              onPress={allow}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={AI_CONSENT_SHEET_COPY.allow}
              accessibilityState={{ disabled: saving, busy: saving }}
              testID={`${testID}-allow`}
            >
              {saving ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryLabel}>{AI_CONSENT_SHEET_COPY.allow}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondary}
              onPress={onClose}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={AI_CONSENT_SHEET_COPY.notNow}
              testID={`${testID}-not-now`}
            >
              <Text style={styles.secondaryLabel}>{AI_CONSENT_SHEET_COPY.notNow}</Text>
            </TouchableOpacity>
          </>
        );
      }
      case 'already_on':
        return (
          <>
            <Text style={styles.message} accessibilityRole="alert" testID={`${testID}-already-on`}>
              {AI_CONSENT_SHEET_COPY.alreadyOn}
            </Text>
            <TouchableOpacity
              style={styles.primary}
              onPress={onGranted}
              accessibilityRole="button"
              accessibilityLabel={AI_CONSENT_SHEET_COPY.tryAgain}
              testID={`${testID}-retry-request`}
            >
              <Text style={styles.primaryLabel}>{AI_CONSENT_SHEET_COPY.tryAgain}</Text>
            </TouchableOpacity>
          </>
        );
      case 'update_app':
        return (
          <>
            <Text style={styles.message} accessibilityRole="alert" testID={`${testID}-update-app`}>
              {AI_CONSENT_SHEET_COPY.updateApp}
            </Text>
            <TouchableOpacity style={styles.secondary} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{AI_CONSENT_SHEET_COPY.close}</Text>
            </TouchableOpacity>
          </>
        );
      case 'unavailable':
      case 'failed': {
        const text =
          phase.kind === 'unavailable'
            ? AI_CONSENT_SHEET_COPY.unavailable
            : phase.during === 'load'
              ? AI_CONSENT_SHEET_COPY.loadFailed
              : AI_CONSENT_SHEET_COPY.saveFailed;
        const short = phase.kind === 'failed' ? shortReference(phase.reference) : null;
        return (
          <>
            <Text style={styles.message} accessibilityRole="alert" testID={`${testID}-${phase.kind}`}>
              {text}
            </Text>
            {short ? (
              <Text selectable style={styles.reference} testID={`${testID}-reference`}>
                {`Reference: ${short}`}
              </Text>
            ) : null}
            <TouchableOpacity
              style={styles.primary}
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel={AI_CONSENT_SHEET_COPY.tryAgain}
              testID={`${testID}-try-again`}
            >
              <Text style={styles.primaryLabel}>{AI_CONSENT_SHEET_COPY.tryAgain}</Text>
            </TouchableOpacity>
            {onContactSupport ? (
              <TouchableOpacity
                style={styles.secondary}
                onPress={onContactSupport}
                accessibilityRole="button"
                accessibilityLabel={AI_CONSENT_SHEET_COPY.contactSupport}
                testID={`${testID}-support`}
              >
                <Text style={styles.secondaryLabel}>{AI_CONSENT_SHEET_COPY.contactSupport}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondary} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{AI_CONSENT_SHEET_COPY.close}</Text>
            </TouchableOpacity>
          </>
        );
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID={testID} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {AI_CONSENT_SHEET_COPY.title}
          </Text>
          {renderBody()}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.surfaceElevated,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 32,
      maxHeight: '85%',
    },
    title: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
    center: { paddingVertical: 32, alignItems: 'center' },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: 8 },
    paragraph: { fontSize: 15, lineHeight: 22, color: colors.textPrimary, marginBottom: 12 },
    label: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
    note: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: 8 },
    message: { fontSize: 15, lineHeight: 22, color: colors.textPrimary, marginBottom: 12 },
    reference: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
    primary: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    primaryLabel: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600' },
    disabled: { opacity: 0.6 },
    secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    secondaryLabel: { color: colors.primary, fontSize: 15, fontWeight: '500' },
  });
}
