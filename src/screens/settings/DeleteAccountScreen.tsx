/**
 * DeleteAccountScreen
 *
 * Implements the GDPR right-to-erasure user flow for The Growth Project.
 *
 * Two-phase flow:
 *  1. User reads what will happen and what will be kept/removed.
 *  2. User types "DELETE" or their email address to prove intent.
 *  3. POST /me/delete-account — sends a confirmation email.
 *  4. On success: log out, show a toast explaining the next steps.
 *
 * The 14-day grace period (and cancellation from Settings) is explained
 * in the body copy. No abbreviation — every claim here is doctrine-accurate.
 *
 * Doctrine rules enforced:
 *  - No emoji anywhere.
 *  - No forbidden tokens (income, finance, netWorth, confetti, trophy).
 *  - Theme tokens only (useTheme().colors).
 *  - accessibilityLabel + accessibilityRole on every interactive element.
 *  - Cormorant Garamond for the display heading, Inter for body.
 */

import React, { useState, useMemo } from 'react';
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
import { warningTap } from '../../utils/haptics';
import { signOut } from '../../services/authActions';
import { deletionApi } from '../../services/api';
import { errorMessage } from '../../types/common';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

// The user must type this exact string (case-insensitive) OR their registered
// email address to enable the confirm button. This prevents accidental taps.
const REQUIRED_CONFIRMATION = 'DELETE';

interface DeleteAccountScreenProps {
  navigation: NavigationProp<ParamListBase>;
}

export default function DeleteAccountScreen({ navigation }: DeleteAccountScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();

  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userEmail = currentUser?.email ?? '';

  // Button is active when the user has typed either "DELETE" (case-insensitive)
  // or their exact registered email address.
  const confirmTextIsValid =
    confirmText.trim().toUpperCase() === REQUIRED_CONFIRMATION ||
    confirmText.trim().toLowerCase() === userEmail.toLowerCase();

  const handleConfirm = async () => {
    if (!confirmTextIsValid) return;
    setError(null);
    setBusy(true);
    warningTap();

    try {
      await deletionApi.requestDeletion();
      // Inform the user before signing them out. We call signOut after the
      // alert so the auth-event navigation reset does not race with the Alert
      // dismissal on older React Navigation versions.
      Alert.alert(
        'Account scheduled for deletion',
        'Your account is scheduled for deletion in 14 days. You can cancel anytime before then from Settings. Contact support if you need immediate confirmation.',
        [{ text: 'OK', onPress: () => signOut() }],
        { cancelable: false },
      );
    } catch (err) {
      const msg = errorMessage(err, 'Could not request account deletion. Please try again.');
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Warning banner */}
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={20} color={colors.error} />
          <Text style={styles.warningText}>
            This action is irreversible after the 14-day grace period.
          </Text>
        </View>

        {/* What happens */}
        <Text style={styles.sectionHeading}>What happens when you delete your account</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            When you tap "Confirm deletion" below, your deletion request is
            registered for account{' '}
            <Text style={styles.bodyBold}>{userEmail}</Text>.
          </Text>
          <Text style={[styles.bodyText, { marginTop: 12 }]}>
            Your account will enter a{' '}
            <Text style={styles.bodyBold}>14-day grace period</Text>. During those
            14 days you can cancel deletion at any time from the Settings screen.
            Contact support if you need immediate confirmation.
          </Text>
          <Text style={[styles.bodyText, { marginTop: 12 }]}>
            After 14 days, your personal data is permanently and irreversibly
            removed from our systems. You will not be able to recover your account
            or any data after that point.
          </Text>
        </View>

        {/* What is permanently deleted */}
        <Text style={styles.sectionHeading}>Permanently deleted</Text>
        <View style={styles.card}>
          {[
            'Your profile, biometrics, and body measurements',
            'Food log, water log, and fasting records',
            'Workout history and exercise records',
            'Check-in entries and habit logs',
            'Weight log entries',
            'Community posts you authored',
            'All your recipes and saved recipes',
            'Shopping and grocery lists',
            'Notification and app preferences',
          ].map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>

        {/* What is kept (anonymized for compliance) */}
        <Text style={styles.sectionHeading}>Kept for legal and operational reasons</Text>
        <View style={styles.card}>
          {[
            'Billing and invoice records (UK financial records law requires 6-year retention)',
            'Audit log entries — your identity is removed but the event record is kept for compliance',
            'Message threads — your identity and message text are removed; the thread structure is kept for the other party',
          ].map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
          <Text style={[styles.bodyText, { marginTop: 12, fontSize: 13, color: colors.textMuted }]}>
            Your name, email address, and phone number are removed from all retained records.
          </Text>
        </View>

        {/* Export reminder */}
        <View style={styles.exportReminder}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.exportReminderText}>
            Before deleting, consider downloading a copy of your data from Settings
            under Data &amp; Privacy.
          </Text>
        </View>

        {/* Confirmation input */}
        <Text style={styles.sectionHeading}>Confirm your intent</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            Type{' '}
            <Text style={styles.bodyBold}>DELETE</Text>
            {' '}or your email address to continue:
          </Text>
          <TextInput
            style={[styles.confirmInput, confirmTextIsValid && styles.confirmInputValid]}
            value={confirmText}
            onChangeText={(t) => {
              setConfirmText(t);
              setError(null);
            }}
            placeholder={`Type DELETE or ${userEmail}`}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            accessibilityLabel="Type DELETE or your email to confirm account deletion"
            testID="confirm-input"
          />
        </View>

        {/* Error */}
        {error ? (
          <Text
            style={styles.errorText}
            accessibilityLiveRegion="assertive"
          >
            {error}
          </Text>
        ) : null}

        {/* Confirm button */}
        <HapticPressable
          intent="warning"
          style={[
            styles.deleteBtn,
            (!confirmTextIsValid || busy) && styles.deleteBtnDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!confirmTextIsValid || busy}
          accessibilityRole="button"
          accessibilityLabel="Confirm account deletion"
          accessibilityHint="Registers your deletion request and starts the 14-day grace period"
          testID="confirm-button"
        >
          {busy ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.deleteBtnText}>Confirm deletion</Text>
          )}
        </HapticPressable>

        {/* Cancel */}
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
  });
