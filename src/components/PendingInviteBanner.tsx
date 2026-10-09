/**
 * PendingInviteBanner — surfaces an unread invite code that landed via deep
 * link while the user was already signed in. The user must explicitly tap
 * "Attach" before we POST /auth/attach-invite-code — silent
 * re-pairing would change the user's coach without their consent (B5).
 *
 * Reads from AsyncStorage on mount and on every authEvents tick so the
 * RootNavigator deep-link handler can poke the banner to refresh after a
 * foreground URL event.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import HapticPressable from './HapticPressable';
import { useTheme } from '../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../theme/tokens';
import {
  claimPendingInviteCode,
  clearPendingInviteCode,
  previewPendingInviteCoachName,
  readPendingInviteCode,
  subscribePendingInviteCode,
} from '../lib/pendingInviteCode';
import { authEvents } from '../utils/authEvents';
import { useCoachSharingNotice } from '../lib/coachSharingNotice';
import CoachSharingNotice from './coachSharing/CoachSharingNotice';
import { useEntitlement } from '../entitlements/EntitlementProvider';
import { queryClient } from '../services/queryClient';
import { logger } from '../utils/logger';
import { QuietOverline, QuietSection, quietActions } from '../ui/sections/QuietSection';

export default function PendingInviteBanner() {
  const { semanticColors: colors } = useTheme();
  const { refreshEntitlement } = useEntitlement();
  const styles = makeStyles(colors);
  const [code, setCode] = useState<string | null>(null);
  const [coachPreview, setCoachPreview] = useState<{ code: string; name: string | null } | null>(null);
  const coachName = coachPreview?.code === code ? coachPreview.name : null;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const [paidJoin, setPaidJoin] = useState(false);
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

  useEffect(() => {
    let live = true;
    if (code) {
      void previewPendingInviteCoachName(code).then((name) => {
        if (live) setCoachPreview({ code, name });
      });
    }
    return () => { live = false; };
  }, [code]);

  if (!code) return null;

  const handleClaim = async () => {
    setBusy(true);
    setStatus('idle');
    setErrMessage(null);
    const result = await claimPendingInviteCode(code, sharingVersion);
    setBusy(false);
    if (result.ok) {
      setStatus('ok');
      setPaidJoin(result.paidJoin === true);
      // The attach may grant a plan. Re-read the same shared gate checkout
      // uses and Home's coachless state; never infer access from the code.
      void refreshEntitlement().catch((err: unknown) =>
        logger.warn('PendingInviteBanner', 'entitlement refresh after attach failed', err),
      );
      void queryClient.invalidateQueries({ queryKey: ['coachless', 'home'] }).catch((err: unknown) =>
        logger.warn('PendingInviteBanner', 'Home refresh after attach failed', err),
      );
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
    <QuietSection accessibilityLiveRegion="polite" testID="pending-invite-banner">
      <QuietOverline>COACH INVITE</QuietOverline>
      <Text style={styles.subtitle}>
        {status === 'ok'
          ? paidJoin
            ? 'Code accepted. Joining finishes after the payment.'
            : 'Invite attached to your account.'
          : status === 'err'
          ? (errMessage ?? 'The invite could not be attached right now. Try Attach again.')
          : `${coachName ? `Invite from ${coachName}. ` : ''}Attach "${code}" to your account.`}
      </Text>
      <CoachSharingNotice
        version={status === 'idle' ? sharingVersion : null}
        coachName={coachName}
        style={styles.sharing}
      />
      {status !== 'ok' ? (
        <View style={quietActions.row}>
          <HapticPressable
            intent="medium"
            style={[quietActions.action, styles.action]}
            onPress={handleClaim}
            disabled={busy}
            accessibilityState={{ disabled: busy, busy }}
            accessibilityRole="button"
            accessibilityLabel="Attach invite code"
          >
            {busy ? (
              <ActivityIndicator accessibilityLabel="Attaching invite code" color={colors.accentText} />
            ) : (
              <Text style={styles.attachText}>Attach</Text>
            )}
          </HapticPressable>
          <HapticPressable
            intent="light"
            style={[quietActions.action, styles.action]}
            onPress={handleDismiss}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Dismiss invite code"
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </HapticPressable>
        </View>
      ) : null}
    </QuietSection>
  );
}

function makeStyles(colors: SemanticTokens) {
  return StyleSheet.create({
    subtitle: {
      ...typography.bodySmall,
      color: colors.textMuted,
    },
    sharing: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 0 },
    action: { minWidth: 44 },
    attachText: { ...typography.bodyMd, color: colors.accentText },
    dismissText: { ...typography.bodySmall, color: colors.textMuted },
  });
}
