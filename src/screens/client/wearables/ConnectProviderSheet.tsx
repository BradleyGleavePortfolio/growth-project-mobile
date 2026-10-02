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
import { connectOnDeviceProvider } from '../../../services/health/onDeviceConnect';
import {
  beginOnDeviceConnect,
  connectOnDevice,
  deviceSourceFor,
  resumeOnDeviceImport,
  type OnDeviceImportOutcome,
  type OnDeviceSource,
} from '../../../services/health/onDeviceSync';
import type { SessionFence } from '../../../services/health/sessionFence';
import {
  connectFailureMessage,
  INGEST_DISABLED_COPY,
  partialImportMessage,
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
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current?.cancel();
      attemptRef.current = null;
    };
  }, []);
  useEffect(() => {
    // Closing the sheet (or switching provider) ends the run and its state.
    attemptRef.current?.cancel();
    attemptRef.current = null;
    setError(null);
    setRetry('connect');
    setResumeTarget(null);
    setImporting(false);
  }, [visible, provider]);

  const onDevice = provider != null && isOnDeviceProvider(provider);
  const config = provider != null ? configFor(provider) : null;
  const buildDisabled =
    provider != null && isHealthConnectProviderDisabled(provider);

  const showMessage = useCallback((message: OnDeviceMessage | null) => {
    if (!mountedRef.current || message == null) return;
    setError(message.text);
    setRetry(message.action);
  }, []);

  const handleCloudConnect = useCallback(
    async (target: WearableProvider) => {
      const { authorizationUrl } = await startOauth.mutateAsync(target);
      // Open the provider authorization URL in an in-app auth session. The
      // server callback completes the exchange; the session closes when the
      // server redirects back to RETURN_URL (or the user dismisses it).
      const result = await WebBrowser.openAuthSessionAsync(
        authorizationUrl,
        RETURN_URL,
      );
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
    [startOauth, invalidate, onConnected, onClose],
  );

  /**
   * Act on an import outcome. Only a COMPLETE import closes the sheet as a
   * success; an incomplete one keeps the sheet open with a truthful message
   * and a working Continue import / Try again action (Sol B-317-2).
   */
  const handleImportOutcome = useCallback(
    (outcome: OnDeviceImportOutcome, name: string) => {
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
      onConnected?.();
      onClose();
    },
    [invalidate, onConnected, onClose, showMessage],
  );

  const runImport = useCallback(
    async (name: string, run: () => Promise<OnDeviceImportOutcome>) => {
      if (mountedRef.current) setImporting(true);
      try {
        handleImportOutcome(await run(), name);
      } catch (err) {
        invalidate();
        showMessage(connectFailureMessage(err, name));
      } finally {
        if (mountedRef.current) setImporting(false);
      }
    },
    [handleImportOutcome, invalidate, showMessage],
  );

  const handleOnDeviceConnect = useCallback(
    async (target: WearableProvider) => {
      const name = configFor(target).displayName;
      // Bind the run to the person who tapped, BEFORE the native prompt.
      let fence: SessionFence;
      try {
        fence = await beginOnDeviceConnect();
      } catch (err) {
        showMessage(connectFailureMessage(err, name));
        return;
      }
      attemptRef.current?.cancel();
      attemptRef.current = fence;

      const outcome = await connectOnDeviceProvider(target);
      if (attemptRef.current !== fence) return; // sheet closed meanwhile
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
            showMessage({ text: `${name} can't be connected on this device.`, action: 'none' });
            return;
          }
          await runImport(name, () => connectOnDevice(source, fence));
          return;
        }
        case 'denied':
          showMessage({
            text: `${name} access wasn't granted. Open ${name} permissions and allow access, then tap Continue.`,
            action: 'connect',
          });
          return;
        case 'unavailable':
          showMessage({
            text: `${name} isn't set up on this device yet. We've opened its settings. Finish setup there, then tap Continue.`,
            action: 'connect',
          });
          return;
        case 'unsupported':
          showMessage({ text: `${name} can't be connected on this device.`, action: 'none' });
          return;
      }
    },
    [runImport, showMessage],
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
    setError(null);
    setRequestingOnDevice(true);
    try {
      await runImport(name, () =>
        resumeOnDeviceImport(resumeTarget.source, resumeTarget.connectionId, fence),
      );
    } finally {
      if (mountedRef.current) setRequestingOnDevice(false);
    }
  }, [provider, resumeTarget, runImport, showMessage]);

  const handleContinue = useCallback(async () => {
    if (provider == null) return;
    if (isHealthConnectProviderDisabled(provider)) {
      setError(HEALTH_CONNECT_DISABLED_MESSAGE);
      setRetry('none');
      return;
    }
    if (retry === 'resume' && resumeTarget != null) {
      await handleResume();
      return;
    }
    setError(null);
    setRetry('connect');
    setResumeTarget(null);

    try {
      if (isOnDeviceProvider(provider)) {
        setRequestingOnDevice(true);
        await handleOnDeviceConnect(provider);
      } else {
        await handleCloudConnect(provider);
      }
    } catch {
      // Cloud OAuth start failed (on-device failures are mapped above).
      // Action-oriented copy; no token/secret material is ever surfaced (#12).
      if (mountedRef.current) {
        setError(
          "We couldn't start the connection. Check your internet connection, then tap Continue.",
        );
      }
    } finally {
      if (mountedRef.current) setRequestingOnDevice(false);
    }
  }, [provider, retry, resumeTarget, handleResume, handleOnDeviceConnect, handleCloudConnect]);

  const ctaLabel =
    retry === 'resume' && resumeTarget != null
      ? resumeTarget.partial
        ? 'Continue import'
        : 'Try again'
      : 'Continue';
  const showCta = !buildDisabled && retry !== 'none';
  const continuing = startOauth.isPending || requestingOnDevice;

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
                      : `${ctaLabel} for ${config.displayName}`
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
    `We then bring in your last 30 days of ${displayName} data, and new data ` +
    `each time you open Health, so your coach can personalize your training, ` +
    `recovery, and check-ins.`
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
