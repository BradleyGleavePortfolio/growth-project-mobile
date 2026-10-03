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
 *
 * One choice protocol with P0 and Settings (#310, Sol/Opus B-326-2): the
 * grant goes through `grantAiChoiceAs`, i.e. the one ledger queue, fenced by
 * the account that tapped Allow, and at its own turn it clears that account's
 * pending onboarding "no", so an older "no" can never undo this newer "yes".
 *
 * Truthful outcomes (Sol/Opus B-326-1): the request is retried only after a
 * VERIFIED live grant of the current version. A lost reply, a timeout, a 5xx,
 * a 409 conflict or an unreadable success may still have been written, so the
 * sheet re-reads GET /me/ai-consent once: live -> retry; definitively off ->
 * "still off"; still unknown -> "could not confirm", never "off". "Still
 * off" is said only when a 4xx refusal or the server's own status proves it.
 * Every unknown failure shows a reference that is also on the Sentry event
 * (B-326-4).
 *
 * Session fence (Sol B-326-2, round 3): every async step (the status load,
 * the grant, the reconciliation GET) belongs to the account that started it.
 * Before the reconciliation GET is sent, and after each await settles, the
 * sheet checks `sessionUserId() === uid`. When the session has moved on
 * (sign-out empties the user cache while authenticated screens are still
 * mounted, or another account signed in), a stale completion does nothing:
 * no `onGranted` (so the surface never retries the old account's request),
 * no phase change and no Sentry report. A grant that may already have been
 * written is never relabelled "nothing changed".
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
  type AiConsentOutcome,
  type AiConsentStatusResponse,
} from '../../api/aiConsentApi';
import {
  AI_LEDGER_NOT_SENT,
  grantAiChoiceAs,
  isAmbiguousWriteOutcome,
} from '../../lib/consultation/aiConsent';
import { readUserCacheSync } from '../../lib/userCache';
import { diagnosticReference, shortReference } from '../../utils/correlation';
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
  /** The signed-in user right now (identity fence of the ledger queue). */
  sessionUserId?: () => string | null;
  testID?: string;
}

const defaultSessionUserId = () => readUserCacheSync()?.id ?? null;

interface ReadyCopy {
  status: AiConsentStatusResponse;
  paragraph: string;
  label: string;
  /** An older version was allowed and the wording changed (C-326-2). */
  reconsent: boolean;
}

