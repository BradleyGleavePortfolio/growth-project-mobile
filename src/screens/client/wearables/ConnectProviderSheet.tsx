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

import React, { useCallback, useState } from 'react';
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
import { colors, radius, spacing, typography, withAlpha } from '../../../theme/tokens';

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
  const [requestingOnDevice, setRequestingOnDevice] = useState(false);

  const onDevice = provider != null && isOnDeviceProvider(provider);
  const config = provider != null ? configFor(provider) : null;

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
      if (result.type === 'success' || result.type === 'dismiss') {
        onConnected?.();
        onClose();
      }
    },
    [startOauth, invalidate, onConnected, onClose],
  );

  const handleOnDeviceConnect = useCallback(
    async (target: WearableProvider) => {
      const outcome = await connectOnDeviceProvider(target);
      const name = configFor(target).displayName;
      switch (outcome) {
        case 'granted':
          // Permission granted on-device; re-read so the hub reflects it.
          invalidate();
          onConnected?.();
          onClose();
          return;
        case 'denied':
          setError(
            `${name} access wasn't granted. Open ${name} permissions and allow access, then try again.`,
          );
          return;
        case 'unavailable':
          setError(
            `${name} isn't set up on this device yet. We've opened its settings — finish setup there, then try again.`,
          );
          return;
        case 'unsupported':
          setError(`${name} can't be connected on this device.`);
          return;
      }
    },
    [invalidate, onConnected, onClose],
  );

  const handleContinue = useCallback(async () => {
    if (provider == null) return;
    setError(null);

    try {
      if (isOnDeviceProvider(provider)) {
        setRequestingOnDevice(true);
        await handleOnDeviceConnect(provider);
      } else {
        await handleCloudConnect(provider);
      }
    } catch {
      // Generic, action-oriented error copy (Stripe-quality: says what to do).
      // No token/secret material is ever surfaced (#12).
      setError("We couldn't start the connection. Please try again.");
    } finally {
      setRequestingOnDevice(false);
    }
  }, [provider, handleOnDeviceConnect, handleCloudConnect]);

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

              <Text style={styles.body}>{config.dataDescription}</Text>

              {onDevice && (
                <View
                  style={styles.note}
                  accessibilityRole="text"
                  accessibilityLabel={`${config.displayName} asks for permission on this device. Continue to grant access.`}
                >
                  <Text style={styles.noteText}>
                    {config.displayName} asks for permission on this device.
                    Continue to grant access.
                  </Text>
                </View>
              )}

              {error != null && (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              )}

              <Pressable
                style={[styles.cta, continuing && styles.ctaDisabled]}
                onPress={handleContinue}
                disabled={continuing}
                accessibilityRole="button"
                accessibilityState={{ disabled: continuing, busy: continuing }}
                accessibilityLabel={`Continue connecting ${config.displayName}`}
              >
                {continuing ? (
                  <ActivityIndicator color={colors.bone} />
                ) : (
                  <Text style={styles.ctaText}>Continue</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancel}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
