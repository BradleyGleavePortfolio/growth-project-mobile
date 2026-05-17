/**
 * PendingInviteBanner — surfaces an unread invite code that landed via deep
 * link while the user was already signed in. The user must explicitly tap
 * "Attach to my account" before we POST /auth/attach-invite-code — silent
 * re-pairing would change the user's coach without their consent (B5).
 *
 * Reads from AsyncStorage on mount and on every authEvents tick so the
 * RootNavigator deep-link handler can poke the banner to refresh after a
 * foreground URL event.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import HapticPressable from './HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';
import {
  claimPendingInviteCode,
  clearPendingInviteCode,
  readPendingInviteCode,
} from '../lib/pendingInviteCode';
import { authEvents } from '../utils/authEvents';

export default function PendingInviteBanner() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMessage, setErrMessage] = useState<string | null>(null);
  // Refs to clear timers on unmount — prevents setState on dead component.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setCode(await readPendingInviteCode());
  }, []);

  useEffect(() => {
    refresh();
    const unsub = authEvents.onAuthChange(refresh);
    return () => {
      unsub();
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  if (!code) return null;

  const handleClaim = async () => {
    setBusy(true);
    setStatus('idle');
    setErrMessage(null);
    const result = await claimPendingInviteCode(code);
    setBusy(false);
    if (result.ok) {
      setStatus('ok');
      // refresh from storage so we hide the banner
      refreshTimerRef.current = setTimeout(refresh, 1500);
    } else {
      setStatus('err');
      setErrMessage(result.message ?? null);
      // 4xx codes were already cleared by claimPendingInviteCode
      refreshTimerRef.current = setTimeout(refresh, 1500);
    }
  };

  const handleDismiss = async () => {
    await clearPendingInviteCode();
    refresh();
  };

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Ionicons name="mail-outline" size={18} color={colors.primary} />
      <View style={styles.body}>
        <Text style={styles.title}>Invite code received</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {status === 'ok'
            ? 'Code attached to your account.'
            : status === 'err'
            ? (errMessage ?? "Couldn't attach this code.")
            : `Tap to attach "${code}" to your account.`}
        </Text>
      </View>
      {status === 'ok' ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
      ) : (
        <View style={styles.actions}>
          <HapticPressable
            intent="medium"
            style={styles.attachBtn}
            onPress={handleClaim}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Attach invite code"
          >
            {busy ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.attachText}>Attach</Text>
            )}
          </HapticPressable>
          <HapticPressable
            intent="light"
            style={styles.dismissBtn}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss invite code"
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </HapticPressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginHorizontal: 16,
      marginVertical: 8,
      backgroundColor: colors.surface,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    body: { flex: 1 },
    title: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    attachBtn: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    attachText: {
      color: colors.textOnPrimary,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
    },
    dismissBtn: {
      padding: 6,
    },
  });
}
