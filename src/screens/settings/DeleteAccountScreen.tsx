/**
 * DeleteAccountScreen — in-app account deletion (Apple 5.1.1(v), GDPR/RCW
 * 19.373 right to deletion). Shared by the client and coach Settings.
 *
 * Flow (backend src/account-deletion/, PR #608):
 *  1. On open, GET /me/delete-account/status. If a deletion is already
 *     scheduled the screen shows the status view (exact date + cancel).
 *  2. Otherwise the user reads what is removed and kept, types DELETE or
 *     their email, then re-authenticates: their password, or (iOS) the
 *     native Sign in with Apple sheet.
 *  3. POST /auth/recent-auth-token mints a short-lived single-use token from
 *     that proof; POST /me/delete-account with X-Recent-Auth-Token schedules
 *     the deletion IN THE SAME REQUEST (no email step). Apple users also send
 *     the sheet's authorization code so the server revokes their Sign in with
 *     Apple tokens.
 *  4. The response's purge_after date is shown in the status view, with
 *     "Keep my account" (POST /me/delete-account/cancel) until then.
 *
 * Copy rules: every claim must match the backend finalizer fan-out. No emoji,
 * theme tokens only, accessibilityLabel + accessibilityRole on every control.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../components/HapticPressable';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { warningTap, successTap } from '../../utils/haptics';
import { signOut } from '../../services/authActions';
import { deletionApi, DeletionStatus } from '../../services/api';
import { isAppleAuthAvailable, reauthenticateWithApple } from '../../utils/appleAuth';
import { errorMessage, errorStatus } from '../../types/common';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

// The user must type this exact string (case-insensitive) OR their registered
// email address before the re-auth controls are enabled.
const REQUIRED_CONFIRMATION = 'DELETE';

export const PERMANENTLY_DELETED: readonly string[] = [
  'Your profile, biometrics and body measurements',
  'Food log, water log and fasting records',
  'Workout history and exercise records',
  'Check-ins, habits and weight entries',
  'Health and activity data synced from Apple Health or connected devices, and bloodwork you entered',
  'Your conversations with Roman, the AI assistant',
  'Your community posts, comments, messages, voice notes and reactions (the text is erased and the item is removed for everyone)',
  'Your consultation answers, targets, recipes and lists',
  'Notification and app preferences',
];

export const KEPT_RECORDS: readonly string[] = [
  'Billing and invoice records that tax and accounting law requires us to keep',
  'Audit log entries: your identity is removed but the event record is kept for security and compliance',
  'Coach message threads: your name and message text are removed; the thread is kept for the other person',
];

interface DeleteAccountScreenProps {
  navigation: NavigationProp<ParamListBase>;
}

type ScheduledStatus = Pick<DeletionStatus, 'state' | 'purge_after' | 'cancellable'>;

export function formatDeletionDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function isScheduled(s: ScheduledStatus | null): boolean {
  return !!s && (s.state === 'confirmed' || s.state === 'requested');
}

function reauthErrorMessage(err: unknown, method: 'password' | 'apple'): string {
  const status = errorStatus(err);
  if (status === 401) {
    return method === 'password'
      ? 'That password is not correct. Please try again.'
      : 'Apple could not confirm it is you. Please try again.';
  }
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  return errorMessage(err, 'Could not confirm it is you. Please try again.');
}

export default function DeleteAccountScreen({ navigation }: DeleteAccountScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();

  const [status, setStatus] = useState<ScheduledStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userEmail = currentUser?.email ?? '';

  const confirmTextIsValid =
    confirmText.trim().toUpperCase() === REQUIRED_CONFIRMATION ||
    (userEmail !== '' && confirmText.trim().toLowerCase() === userEmail.toLowerCase());

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await deletionApi.getDeletionStatus();
      setStatus(res.data ?? null);
    } catch {
      // Unknown state: show the request form. Requesting again is idempotent
      // on the server, so a duplicate request cannot create a second schedule.
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    let mounted = true;
    isAppleAuthAvailable()
      .then((ok) => {
        if (mounted) setAppleAvailable(ok);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [loadStatus]);

  const schedule = async (
    proof: Parameters<typeof deletionApi.issueRecentAuthToken>[0],
    method: 'password' | 'apple',
    appleAuthorizationCode?: string | null,
  ) => {
    let token: string;
    try {
      const res = await deletionApi.issueRecentAuthToken(proof);
      token = res.data.token;
    } catch (err) {
      setError(reauthErrorMessage(err, method));
      return;
    }
    try {
      const res = await deletionApi.requestDeletion(token, appleAuthorizationCode);
      setPassword('');
      setConfirmText('');
      setStatus({
        state: 'confirmed',
        purge_after: res.data.purge_after,
        cancellable: res.data.cancellable,
      });
    } catch (err) {
      setError(errorMessage(err, 'Could not schedule account deletion. Please try again.'));
    }
  };

  const handleDeleteWithPassword = async () => {
    if (!confirmTextIsValid || !password || busy) return;
    setError(null);
    setBusy(true);
    warningTap();
    try {
      await schedule({ password }, 'password');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteWithApple = async () => {
    if (!confirmTextIsValid || busy) return;
    setError(null);
    setBusy(true);
    warningTap();
    try {
      const apple = await reauthenticateWithApple();
      if (!apple.success || !apple.identityToken) {
        if (!apple.cancelled) {
          setError(apple.error || 'Apple could not confirm it is you. Please try again.');
        }
        return;
      }
      await schedule(
        { provider: 'apple', provider_token: apple.identityToken },
        'apple',
        apple.authorizationCode,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleKeepAccount = () => {
    Alert.alert('Keep your account?', 'Your account will no longer be scheduled for deletion.', [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Keep my account',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await deletionApi.cancelDeletion();
            successTap();
            await loadStatus();
            Alert.alert('Deletion cancelled', 'Your account is no longer scheduled for deletion.');
          } catch (err) {
            setError(errorMessage(err, 'Could not cancel the deletion. Please try again.'));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const header = (
    <View style={styles.topBar}>
      <HapticPressable
        intent="light"
        onPress={() => navigation.goBack()}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </HapticPressable>
      <Text style={styles.topTitle}>Delete account</Text>
      <View style={styles.backBtn} />
    </View>
  );

  const errorView = error ? (
    <Text style={styles.errorText} accessibilityLiveRegion="assertive">
      {error}
    </Text>
  ) : null;

  if (loadingStatus) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading deletion status" />
        </View>
      </View>
    );
  }

  // ── Status view: deletion scheduled ────────────────────────────────────────
  if (isScheduled(status)) {
    const date = formatDeletionDate(status?.purge_after);
    const cancellable = status?.cancellable !== false;
    return (
      <View style={styles.container}>
        {header}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.warningBanner}>
            <Ionicons name="time-outline" size={20} color={colors.error} />
            <Text style={styles.warningText} testID="deletion-scheduled-banner">
              Your account is scheduled for deletion.
            </Text>
          </View>
          <Text style={styles.sectionHeading}>Permanent deletion date</Text>
          <View style={styles.card}>
            <Text style={styles.statusDate} testID="deletion-date">
              {date ?? 'Within 14 days'}
            </Text>
            <Text style={[styles.bodyText, { marginTop: 12 }]}>
              {date
                ? `On ${date} your account and the data listed below are permanently deleted. This cannot be undone after that date.`
                : 'Your account and the data listed below are permanently deleted at the end of the 14-day grace period. This cannot be undone after that date.'}
            </Text>
            <Text style={[styles.bodyText, { marginTop: 12 }]}>
              {cancellable
                ? 'Until then you can keep using the app, and you can cancel the deletion here at any time.'
                : 'The grace period has ended, so this deletion can no longer be cancelled.'}
            </Text>
          </View>
          <Text style={styles.sectionHeading}>Permanently deleted</Text>
          <View style={styles.card}>
            {PERMANENTLY_DELETED.map((item) => (
              <View key={item} style={styles.listRow}>
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
          {errorView}
          {cancellable ? (
            <HapticPressable
              intent="light"
              style={[styles.keepBtn, busy && styles.deleteBtnDisabled]}
              onPress={handleKeepAccount}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel deletion and keep my account"
              testID="keep-account-button"
            >
              {busy ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.keepBtnText}>Keep my account</Text>
              )}
            </HapticPressable>
          ) : null}
          <HapticPressable
            intent="light"
            style={styles.cancelBtn}
            onPress={() => signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            testID="sign-out-button"
          >
            <Text style={styles.cancelBtnText}>Sign out</Text>
          </HapticPressable>
        </ScrollView>
      </View>
    );
  }

  // ── Request form ───────────────────────────────────────────────────────────
  const passwordEnabled = confirmTextIsValid && password.length > 0 && !busy;
  const appleEnabled = confirmTextIsValid && !busy;

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={20} color={colors.error} />
          <Text style={styles.warningText}>
            This action is irreversible after the 14-day grace period.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>What happens when you delete your account</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            When you confirm below, deletion of the account{' '}
            <Text style={styles.bodyBold}>{userEmail}</Text> is scheduled straight away. You will
            see the exact deletion date on the next screen.
          </Text>
          <Text style={[styles.bodyText, { marginTop: 12 }]}>
            There is a <Text style={styles.bodyBold}>14-day grace period</Text>. During those 14
            days you can keep using the app and cancel the deletion from Settings, Delete account.
          </Text>
          <Text style={[styles.bodyText, { marginTop: 12 }]}>
            After 14 days, your personal data is permanently removed. You will not be able to
            recover your account or any data after that point.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>Permanently deleted</Text>
        <View style={styles.card}>
          {PERMANENTLY_DELETED.map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
          <Text style={[styles.bodyText, { marginTop: 12, fontSize: 13, color: colors.textMuted }]}>
            If you signed in with Apple, the app&apos;s access to your Apple ID is also revoked.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>Kept for legal and operational reasons</Text>
        <View style={styles.card}>
          {KEPT_RECORDS.map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
          <Text style={[styles.bodyText, { marginTop: 12, fontSize: 13, color: colors.textMuted }]}>
            Your name, email address and phone number are removed from all retained records.
          </Text>
        </View>

        <View style={styles.exportReminder}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.exportReminderText}>
            Before deleting, consider downloading a copy of your data from Settings under Data
            &amp; Privacy.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>Step 1: Confirm your intent</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            Type <Text style={styles.bodyBold}>DELETE</Text> or your email address to continue:
          </Text>
          <TextInput
            style={[styles.confirmInput, confirmTextIsValid && styles.confirmInputValid]}
            value={confirmText}
            onChangeText={(t) => {
              setConfirmText(t);
              setError(null);
            }}
            placeholder={userEmail ? `Type DELETE or ${userEmail}` : 'Type DELETE'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            accessibilityLabel="Type DELETE or your email to confirm account deletion"
            testID="confirm-input"
          />
        </View>

        <Text style={styles.sectionHeading}>Step 2: Confirm it is you</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            {appleAvailable
              ? 'Enter your password, or if you sign in with Apple, confirm with Apple.'
              : 'Enter your password.'}
          </Text>
          <TextInput
            style={styles.reauthInput}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            accessibilityLabel="Your password"
            testID="password-input"
          />
        </View>

        {errorView}

        <HapticPressable
          intent="warning"
          style={[styles.deleteBtn, !passwordEnabled && styles.deleteBtnDisabled]}
          onPress={handleDeleteWithPassword}
          disabled={!passwordEnabled}
          accessibilityRole="button"
          accessibilityLabel="Confirm with password and delete my account"
          accessibilityHint="Schedules deletion and starts the 14-day grace period"
          testID="confirm-button"
        >
          {busy ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.deleteBtnText}>Delete my account</Text>
          )}
        </HapticPressable>

        {appleAvailable ? (
          <>
            <Text style={styles.orText}>or</Text>
            <HapticPressable
              intent="warning"
              style={[styles.appleBtn, !appleEnabled && styles.deleteBtnDisabled]}
              onPress={handleDeleteWithApple}
              disabled={!appleEnabled}
              accessibilityRole="button"
              accessibilityLabel="Confirm with Apple and delete my account"
              accessibilityHint="Opens Sign in with Apple, then schedules deletion"
              testID="apple-confirm-button"
            >
              <Ionicons name="logo-apple" size={18} color={colors.background} />
              <Text style={styles.appleBtnText}>Confirm with Apple and delete</Text>
            </HapticPressable>
          </>
        ) : null}

        <HapticPressable
          intent="light"
          style={styles.cancelBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Cancel, go back to Settings"
        >
          <Text style={styles.cancelBtnText}>Cancel — keep my account</Text>
        </HapticPressable>

      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    content: {
      paddingHorizontal: 24,
      paddingBottom: 48,
    },
    warningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 4,
      borderLeftWidth: 3,
      borderLeftColor: colors.error,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 24,
    },
    warningText: {
      flex: 1,
      fontSize: 14,
      color: colors.error,
      fontWeight: '500',
    },
    sectionHeading: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      marginTop: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 16,
    },
    bodyText: {
      fontSize: 15,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    bodyBold: {
      fontWeight: '600',
      color: colors.textPrimary,
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 5,
    },
    listText: {
      flex: 1,
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    exportReminder: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 4,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      padding: 14,
      marginTop: 24,
    },
    exportReminderText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 19,
    },
    confirmInput: {
      marginTop: 12,
      backgroundColor: colors.background,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.textPrimary,
    },
    confirmInputValid: {
      borderColor: colors.error,
    },
    errorText: {
      marginTop: 10,
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
    },
    deleteBtn: {
      marginTop: 28,
      backgroundColor: colors.error,
      borderRadius: 2,
      paddingVertical: 16,
      alignItems: 'center',
    },
    deleteBtnDisabled: {
      opacity: 0.4,
    },
    deleteBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textOnPrimary,
    },
    cancelBtn: {
      marginTop: 14,
      paddingVertical: 14,
      alignItems: 'center',
    },
    cancelBtnText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    reauthInput: {
      marginTop: 12,
      backgroundColor: colors.background,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.textPrimary,
    },
    orText: {
      marginTop: 14,
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
    },
    appleBtn: {
      marginTop: 14,
      backgroundColor: colors.textPrimary,
      borderRadius: 2,
      paddingVertical: 16,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    appleBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.background,
    },
    statusDate: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 6,
    },
    keepBtn: {
      marginTop: 28,
      backgroundColor: colors.primary,
      borderRadius: 2,
      paddingVertical: 16,
      alignItems: 'center',
    },
    keepBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textOnPrimary,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