type Phase =
  | { kind: 'loading' }
  | ({ kind: 'ready' } & ReadyCopy)
  | ({ kind: 'saving' } & ReadyCopy)
  | { kind: 'checking' }
  | { kind: 'already_on' }
  | { kind: 'unavailable' }
  | { kind: 'update_app' }
  | { kind: 'not_sent' }
  /** The grant may or may not be on file; never described as off. */
  | { kind: 'unconfirmed'; reference: string }
  | { kind: 'failed'; reference: string; during: 'load' | 'save' };

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
  saveFailed:
    'We could not save your choice, so AI help is still off. Try again, or contact support and share the reference below.',
  unconfirmed:
    'We could not confirm your choice, so it may or may not be saved. Try again to check, or see Settings > Privacy.',
  checking: 'Checking whether your choice was saved',
  reconsent: 'The AI help wording changed, so it needs your OK again.',
  notSent:
    'You were signed out before this choice was saved, so nothing changed. Sign in and choose again.',
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
  sessionUserId = defaultSessionUserId,
  testID = 'ai-consent-sheet',
}: AiConsentSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const active = useRef(true);
  /** The account whose status the sheet is showing (set by `load`). */
  const loadedFor = useRef<string | null>(null);
  // Read through a ref so a caller's inline getter never re-triggers the load effect.
  const sessionRef = useRef(sessionUserId);
  sessionRef.current = sessionUserId;
  /** True while the account that started an async step is still signed in. */
  const isSession = useCallback((uid: string | null) => sessionRef.current() === uid, []);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  /** Report an unknown failure once and return the reference to show (B-326-4). */
  const reportUnknown = useCallback((what: string, ref: string | null | undefined, extra: Record<string, unknown> = {}) => {
    const reference = diagnosticReference(ref);
    captureError(new Error(what), { surface: 'ai_consent_sheet', reference, ...extra });
    return reference;
  }, []);

  const readyFrom = useCallback(
    (status: AiConsentStatusResponse): Phase => {
      const copy = serverCopyOf(status);
      if (!copy) {
        // A status without the wording for its current version cannot be
        // consented to honestly; never fall back to wording the server did
        // not send.
        const reference = reportUnknown('ai consent status without current copy', null, {
          version: status.current_version,
        });
        return { kind: 'failed', reference, during: 'load' };
      }
      return { kind: 'ready', status, ...copy, reconsent: status.state === 'needs_reconsent' || status.needs_reconsent };
    },
    [reportUnknown],
  );

  const load = useCallback(async () => {
    const uid = sessionRef.current();
    loadedFor.current = uid;
    setPhase({ kind: 'loading' });
    const out = await api.getStatus();
    // Stale: the sheet closed, or the session that asked has ended.
    if (!active.current || !isSession(uid)) return;
    if (out.kind === 'unavailable') return setPhase({ kind: 'unavailable' });
    if (out.kind === 'version_mismatch') return setPhase({ kind: 'update_app' });
    if (out.kind === 'error' || !out.status) {
      const reference = reportUnknown('ai consent status load failed', out.kind === 'error' ? out.requestId : null, {
        status: out.kind === 'error' ? out.status : 200,
      });
      return setPhase({ kind: 'failed', reference, during: 'load' });
    }
    const status = out.status;
    if (isLiveGrant(status, status.current_version)) return setPhase({ kind: 'already_on' });
    setPhase(readyFrom(status));
  }, [api, isSession, readyFrom, reportUnknown]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  /**
   * The grant may have been written but was not confirmed: read the ledger
   * once. Live grant -> retry the request. The server's own status says off
   * -> "still off" (or the new wording, when it changed). Still unknown ->
   * "could not confirm".
   */
  const reconcile = useCallback(
    async (uid: string, sentVersion: string, firstRef: string | null | undefined) => {
      // Never read the ledger under another session, and never act on it.
      if (!active.current || !isSession(uid)) return;
      setPhase({ kind: 'checking' });
      const check = await api.getStatus();
      if (!active.current || !isSession(uid)) return;
      if (check.kind === 'ok' && check.status) {
        const st = check.status;
        if (isLiveGrant(st, st.current_version)) {
          onGranted();
          return;
        }
        if (st.current_version !== sentVersion) {
          // The wording changed under the request: show the new wording.
          setPhase(readyFrom({ ...st, needs_reconsent: true }));
          return;
        }
        const reference = reportUnknown('ai consent grant not on file after an unconfirmed write', firstRef, {
          state: st.state,
        });
        setPhase({ kind: 'failed', reference, during: 'save' });
        return;
      }
      const reference = reportUnknown('ai consent grant could not be confirmed', firstRef ?? (check.kind === 'error' ? check.requestId : null), {
        check: check.kind,
      });
      setPhase({ kind: 'unconfirmed', reference });
    },
    [api, isSession, onGranted, readyFrom, reportUnknown],
  );

  const allow = useCallback(async () => {
    if (phase.kind !== 'ready') return;
    const { status } = phase;
    const version = status.current_version;
    const uid = sessionUserId();
    // The choice belongs to the account whose wording is on screen: if that
    // account is no longer the signed-in one, nothing is sent.
    if (loadedFor.current !== null && uid !== loadedFor.current) return setPhase({ kind: 'not_sent' });
    setPhase({ ...phase, kind: 'saving' });
    const out: AiConsentOutcome | typeof AI_LEDGER_NOT_SENT = await grantAiChoiceAs(uid, sessionUserId, () =>
      api.grantRoman({
        version,
        ...(status.copy?.sha256 ? { copy_sha256: status.copy.sha256 } : {}),
        platform: platformTag(),
      }),
    );
    if (!active.current) return;
    // Nothing went out (the account changed before the write's turn): true to say so.
    if (out === AI_LEDGER_NOT_SENT) return setPhase({ kind: 'not_sent' });
    // The grant was sent, but the session that asked has ended while it was
    // in flight: a stale completion does nothing (no retry, no state).
    if (!uid || !isSession(uid)) return;
    if (out.kind === 'ok' && isLiveGrant(out.status, version)) {
      onGranted();
      return;
    }
    if (out.kind === 'unavailable') return setPhase({ kind: 'unavailable' });
    if (out.kind === 'version_mismatch') return setPhase({ kind: 'update_app' });
    if (out.kind === 'error' && !isAmbiguousWriteOutcome(out)) {
      // A 4xx refusal is answered before anything is written: still off.
      const reference = reportUnknown('ai consent grant refused', out.requestId, { status: out.status, code: out.code });
      return setPhase({ kind: 'failed', reference, during: 'save' });
    }
    // Possibly written: no reply, 408/409/5xx, or a success without a
    // readable live grant (null or other status).
    await reconcile(uid, version, out.kind === 'error' ? out.requestId : null);
  }, [api, isSession, onGranted, phase, reconcile, reportUnknown, sessionUserId]);

  /** "Already on" retries only for the account whose status was shown. */
  const retryAlreadyOn = useCallback(() => {
    if (isSession(loadedFor.current)) onGranted();
  }, [isSession, onGranted]);

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
              {phase.reconsent ? (
                <Text style={styles.note} testID={`${testID}-reconsent`}>
                  {AI_CONSENT_SHEET_COPY.reconsent}
                </Text>
              ) : null}
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
              onPress={() => void allow()}
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
              onPress={retryAlreadyOn}
              accessibilityRole="button"
              accessibilityLabel={AI_CONSENT_SHEET_COPY.tryAgain}
              testID={`${testID}-retry-request`}
            >
              <Text style={styles.primaryLabel}>{AI_CONSENT_SHEET_COPY.tryAgain}</Text>
            </TouchableOpacity>
          </>
        );
      case 'checking':
        return (
          <View style={styles.center} testID={`${testID}-checking`}>
            <ActivityIndicator color={colors.primary} accessibilityLabel={AI_CONSENT_SHEET_COPY.checking} />
          </View>
        );
      case 'not_sent':
        return (
          <>
            <Text style={styles.message} accessibilityRole="alert" testID={`${testID}-not-sent`}>
              {AI_CONSENT_SHEET_COPY.notSent}
            </Text>
            <TouchableOpacity style={styles.secondary} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{AI_CONSENT_SHEET_COPY.close}</Text>
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
      case 'unconfirmed':
      case 'failed': {
        const text =
          phase.kind === 'unavailable'
            ? AI_CONSENT_SHEET_COPY.unavailable
            : phase.kind === 'unconfirmed'
              ? AI_CONSENT_SHEET_COPY.unconfirmed
              : phase.during === 'load'
                ? AI_CONSENT_SHEET_COPY.loadFailed
                : AI_CONSENT_SHEET_COPY.saveFailed;
        const short = phase.kind === 'unavailable' ? null : shortReference(phase.reference);
        // "Try again to check" re-reads the ledger; it never re-sends a write.
        const retry = () => void load();
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
              onPress={retry}
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
