/**
 * ConnectProviderSheet — bottom sheet that authorizes ONE wearable provider.
 *
 * UX bible (Agent 1 §3.6 Provider OAuth Sheet): a single-purpose sheet with a
 * provider brand header, a one-line plain-language statement of what data we'll
 * read, and one primary action — Continue. Contextual permission: this is only
 * ever reached when the user has chosen to connect, never front-loaded.
 *
 * Two fully-implemented connect flows, branched on the provider's auth model:
 *
 *   • Cloud OAuth (Oura, WHOOP, Garmin, Fitbit, Strava, …): Continue calls
 *     `POST /v1/wearables/connections/oauth/start` to mint the authorization
 *     URL + CSRF state, then opens it via `WebBrowser.openAuthSessionAsync`.
 *     The provider redirects to the SERVER callback (which carries the JWT and
 *     completes the token exchange + connection upsert server-side); when the
 *     auth session returns we invalidate the connections cache so the hub
 *     re-reads the new status. We do NOT handle tokens client-side (#1/#12).
 *
 *   • On-device (Apple HealthKit, Health Connect, Samsung Health): there is no
 *     server OAuth round-trip — the user grants access through the platform's
 *     native permission UI. Continue drives the real native permission request
 *     via `connectOnDeviceProvider` (the single native seam), then re-reads the
 *     connection list so the hub reflects the granted state. Every outcome —
 *     granted, denied, store-not-installed, or unsupported-on-this-platform —
 *     renders an explicit, polished state; there is no placeholder and no
 *     silent failure.
 *
 * Built on React Native's `Modal` with a slide-up sheet container (the repo has
 * no `@gorhom/bottom-sheet` dependency, and PR-HK-1-mobile must not add deps —
 * CFG owns package.json). The presentation is sheet-like (bottom-anchored,
 * rounded top, dim scrim, swipe-to-dismiss affordance via the grabber + scrim
 * tap) to satisfy the BottomSheet intent without a new dependency.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  configFor,
  isOnDeviceProvider,
  type WearableProvider,
} from '../../../api/wearablesConnectionsApi';
import {
  useInvalidateWearableConnections,
  useStartOauth,
} from '../../../hooks/useWearableConnections';
import {
  connectOnDeviceProvider,
  openHealthConnectPermissions,
  openHealthConnectStore,
} from '../../../services/health/onDeviceConnect';
import { signOut } from '../../../services/authActions';
import {
  beginOnDeviceConnect,
  connectOnDevice,
  deviceSourceFor,
  resumeOnDeviceImport,
  type OnDeviceImportOutcome,
  type OnDeviceSource,
} from '../../../services/health/onDeviceSync';
import {
  currentAuthGeneration,
  OnDeviceSessionChangedError,
  type SessionFence,
} from '../../../services/health/sessionFence';
import {
  cloudConnectFailureMessage,
  cloudSessionLockedMessage,
  connectFailureMessage,
  ctaLabelFor,
  emptyImportMessage,
  INGEST_DISABLED_COPY,
  partialImportMessage,
  permissionOutcomeMessage,
  returnFromSettingsMessage,
  settingsDidNotOpenMessage,
  type OnDeviceMessage,
} from './onDeviceCopy';
import {
  HEALTH_CONNECT_DISABLED_MESSAGE,
  isHealthConnectProviderDisabled,
} from '../../../config/healthConnect';
import { colors, radius, spacing, typography, withAlpha } from '../../../theme/tokens';
import { emitTutorialSignal } from '../../../tutorial/tutorialEvents';

/**
 * The auth-session return URL. The backend server callback completes the OAuth
 * exchange, then redirects the in-app browser to this app-scheme deep link,
 * which closes the auth session and hands control back to this sheet. The
 * scheme (`tgp://`) is the app's registered scheme (see RootNavigator linking).
 */
const RETURN_URL = 'tgp://wearables/connected';

