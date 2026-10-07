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
import { useTheme } from '../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../theme/tokens';
import {
  claimPendingInviteCode,
  clearPendingInviteCode,
  readPendingInviteCode,
  subscribePendingInviteCode,
} from '../lib/pendingInviteCode';
import { authEvents } from '../utils/authEvents';
import { useCoachSharingNotice } from '../lib/coachSharingNotice';
import CoachSharingNotice from './coachSharing/CoachSharingNotice';

export default function PendingInviteBanner() {
  const { semanticColors: colors } = useTheme();
  const styles = makeStyles(colors);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMessage, setErrMessage] = useState<string | null>(null);
  // Refs to clear timers on unmount — prevents setState on dead component.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // B-SHARE-127: Attach is the join; the sentence shows and its version is sent.
  const sharingVersion = useCoachSharingNotice();

  const refresh = useCallback(async () => {
    setCode(await readPendingInviteCode());
  }, []);

  useEffect(() => {
    refresh();
    const unsub = authEvents.onAuthChange(refresh);
    // B2: repaint when a foreground invite link writes a new code. Only a
    // non-empty value is applied here, so a clear during a claim does not
    // hide the success / error line (the claim flow schedules its own
    // refresh).
    const unsubPending = subscribePendingInviteCode(() => {
      void readPendingInviteCode().then((next) => {
        if (next) {
          setStatus('idle');
          setErrMessage(null);
          setCode(next);
        }
      });
    });
    return () => {
      unsub();
      unsubPending();
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  if (!code) return null;

  const handleClaim = async () => {
    setBusy(true);
    setStatus('idle');
    setErrMessage(null);
    const result = await claimPendingInviteCode(code, sharingVersion);
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
    <View style={styles.container} accessibilityLiveRegion="polite" testID="pending-invite-banner">
      <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
      <View style={styles.body}>
        <Text style={styles.title}>Invite code received</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {status === 'ok'
            ? 'Code attached to your account.'
            : status === 'err'
            ? (errMessage ?? "Couldn't attach this code.")
            : `Tap to attach "${code}" to your account.`}
        </Text>
        <CoachSharingNotice version={status === 'idle' ? sharingVersion : null} style={styles.sharing} />
      </View>
      {status === 'ok' ? (
        <Ionicons name="checkmark-circle-outline" size={20} color={colors.accentText} />
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
              <ActivityIndicator color={colors.accentText} />
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
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: SemanticTokens) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      // DES-K2-128: one hairline above, no box or fill (A23 section).
      paddingVertical: 18,
      marginBottom: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    body: { flex: 1 },
    title: { ...typography.bodyMd, color: colors.textPrimary },
    subtitle: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginTop: 2,
    },
    sharing: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 0 },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    attachBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' },
    attachText: { ...typography.bodyMd, color: colors.accentText },
    dismissBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  });
}
