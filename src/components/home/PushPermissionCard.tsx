/**
 * PushPermissionCard — the deferred push-permission ask (rule 28).
 *
 * Sign-in no longer triggers the OS prompt (App.tsx registers the token only
 * when permission is already granted). Instead, once onboarding is done and
 * the client is on Home, this card explains the value ("hear from your coach")
 * and only a tap on "Turn on" shows the OS prompt. It renders only when the OS
 * can still ask (status undetermined) and the user has not dismissed it.
 * Dismissal is stored per user (R15) in prefsStorage.
 *
 * C-S-PUSH-3: the coach app mounts the same card (audience="coach") at the top
 * of the Clients landing screen, so a fresh coach install also gets the ask
 * and registers its token through the same path. Same per-user key, so it
 * shows once per account.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications } from '../../services/pushNotifications';
import { usersApi } from '../../services/api';
import { prefsStorage } from '../../storage/mmkv';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

export const pushPrimerDismissedKey = (userId: string) => `push_primer_dismissed:${userId}`;

export type PushPermissionAudience = 'client' | 'coach';

const BODY_COPY: Record<PushPermissionAudience, string> = {
  client: 'Turn on notifications so you see messages and plan updates from your coach.',
  coach: 'Turn on notifications so you see client messages and new client alerts.',
};

export default function PushPermissionCard({
  audience = 'client',
}: { audience?: PushPermissionAudience } = {}) {
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!userId || Platform.OS === 'web') return undefined;
    (async () => {
      try {
        const dismissed = await prefsStorage.getStringAsync(pushPrimerDismissedKey(userId));
        if (dismissed) return;
        const perm = await Notifications.getPermissionsAsync();
        if (mounted && perm.status !== 'granted' && perm.canAskAgain !== false) setVisible(true);
      } catch {
        // stay hidden
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  if (!visible || !userId) return null;

  const dismiss = async () => {
    setVisible(false);
    await prefsStorage.set(pushPrimerDismissedKey(userId), 'true').catch(() => undefined);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await registerForPushNotifications({ requestPermission: true });
      if (result.token) await usersApi.updatePushToken(result.token);
    } catch {
      // best-effort; the card closes either way so we never nag
    } finally {
      setBusy(false);
      await dismiss();
    }
  };

  return (
    <View
      style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}
      testID="push-permission-card"
    >
      <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 6 }}>STAY IN TOUCH</Text>
      <Text style={{ ...typography.body, color: sc.textPrimary }}>{BODY_COPY[audience]}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={enable}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Turn on notifications"
          testID="push-permission-enable"
          style={[styles.primary, { backgroundColor: sc.textPrimary, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={{ ...typography.bodySmall, color: sc.bgPrimary }}>Turn on</Text>
        </Pressable>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          testID="push-permission-dismiss"
          style={styles.secondary}
        >
          <Text style={{ ...typography.bodySmall, color: sc.textMuted }}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 0.5, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 24 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  primary: { paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  secondary: { paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
});