export interface ConnectProviderSheetProps {
  /** The provider to connect, or null when the sheet is closed. */
  provider: WearableProvider | null;
  /** Whether the sheet is visible. */
  visible: boolean;
  /** Called to dismiss the sheet (scrim tap, grabber, cancel, or completion). */
  onClose: () => void;
  /**
   * Called after a connect flow returns (success or dismissed) so the parent
   * can react — typically a no-op because the cache is already invalidated
   * here, but exposed for the parent to close the sheet / show a toast.
   */
  onConnected?: () => void;
}

/**
 * Bottom-sheet authorize flow for a single provider. Renders nothing when no
 * provider is selected.
 */
export default function ConnectProviderSheet({
  provider,
  visible,
  onClose,
  onConnected,
}: ConnectProviderSheetProps) {
  const startOauth = useStartOauth();
  const invalidate = useInvalidateWearableConnections();
  const [error, setError] = useState<string | null>(null);
  /**
   * What the primary button does after an on-device message: start Connect
   * again, continue an incomplete import (Sol B-317-2), or nothing (the
   * button is hidden and the person closes the sheet).
   */
  const [retry, setRetry] = useState<OnDeviceMessage['action']>('connect');
  const [ctaOverride, setCtaOverride] = useState<string | undefined>(undefined);
  const [resumeTarget, setResumeTarget] = useState<{
    source: OnDeviceSource;
    connectionId: string;
    partial: boolean;
  } | null>(null);
  const [requestingOnDevice, setRequestingOnDevice] = useState(false);
  const [importing, setImporting] = useState(false);

  /**
   * S14 round 3 (Sol A-317-1): the session fence for the current on-device
   * Connect run. Created on the Continue tap BEFORE the native permission
   * prompt, so the run stays bound to the person who tapped; cancelled when
   * the sheet closes or unmounts, so a late continuation never adopts
   * whoever is signed in by then.
   */
  const attemptRef = useRef<SessionFence | null>(null);
  /**
   * S-WEAR-3 (Sol B-317-6): synchronous attempt epoch. Bumped on every
   * Continue tap and, synchronously, on close, provider change and unmount.
   * A Connect run captures it BEFORE its first await and goes on only while
   * it is unchanged, so closing the sheet while the signed-in person is
   * still being read (before any fence exists) stops the run too: no
   * permission prompt, registration, local grant or phone read.
   */
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      attemptRef.current?.cancel();
      attemptRef.current = null;
    };
  }, []);
  useEffect(() => {
    // Closing the sheet (or switching provider) ends the run and its state.
    epochRef.current += 1;
    attemptRef.current?.cancel();
    attemptRef.current = null;
    setError(null);
    setRetry('connect');
    setCtaOverride(undefined);
    setResumeTarget(null);
    // B-317-11: busy state belongs to the attempt; a run that is still
    // settling for the previous sheet never keeps this one disabled.
    setImporting(false);
    setRequestingOnDevice(false);
  }, [visible, provider]);

  /**
   * B-317-11: an on-device attempt is current only while this sheet is
   * mounted, still on the epoch it started on (close, provider change,
   * unmount and a new Continue all move it) and still holds the attempt's
   * fence. Every continuation after an await asks this before any visible
   * effect, Sentry report or busy-state write.
   */
  const isCurrentAttempt = useCallback(
    (epoch: number, fence: SessionFence | null) =>
      mountedRef.current && epochRef.current === epoch && attemptRef.current === fence,
    [],
  );

  const onDevice = provider != null && isOnDeviceProvider(provider);
  const config = provider != null ? configFor(provider) : null;
  const buildDisabled =
    provider != null && isHealthConnectProviderDisabled(provider);

  const showMessage = useCallback((message: OnDeviceMessage | null) => {
    if (!mountedRef.current || message == null) return;
    setError(message.text);
    setRetry(message.action);
    setCtaOverride(message.cta);
  }, []);

  const handleCloudConnect = useCallback(
    async (target: WearableProvider, epoch: number) => {
      const name = configFor(target).displayName;
      // Sol B-317-10: the attempt is live only while this sheet is mounted and
      // showing this attempt (the epoch moves on close, provider change,
      // unmount and a new Continue) AND nobody has signed out or switched
      // account since the tap (sign-out bumps the auth generation first,
      // synchronously). Captured before the first await.
      const generation = currentAuthGeneration();
      const sameSession = () => currentAuthGeneration() === generation;
      const current = () => mountedRef.current && epochRef.current === epoch && sameSession();
      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        const { authorizationUrl } = await startOauth.mutateAsync(target);
        if (!current()) return; // sheet closed while the link was minted
        // Open the provider authorization URL in an in-app auth session. The
        // server callback completes the exchange; the session closes when the
        // server redirects back to RETURN_URL (or the user dismisses it).
        result = await WebBrowser.openAuthSessionAsync(authorizationUrl, RETURN_URL);
      } catch (err) {
        // Sol B-317-8: map the status and machine code, never one generic line.
        if (current()) showMessage(cloudConnectFailureMessage(err, name));
        return;
      }
      if (!current()) {
        // A stale completion (sheet closed, replaced or unmounted while the
        // browser was open) never announces, connects or closes anything. In
        // the same session the authoritative list is still re-read, because
        // the server may have finished the connection.
        if (sameSession()) invalidate();
        return;
      }
      if (result.type === 'locked') {
        showMessage(cloudSessionLockedMessage(name));
        return;
      }
      // Regardless of success/dismiss, re-read the authoritative connection
      // list — the server may have completed the connection even if the
      // in-app session reported a dismiss (e.g. redirect handled out-of-band).
      invalidate();
      // Clinic tutorial: only an explicit success counts as connected; a
      // dismiss is confirmed (or not) by the re-read connections list.
      if (result.type === 'success') emitTutorialSignal('wearable_connected');
      if (result.type === 'success' || result.type === 'dismiss') {
        onConnected?.();
        onClose();
      }
    },
    [startOauth, invalidate, onConnected, onClose, showMessage],
  );

  /**
   * Act on an import outcome. Only a COMPLETE import closes the sheet as a
   * success; an incomplete one keeps the sheet open with a truthful message
   * and a working Continue import / Try again action (Sol B-317-2).
   */
  const handleImportOutcome = useCallback(
    (outcome: OnDeviceImportOutcome, name: string, target: WearableProvider, firstRun: boolean) => {
      invalidate();
      if (!mountedRef.current) return;
      if (outcome.kind === 'disabled') {
        showMessage({ text: INGEST_DISABLED_COPY, action: 'none' });
        return;
      }
      if (outcome.kind === 'not_authorized') {
        setResumeTarget(null);
        showMessage({
          text: `This phone is no longer set up to sync ${name} for your account. Tap Continue to connect ${name} again.`,
          action: 'connect',
        });
        return;
      }
      if (!outcome.complete) {
        setResumeTarget({
          source: outcome.source,
          connectionId: outcome.connectionId,
          partial: outcome.postedCount > 0,
        });
        emitTutorialSignal('wearable_connected');
        showMessage(partialImportMessage(name, outcome));
        return;
      }
      setResumeTarget(null);
      emitTutorialSignal('wearable_connected');
      if (firstRun && outcome.postedCount === 0) {
        // Connected, nothing to bring in (S-WEAR-3): say so and where to check,
        // instead of closing as if data had arrived.
        onConnected?.();
        showMessage(emptyImportMessage(target, name));
        return;
      }
      onConnected?.();
      onClose();
    },
    [invalidate, onConnected, onClose, showMessage],
  );

  const runImport = useCallback(
    async (
      name: string,
      target: WearableProvider,
      firstRun: boolean,
      run: () => Promise<OnDeviceImportOutcome>,
      epoch: number,
      fence: SessionFence,
    ) => {
      // B-317-11: the import belongs to the attempt that started it. The
      // sheet stays mounted across close and reopen (ConnectionsScreen only
      // changes visible / provider), so a mount check alone would let a late
      // import act on the NEXT sheet. Captured before the first await.
      const generation = currentAuthGeneration();
      const current = () => isCurrentAttempt(epoch, fence);
      const staleSettled = () => {
        // The phone may have sent data before the close: in the same session
        // the authoritative list is still re-read. Nothing else happens: no
        // success signal, onConnected, close, message or Sentry report.
        if (currentAuthGeneration() === generation) invalidate();
      };
      if (current()) setImporting(true);
      try {
        const outcome = await run();
        if (!current() || currentAuthGeneration() !== generation) {
          // Closed, replaced or unmounted meanwhile, or the session ended or
          // switched while the last pass finished: no success is announced.
          staleSettled();
          return;
        }
        handleImportOutcome(outcome, name, target, firstRun);
      } catch (err) {
        if (!current()) {
          staleSettled();
          return;
        }
        if (currentAuthGeneration() !== generation) {
          // Still this sheet, but the session ended or switched while the
          // import ran: the session-change copy, no re-read for the next
          // person and no Sentry report for a failure the stop caused.
          showMessage(connectFailureMessage(new OnDeviceSessionChangedError(), name));
          return;
        }
        invalidate();
        // The failure copy (and its Sentry report) is built only for the
        // current attempt.
        showMessage(connectFailureMessage(err, name));
      } finally {
        if (current()) setImporting(false);
      }
    },
    [handleImportOutcome, invalidate, isCurrentAttempt, showMessage],
  );

  const handleOnDeviceConnect = useCallback(
    async (target: WearableProvider, epoch: number) => {
      const name = configFor(target).displayName;
      // Sol B-317-6: the attempt is live only while the sheet is mounted,
      // visible and showing this provider (the epoch moves on any of those).
      const current = () => mountedRef.current && epochRef.current === epoch;
      // Bind the run to the person who tapped, BEFORE the native prompt.
      let fence: SessionFence;
      try {
        fence = await beginOnDeviceConnect();
      } catch (err) {
        if (current()) showMessage(connectFailureMessage(err, name));
        return;
      }
      if (!current()) {
        // Closed while the signed-in person was being read: discard the late
        // fence; nothing is prompted, registered, recorded or read.
        fence.cancel();
        return;
      }
      attemptRef.current?.cancel();
      attemptRef.current = fence;
      try {
        // Sign-out may already have begun (it stops every fence at once).
        fence.throwIfStopped();
      } catch (err) {
        showMessage(connectFailureMessage(err, name));
        return;
      }

      // Sol B-317-9: native setup (availability, initialization) awaits before
      // the permission screen; the helper asks this after each of those awaits
      // and right before the screen opens, so a close, unmount, provider
      // change or sign-out during setup opens no new prompt.
      const live = (): boolean => {
        if (attemptRef.current !== fence || !current()) return false;
        try {
          fence.throwIfStopped();
          return true;
        } catch {
          return false;
        }
      };
      const outcome = await connectOnDeviceProvider(target, live);
      if (attemptRef.current !== fence || !current()) return; // sheet closed meanwhile
      if (outcome === 'stopped') {
        // Still this sheet, so the session moved during setup: say so (the
        // same copy as a session change after the prompt). No prompt opened.
        try {
          fence.throwIfStopped();
        } catch (err) {
          showMessage(connectFailureMessage(err, name));
        }
        return;
      }
      switch (outcome) {
        case 'disabled':
          showMessage({ text: HEALTH_CONNECT_DISABLED_MESSAGE, action: 'none' });
          return;
        case 'granted': {
          // S14: permission granted on-device. Register the device source,
          // record the tapping person's local authorization for this phone,
          // and import the last 30 days so the Health and Sleep views show
          // real data. connectOnDevice re-checks the fence before every step.
          const source = deviceSourceFor(target);
          if (source == null) {
            showMessage(permissionOutcomeMessage('unsupported', target, name));
            return;
          }
          await runImport(name, target, true, () => connectOnDevice(source, fence), epoch, fence);
          return;
        }
        default:
          showMessage(permissionOutcomeMessage(outcome, target, name));
      }
    },
    [runImport, showMessage],
  );

  /** Open Health Connect permissions or its Play Store page (S-WEAR-3). */
  const handleOpenExternal = useCallback(
    async (kind: 'settings' | 'store', name: string) => {
      // C-317-c: the message is for the sheet that asked; a close, provider
      // change or unmount while the settings or store app opens drops it.
      const epoch = epochRef.current;
      const opened =
        kind === 'settings' ? await openHealthConnectPermissions() : await openHealthConnectStore();
      if (!mountedRef.current || epochRef.current !== epoch) return;
      showMessage(opened ? returnFromSettingsMessage(name) : settingsDidNotOpenMessage(kind, name));
    },
    [showMessage],
  );

  const handleResume = useCallback(async () => {
    if (provider == null || resumeTarget == null) return;
    const name = configFor(provider).displayName;
    const fence = attemptRef.current;
    if (fence == null) {
      showMessage({
        text: `Tap Continue to connect ${name} again.`,
        action: 'connect',
      });
      return;
    }
    // B-317-11: a resume continues the current attempt (same epoch and
    // fence), captured synchronously before the first await.
    const epoch = epochRef.current;
    setError(null);
    setRequestingOnDevice(true);
    try {
      await runImport(
        name,
        provider,
        false,
        () => resumeOnDeviceImport(resumeTarget.source, resumeTarget.connectionId, fence),
        epoch,
        fence,
      );
    } finally {
      if (isCurrentAttempt(epoch, fence)) setRequestingOnDevice(false);
    }
  }, [provider, resumeTarget, runImport, showMessage, isCurrentAttempt]);

  const handleContinue = useCallback(async () => {
    if (provider == null) return;
    const name = configFor(provider).displayName;
    if (isHealthConnectProviderDisabled(provider)) {
      setError(HEALTH_CONNECT_DISABLED_MESSAGE);
      setRetry('none');
      return;
    }
    if (retry === 'resume' && resumeTarget != null) {
      await handleResume();
      return;
    }
    if (retry === 'login') {
      // The session ended: sign out cleanly so the person lands on Log in.
      onClose();
      await signOut();
      return;
    }
    if (retry === 'open_settings' || retry === 'open_store') {
      await handleOpenExternal(retry === 'open_settings' ? 'settings' : 'store', name);
      return;
    }
    // A new attempt: bump the epoch synchronously, before any await.
    epochRef.current += 1;
    const epoch = epochRef.current;
    setError(null);
    setRetry('connect');
    setCtaOverride(undefined);
    setResumeTarget(null);

    setRequestingOnDevice(true);
    try {
      if (isOnDeviceProvider(provider)) {
        await handleOnDeviceConnect(provider, epoch);
      } else {
        await handleCloudConnect(provider, epoch);
      }
    } finally {
      // B-317-11: only this attempt's own sheet is un-busied; a close or
      // provider change already reset it for the next one.
      if (mountedRef.current && epochRef.current === epoch) setRequestingOnDevice(false);
    }
  }, [
    provider,
    retry,
    resumeTarget,
    handleResume,
    handleOpenExternal,
    handleOnDeviceConnect,
    handleCloudConnect,
    onClose,
  ]);

  const ctaLabel =
    retry === 'resume' && resumeTarget != null
      ? resumeTarget.partial
        ? 'Continue import'
        : 'Try again'
      : ctaLabelFor({ action: retry, cta: ctaOverride });
  const showCta = !buildDisabled && retry !== 'none';
  // B-317-11: the attempt's own busy flag (set for cloud and on-device
  // attempts alike). The shared mint mutation's isPending is not used: a
  // mint still pending for a closed sheet must not disable the next one.
  const continuing = requestingOnDevice;

  return (
    <Modal
      visible={visible && provider != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.scrim}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onClose}
      >
        {/* Inner pressable stops scrim taps from closing when tapping the sheet. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} accessibilityElementsHidden />

          {config != null && (
            <>
              <View style={styles.header}>
                <Text style={styles.icon} accessibilityElementsHidden>
                  {config.icon}
                </Text>
                <Text
                  style={styles.title}
                  accessibilityRole="header"
                  accessibilityLabel={`Connect ${config.displayName}`}
                >
                  Connect {config.displayName}
                </Text>
              </View>

              <Text style={styles.body}>
                {buildDisabled
                  ? HEALTH_CONNECT_DISABLED_MESSAGE
                  : config.dataDescription}
              </Text>

              {onDevice && !buildDisabled && (
                <View
                  style={styles.note}
                  accessibilityRole="text"
                  accessibilityLabel={onDeviceDisclosure(config.displayName)}
                >
                  <Text style={styles.noteText}>{onDeviceDisclosure(config.displayName)}</Text>
                </View>
              )}

              {importing && (
                <Text style={styles.noteText} accessibilityLiveRegion="polite">
                  Bringing in your last 30 days of health data. This can take a minute.
                </Text>
              )}

              {error != null && (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              )}

              {showCta && (
                <Pressable
                  style={[styles.cta, continuing && styles.ctaDisabled]}
                  onPress={handleContinue}
                  disabled={continuing}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: continuing,
                    busy: continuing,
                  }}
                  accessibilityLabel={
                    ctaLabel === 'Continue'
                      ? `Continue connecting ${config.displayName}`
                      : ctaLabel === 'Continue import' || ctaLabel === 'Try again'
                        ? `${ctaLabel} for ${config.displayName}`
                        : ctaLabel
                  }
                >
                  {continuing ? (
                    <ActivityIndicator color={colors.bone} />
                  ) : (
                    <Text style={styles.ctaText}>{ctaLabel}</Text>
                  )}
                </Pressable>
              )}

              <Pressable
                style={styles.cancel}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={buildDisabled || !showCta || resumeTarget != null ? 'Close' : 'Cancel'}
              >
                <Text style={styles.cancelText}>
                  {buildDisabled || !showCta || resumeTarget != null ? 'Close' : 'Cancel'}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * S14 (C-317-2): what Continue does, shown BEFORE the permission prompt.
 * Plain copy consistent with the approved Apple Health usage string in
 * app.json (coach personalizes training, recovery and check-ins). This is the
 * required data collection for the feature, not the optional AI processing
 * choice (consent box 2), which this sheet does not change.
 */
export function onDeviceDisclosure(displayName: string): string {
  return (
    `When you continue, ${displayName} asks for permission on this phone. ` +
    `The Growth Project then brings in your last 30 days of ${displayName} data, and new data ` +
    `each time you open Health, so your coach can personalize your training, ` +
    `recovery, and check-ins. Nothing is read or shared until you allow it.`
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: withAlpha(colors.ink, 0.45),
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bone,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  grabber: {
    alignSelf: 'center',
    width: spacing['2xl'],
    height: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.stone,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    ...typography.h1,
    marginRight: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.ink,
    flexShrink: 1,
  },
  body: {
    ...typography.body,
    color: colors.charcoal,
    marginBottom: spacing.lg,
  },
  note: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  noteText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  error: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
  },
  cta: {
    backgroundColor: colors.forest,
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    ...typography.bodyMd,
    color: colors.bone,
  },
  cancel: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cancelText: {
    ...typography.bodyMd,
    color: colors.charcoal,
  },
});
