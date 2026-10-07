import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
// Security: sign-out now flows through authActions which clears tokens,
// AsyncStorage, and notifies the auth event emitter — replacing the old
// useAuthStore.signOut() which only cleared tokens as a side effect.
import { signOut, refreshProfile } from '../../services/authActions';
import { useSettings } from '../../hooks/useSettings';
import { readDayOneAnswers, type DayOneCheckInTime } from '../day-one/answers';
import { profileApi, notificationsApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';

import { mediumTap, warningTap, successTap } from '../../utils/haptics';
import { updateSupabasePassword } from '../../utils/supabaseAuth';
import { useTheme, ThemeColors, AppearanceOverride } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import BiometricUnlockSetting from '../../components/BiometricUnlockSetting';
import TutorialSettingsRow from '../../components/tutorial/TutorialSettingsRow';
import { featureFlags } from '../../config/featureFlags';
import { coachSharingCopy } from '../../components/coachSharing/coachSharingCopy';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

export default function SettingsScreen({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  const { colors, appearanceOverride, setAppearanceOverride } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  // signOut + refreshProfile imported directly — no store wiring needed.
  const { settings, updateSetting } = useSettings();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [checkInChoice, setCheckInChoice] = useState<{
    userId: string; time: DayOneCheckInTime;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    const userId = currentUser?.id;
    setCheckInChoice(null);
    if (userId) {
      void readDayOneAnswers(userId).then((answers) => {
        if (mounted && answers?.checkInTime) {
          setCheckInChoice({ userId, time: answers.checkInTime });
        }
      });
    }
    return () => { mounted = false; };
  }, [currentUser?.id]);

  const checkInTime = checkInChoice?.userId === currentUser?.id ? checkInChoice?.time : null;
  const checkInLabel = checkInTime
    ? `${checkInTime.hour % 12 || 12}:${String(checkInTime.minute).padStart(2, '0')} ${checkInTime.hour < 12 ? 'AM' : 'PM'}`
    : null;

  const handleChangePassword = async () => {
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    const result = await updateSupabasePassword(newPassword);
    setPasswordBusy(false);
    if (!result.ok) {
      setPasswordError(result.message);
      return;
    }
    successTap();
    setShowPasswordModal(false);
    setNewPassword('');
    setConfirmPassword('');
    Alert.alert('Password updated', 'Your password has been changed.');
  };

  const handleResetOnboarding = () => {
    Alert.alert('Reset Onboarding', 'This will restart your profile setup. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          warningTap();
          if (currentUser?.id) {
            await profileApi.update({ onboardingCompleted: false }).catch(() => {});
            // Clear the local flag and fire an auth event so RootNavigator
            // re-evaluates and drops the user into the onboarding flow.
            await AsyncStorage.removeItem('onboarding_complete');
            authEvents.emit();
          }
        },
      },
    ]);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          warningTap();
          signOut();
        },
      },
    ]);
  };

  // Map client setting keys to backend profile fields
  const PROFILE_KEY_MAP: Partial<Record<keyof import('../../hooks/useSettings').ClientSettings, string>> = {
    mealsPerDay: 'meals_per_day',
    waterGoalOz: 'water_goal_oz',
  };

  const handleProfileSettingUpdate = <K extends keyof import('../../hooks/useSettings').ClientSettings>(
    key: K,
    value: import('../../hooks/useSettings').ClientSettings[K],
  ) => {
    updateSetting(key, value);
    const backendKey = PROFILE_KEY_MAP[key];
    if (backendKey) {
      profileApi
        .update({ [backendKey]: value })
        .catch((err: unknown) => {
          console.warn('SettingsScreen: failed to sync profile setting', key, errorMessage(err));
        });
    }
  };

  // Map client setting keys to backend notification preference fields
  const NOTIFICATION_KEY_MAP: Partial<Record<keyof import('../../hooks/useSettings').ClientSettings, string>> = {
    dailyCheckin: 'daily_checkin_enabled',
    mealReminders: 'eat_enabled',
    fastingAlerts: 'fasting_enabled',
    weeklySummary: 'weekly_summary_enabled',
  };

  const handleNotificationToggle = <K extends keyof import('../../hooks/useSettings').ClientSettings>(
    key: K,
    value: import('../../hooks/useSettings').ClientSettings[K],
  ) => {
    updateSetting(key, value);
    const backendKey = NOTIFICATION_KEY_MAP[key];
    if (backendKey) {
      notificationsApi
        .updatePreferences({ [backendKey]: value })
        .catch((err: unknown) => {
          console.warn('SettingsScreen: failed to sync notification pref', key, errorMessage(err));
        });
    }
  };

  const stepMeals = (delta: number) => {
    const next = Math.min(6, Math.max(2, settings.mealsPerDay + delta));
    mediumTap();
    handleProfileSettingUpdate('mealsPerDay', next);
  };

  const stepWater = (delta: number) => {
    const next = Math.min(200, Math.max(40, settings.waterGoalOz + delta));
    handleProfileSettingUpdate('waterGoalOz', next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <HapticPressable intent="light" onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {currentUser?.name?.charAt(0)?.toUpperCase() || ''}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>
              {currentUser?.name || 'No name set'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValueMuted}>{currentUser?.email}</Text>
          </View>
          <HapticPressable intent="light" style={styles.row} onPress={() => setShowPasswordModal(true)}>
            <Text style={styles.rowLabel}>Change Password</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          {/* Settings > Account > Delete account (D2 contract wording). */}
          <HapticPressable
            intent="warning"
            style={styles.row}
            onPress={() => navigation.navigate('DeleteAccount')}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            testID="settings-delete-account"
            accessibilityHint="Opens the account deletion screen with a 14-day grace period"
          >
            <Text style={[styles.rowLabel, { color: colors.error }]}>Delete account</Text>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </HapticPressable>
        </View>

        {/* Clinic tutorial: resume or rerun Roman's tour (flag-gated). */}
        <TutorialSettingsRow />

        {/* Nutrition Preferences */}
        <Text style={styles.sectionLabel}>Nutrition Preferences</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Meals Per Day</Text>
            <View style={styles.stepper}>
              <HapticPressable intent="light" onPress={() => stepMeals(-1)} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </HapticPressable>
              <Text style={styles.stepValue}>{settings.mealsPerDay}</Text>
              <HapticPressable intent="light" onPress={() => stepMeals(1)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </HapticPressable>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Water Goal (fl oz)</Text>
            <View style={styles.stepper}>
              <HapticPressable intent="light" onPress={() => stepWater(-10)} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </HapticPressable>
              <Text style={styles.stepValue}>{settings.waterGoalOz}</Text>
              <HapticPressable intent="light" onPress={() => stepWater(10)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </HapticPressable>
            </View>
          </View>
        </View>

        {/* Notifications */}
        <Text style={styles.sectionLabel}>Notifications</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Daily Check-in</Text>
            <Switch
              value={settings.dailyCheckin}
              onValueChange={(v) => handleNotificationToggle('dailyCheckin', v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
          {settings.dailyCheckin && checkInLabel && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Check-in Time</Text>
              <Text style={styles.rowValue}>{checkInLabel}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Meal Reminders</Text>
            <Switch
              value={settings.mealReminders}
              onValueChange={(v) => handleNotificationToggle('mealReminders', v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Fasting Alerts</Text>
            <Switch
              value={settings.fastingAlerts}
              onValueChange={(v) => handleNotificationToggle('fastingAlerts', v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Weekly Summary</Text>
            <Switch
              value={settings.weeklySummary}
              onValueChange={(v) => handleNotificationToggle('weeklySummary', v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
        </View>

        {/* App Preferences */}
        <Text style={styles.sectionLabel}>App Preferences</Text>
        <View style={styles.card}>
          {/* Appearance — coherent light rendering for launch */}
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
            <Text style={styles.rowLabel}>Appearance</Text>
            <View style={styles.appearanceRow}>
              {(['light', 'system'] as const).map((option: AppearanceOverride) => (
                <HapticPressable
                  key={option}
                  intent="light"
                  style={styles.radioOption}
                  onPress={() => setAppearanceOverride(option)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.charAt(0).toUpperCase() + option.slice(1)}
                  accessibilityState={{ checked: appearanceOverride === option }}
                >
                  <View style={[styles.radioCircle, appearanceOverride === option && styles.radioCircleActive]}>
                    {appearanceOverride === option && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.radioLabel, appearanceOverride === option && styles.radioLabelActive]}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </Text>
                </HapticPressable>
              ))}
            </View>
            <Text style={styles.rowValue}>Light appearance is used for both options.</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Haptics enabled</Text>
            <Switch
              value={settings.hapticsEnabled}
              onValueChange={(v) => updateSetting('hapticsEnabled', v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
              accessibilityLabel="Haptics enabled"
              accessibilityRole="switch"
            />
          </View>
        </View>


        {/* Security */}
        <Text style={styles.sectionLabel}>Security</Text>
        <View style={styles.card}>
          <BiometricUnlockSetting />
        </View>

        {/* AUDIT-12-125: the Personalization row is not offered. Nothing in the
            app or on the server reads those choices (home modules, cadence
            incl. "Off", tone, units, week start), so they had no effect. */}
        <Text style={styles.sectionLabel}>Notification settings</Text>
        <View style={styles.card}>
          {/* Audit P1: surface the canonical NotificationPreferences screen
              from Settings. The local Notifications switches above only
              control the legacy useSettings flags; full channel + quiet-hour
              control lives here. */}
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('NotificationSettings')}
            accessibilityRole="button"
            accessibilityLabel="Notification preferences"
            accessibilityHint="Opens detailed channel and quiet-hour controls"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="notifications-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>Notification preferences</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>

        {/* Support */}
        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.card}>
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('SupportInbox')}
            accessibilityRole="button"
            accessibilityLabel="Support inbox"
            accessibilityHint="Opens the live support chat"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>

        {/* Privacy (D2 contract wording: Settings > Privacy > Roman and AI) */}
        <Text style={styles.sectionLabel}>Privacy</Text>
        <View style={styles.card}>
          {/* Psych #2: Trust as Emotion — Trust Center navigation row */}
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('TrustCenter')}
            accessibilityRole="button"
            accessibilityLabel="Trust and Privacy"
            accessibilityHint="Opens the Trust Center with security details and privacy controls"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>Trust & Privacy</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          {/* B-SHARE-127: which logs the coach can see (four toggles). */}
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('CoachSharing')}
            accessibilityRole="button"
            accessibilityLabel={coachSharingCopy.settingsRow}
            accessibilityHint={coachSharingCopy.settingsRowHint}
            testID="settings-coach-sharing"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>{coachSharingCopy.settingsRow}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          {/* D2 (Opus A-05): the optional Roman and AI choice from the
              onboarding agreement can be allowed or withdrawn here. Shown
              in builds where that choice can be made. */}
          {featureFlags.consultationOnboarding || featureFlags.romanChat ? (
            <HapticPressable
              intent="light"
              style={styles.row}
              onPress={() => navigation.navigate('RomanAiConsent')}
              accessibilityRole="button"
              accessibilityLabel="Roman and AI"
              accessibilityHint="Allow or withdraw Roman and your coach's AI tools using your information"
              testID="settings-roman-ai"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                <Text style={styles.rowLabel}>Roman and AI</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </HapticPressable>
          ) : null}
          {/* iMessage-grade DM — Apple 1.2 compliance. Users must be able to
              view and undo their blocks from Settings. */}
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('BlockedUsers')}
            accessibilityRole="button"
            accessibilityLabel="Blocked Users"
            accessibilityHint="View and manage the users you've blocked"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="ban-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>Blocked Users</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          {/* Phase 10 — GDPR Article 20 data portability */}
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('DataExport')}
            accessibilityRole="button"
            accessibilityLabel="Request my data export"
            accessibilityHint="Download a copy of your personal data"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="download-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>My data</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          <HapticPressable intent="warning" style={styles.row} onPress={handleResetOnboarding}>
            <Text style={styles.rowLabel}>Reset Onboarding</Text>
            <Ionicons name="refresh-outline" size={18} color={colors.warning} />
          </HapticPressable>
        </View>

        {/* Sign Out */}
        <HapticPressable intent="warning" style={styles.signOutBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </HapticPressable>

        {/* About */}
        <View style={styles.about}>
          <Text style={styles.aboutText}>The Growth Project v1.0.0</Text>
          <Text style={styles.aboutSub}>A daily practice.</Text>
        </View>
      </ScrollView>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <HapticPressable
                intent="light"
                onPress={() => {
                  setShowPasswordModal(false);
                  setPasswordError('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </HapticPressable>
            </View>
            <TextInput
              style={styles.input}
              placeholder="New password (min 8 chars)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              accessibilityLabel="New password"
              textContentType="newPassword"
            />
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              accessibilityLabel="Confirm new password"
              textContentType="newPassword"
            />
            {passwordError ? (
              <Text
                style={{ color: colors.error, fontSize: 13, marginTop: 10, textAlign: 'center' }}
                accessibilityLiveRegion="assertive"
              >
                {passwordError}
              </Text>
            ) : null}
            <HapticPressable
              intent="success"
              style={[styles.saveBtn, passwordBusy && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={passwordBusy}
              accessibilityRole="button"
              accessibilityLabel="Update password"
            >
              <Text style={styles.saveBtnText}>{passwordBusy ? 'Updating…' : 'Update Password'}</Text>
            </HapticPressable>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    overflow: 'hidden',
  },
  avatar: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 16,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.textOnPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowValueMuted: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 0, // radius.sm
    overflow: 'hidden',
  },
  segBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  segBtnActive: {
    backgroundColor: colors.primary,
  },
  segText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segTextActive: {
    color: colors.textOnPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValue: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    minWidth: 30,
    textAlign: 'center',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.error,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
  about: {
    alignItems: 'center',
    marginTop: 24,
    gap: 4,
  },
  aboutText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  aboutSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textOnPrimary,
  },
  exportText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: 12,
  },
  exportHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: 16,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '400' as const,
  },
  radioLabelActive: {
    color: colors.textPrimary,
    fontWeight: '500' as const,
  },

  });
