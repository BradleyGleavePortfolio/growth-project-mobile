import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
import { signOut, refreshProfile, prepareSignOutConfirm } from '../../services/authActions';
import { useSettings } from '../../hooks/useSettings';
import { readDayOneAnswers, type DayOneCheckInTime } from '../day-one/answers';
import { profileApi, notificationsApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';

import { mediumTap, warningTap, successTap } from '../../utils/haptics';
import { updateSupabasePassword } from '../../utils/supabaseAuth';
import { cancelFastEndAlert } from '../../utils/fastingAlert';
import { useTheme, ThemeColors, AppearanceOverride } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import BiometricUnlockSetting from '../../components/BiometricUnlockSetting';
import ClientTutorialSetting from './settings/ClientTutorialSetting';
import { featureFlags } from '../../config/featureFlags';
import { coachSharingCopy } from '../../components/coachSharing/coachSharingCopy';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { layout, radius, typography, withAlpha } from '../../theme/tokens';
import { Headline, Overline, PrimaryButton, QuietRow, Screen, ScreenTopBar, TextLink } from '../../ui';
import SettingsSection from './settings/SettingsSection';
import { preferenceSaveFailureOf } from '../settings/notificationPreferenceErrors';

// Same rules and wording as ResetPasswordScreen checkPassword and sign-up
// (backend RegisterDto); first failure only. checkPassword is local to that
// screen, so the four rules are repeated here.
function newPasswordProblem(value: string): string | null {
  if (value.length < 8) return 'At least 8 characters.';
  if (!/[A-Z]/.test(value)) return 'At least one uppercase letter.';
  if (!/[0-9]/.test(value)) return 'At least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'At least one special character.';
  return null;
}

// Switches saved on the server: each says what it controls and writes the
// columns the backend really reads (digest.service.ts reads digest_email;
// the missed check-in nudge reads nudge_missed_checkin_*). The old
// daily_checkin_enabled / weekly_summary_enabled columns are mirrored only.
type ServerSwitchKey = 'dailyCheckin' | 'weeklySummary';
const SERVER_SWITCHES: Record<ServerSwitchKey, {
  noun: string;
  read: (row: Record<string, unknown>) => boolean;
  patch: (on: boolean) => Record<string, boolean>;
}> = {
  dailyCheckin: {
    noun: 'check-in reminder',
    read: (row) => row.nudge_missed_checkin_push !== false || row.nudge_missed_checkin_inapp !== false,
    patch: (on) => {
      const fields: Record<string, boolean> = {
        nudge_missed_checkin_push: on, nudge_missed_checkin_inapp: on, daily_checkin_enabled: on,
      };
      // Off also stops the email copy; on leaves that choice as it was.
      if (!on) fields.nudge_missed_checkin_email = false;
      return fields;
    },
  },
  weeklySummary: {
    noun: 'summary email',
    read: (row) => row.digest_email !== false,
    patch: (on) => ({ digest_email: on, weekly_summary_enabled: on }),
  },
};

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
  const [serverSwitches, setServerSwitches] = useState<Partial<Record<ServerSwitchKey, boolean>>>({});
  const [notificationError, setNotificationError] = useState('');

  // The switches show the saved server values, not this phone's defaults.
  useEffect(() => {
    let live = true;
    notificationsApi.getPreferences()
      .then((res: { data?: unknown }) => {
        const row = res?.data;
        if (!live || !row || typeof row !== 'object') return;
        const saved = row as Record<string, unknown>;
        // A switch changed before this read finished keeps the newer choice.
        setServerSwitches((current) => ({
          dailyCheckin: SERVER_SWITCHES.dailyCheckin.read(saved),
          weeklySummary: SERVER_SWITCHES.weeklySummary.read(saved),
          ...current,
        }));
      })
      .catch((err: unknown) => {
        console.warn('SettingsScreen: notification preferences did not load', errorMessage(err));
      });
    return () => { live = false; };
  }, []);

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
    const problem = newPasswordProblem(newPassword);
    if (problem) {
      setPasswordError(problem);
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
    // B1 (LN-OPUS-B-130): no promise about targets. Targets a coach set stay as they are (GET /me/macros/current).
    Alert.alert('Redo profile setup', 'Answer the setup questions again. Your logs and coach plans are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Redo setup',
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

  const handleSignOut = async () => {
    // SESSION-KEEP-130: one try to send what is waiting on this phone first;
    // the confirm names anything still unsent (sign-out removes it).
    const message = await prepareSignOutConfirm(currentUser?.id);
    if (message === null) return; // a confirm is already on its way
    Alert.alert('Sign out', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
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

  // Fasting alerts are scheduled on this phone (utils/notifications.ts reads
  // the local setting); fasting_enabled is a server mirror nothing reads.
  const NOTIFICATION_KEY_MAP: Partial<Record<keyof import('../../hooks/useSettings').ClientSettings, string>> = {
    fastingAlerts: 'fasting_enabled',
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

  // Off also cancels the alert already set for a fast that is running now
  // (new fasts are gated in utils/notifications.ts scheduleFastingAlert).
  const handleFastingAlertsToggle = (value: boolean) => {
    handleNotificationToggle('fastingAlerts', value);
    if (!value && currentUser?.id) void cancelFastEndAlert(currentUser.id);
  };

  const serverSwitchOn = (key: ServerSwitchKey) => serverSwitches[key] ?? settings[key];

  // A failed save puts the switch back and says so (FW-ACCOUNT U9).
  const handleServerToggle = async (key: ServerSwitchKey, value: boolean) => {
    const previous = serverSwitchOn(key);
    setNotificationError('');
    setServerSwitches((current) => ({ ...current, [key]: value }));
    try {
      await notificationsApi.updatePreferences(SERVER_SWITCHES[key].patch(value));
      updateSetting(key, value);
    } catch (err: unknown) {
      setServerSwitches((current) => ({ ...current, [key]: previous }));
      setNotificationError(preferenceSaveFailureOf(err, SERVER_SWITCHES[key].noun).message);
    }
  };

  const renderSwitch = (label: string, description: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={styles.row}>
      <View style={styles.switchText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.textOnPrimary}
      />
    </View>
  );

  const stepMeals = (delta: number) => {
    const next = Math.min(6, Math.max(2, settings.mealsPerDay + delta));
    mediumTap();
    handleProfileSettingUpdate('mealsPerDay', next);
  };

  const stepWater = (delta: number) => {
    const next = Math.min(200, Math.max(40, settings.waterGoalOz + delta));
    handleProfileSettingUpdate('waterGoalOz', next);
  };

  const initial = currentUser?.name?.trim().charAt(0).toUpperCase() || '';

  return (
    <Screen edges={['top']} testID="settings-screen" header={<ScreenTopBar onBack={() => navigation.goBack()} />}>
        <Headline level="h1">Settings</Headline>
        <Overline style={styles.overline}>Account, privacy and this phone</Overline>

        <SettingsSection title="Account" id="account">
          {initial ? (
            <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          ) : null}
          <QuietRow label="Name" value={currentUser?.name || 'No name set'} />
          <QuietRow label="Email" detail={currentUser?.email} />
          {currentUser && !currentUser.coach_id ? (
            <QuietRow label="Add a coach code" detail="Connect this account to a coach." testID="settings-add-coach-code"
              onPress={() => navigation.navigate('AddCoachCode')} />
          ) : null}
          <QuietRow label="Change password" onPress={() => setShowPasswordModal(true)} />
          {/* Appearance remains on this screen, with light rendering for launch. */}
          <View style={[styles.row, styles.rowStacked]}>
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
            <Text style={styles.rowHint}>Light appearance is used for both options.</Text>
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
          <BiometricUnlockSetting />
          <QuietRow label="Redo profile setup" detail="Answer the setup questions again." onPress={handleResetOnboarding} />
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
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
          <TextLink label="Sign out" tone="ink" underline={false} align="start" style={styles.signOut}
            onPress={() => { void handleSignOut(); }} />
        </SettingsSection>

        <SettingsSection title="Training and food" id="training-food">
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Meals per day</Text>
            <View style={styles.stepper}>
              <HapticPressable intent="light" onPress={() => stepMeals(-1)} style={styles.stepBtn} accessibilityLabel="Decrease meals per day">
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </HapticPressable>
              <Text style={styles.stepValue}>{settings.mealsPerDay}</Text>
              <HapticPressable intent="light" onPress={() => stepMeals(1)} style={styles.stepBtn} accessibilityLabel="Increase meals per day">
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </HapticPressable>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Water goal (fl oz)</Text>
            <View style={styles.stepper}>
              <HapticPressable intent="light" onPress={() => stepWater(-10)} style={styles.stepBtn} accessibilityLabel="Decrease water goal">
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </HapticPressable>
              <Text style={styles.stepValue}>{settings.waterGoalOz}</Text>
              <HapticPressable intent="light" onPress={() => stepWater(10)} style={styles.stepBtn} accessibilityLabel="Increase water goal">
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </HapticPressable>
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="Notifications" id="notifications">
          {renderSwitch('Check-in reminders', 'A reminder after two days without a check-in.',
            serverSwitchOn('dailyCheckin'), (v) => { void handleServerToggle('dailyCheckin', v); })}
          {checkInLabel ? (
            <QuietRow label="Check-in time" detail="The time you plan to check in each day." value={checkInLabel} />
          ) : null}
          {renderSwitch('Fasting alerts', 'A notification on this phone when your fasting window ends.',
            settings.fastingAlerts, handleFastingAlertsToggle)}
          {renderSwitch('Summary emails', 'Progress summaries sent to your email.',
            serverSwitchOn('weeklySummary'), (v) => { void handleServerToggle('weeklySummary', v); })}
          {notificationError ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite">{notificationError}</Text>
          ) : null}
          {/* Audit P1: the canonical NotificationPreferences screen (every channel). */}
          <QuietRow label="Notification preferences" onPress={() => navigation.navigate('NotificationSettings')}
            accessibilityHint="Opens detailed channel and quiet-hour controls" />
        </SettingsSection>

        <SettingsSection title="Privacy and data" id="privacy">
          <QuietRow label="Trust & Privacy" detail="How your data is protected." onPress={() => navigation.navigate('TrustCenter')}
            accessibilityHint="Opens the Trust Center with security details and privacy controls" />
          {/* B-SHARE-127: which logs the coach can see (four toggles). */}
          <QuietRow label={coachSharingCopy.settingsRow} onPress={() => navigation.navigate('CoachSharing')}
            accessibilityHint={coachSharingCopy.settingsRowHint} testID="settings-coach-sharing" />
          {/* Apple 1.2: blocks can be seen and undone from Settings. */}
          <QuietRow label="Blocked users" onPress={() => navigation.navigate('BlockedUsers')}
            accessibilityHint="View and manage the users you have blocked" />
          {/* Phase 10 — GDPR Article 20 data portability */}
          <QuietRow label="My data" detail="Request a copy of your data." onPress={() => navigation.navigate('DataExport')}
            accessibilityHint="Download a copy of your personal data" />
        </SettingsSection>

        {featureFlags.consultationOnboarding || featureFlags.romanChat ? (
          <SettingsSection title="Roman" id="roman">
            <QuietRow label="Roman and AI" onPress={() => navigation.navigate('RomanAiConsent')}
              accessibilityHint="Allow or withdraw Roman and your coach's AI tools using your information"
              testID="settings-roman-ai" />
          </SettingsSection>
        ) : null}

        <SettingsSection title="Support" id="support">
          <QuietRow label="Support" detail="Chat with the support team." onPress={() => navigation.navigate('SupportInbox')}
            accessibilityHint="Opens the live support chat" />
          <ClientTutorialSetting />
        </SettingsSection>

        <SettingsSection title="About" id="about">
          <View style={styles.about}>
            <Text style={styles.aboutText}>The Growth Project v1.0.0</Text>
            <Text style={styles.aboutSub}>A daily practice.</Text>
          </View>
        </SettingsSection>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change password</Text>
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
              placeholder="New password"
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
            <Text style={[styles.rowHint, { marginTop: 10 }]}>
              At least 8 characters, with an uppercase letter, a number and a special character.
            </Text>
            {passwordError ? (
              <Text style={styles.passwordError} accessibilityLiveRegion="assertive">
                {passwordError}
              </Text>
            ) : null}
            <PrimaryButton label="Update password" onPress={() => { void handleChangePassword(); }}
              loading={passwordBusy} style={styles.saveBtn} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  overline: {
    marginTop: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 4,
  },
  avatarText: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: layout.rowMinHeight,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  rowLabel: {
    ...typography.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  switchText: {
    flex: 1,
    paddingRight: 12,
    gap: 2,
  },
  rowHint: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  saveError: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValue: {
    ...typography.h3,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
    minWidth: 40,
    textAlign: 'center',
  },
  signOut: {
    marginTop: 8,
  },
  about: {
    paddingVertical: 16,
    gap: 4,
  },
  aboutText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  aboutSub: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: withAlpha(colors.textPrimary, 0.4),
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: layout.gutter,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.background,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  passwordError: {
    ...typography.bodySmall,
    color: colors.error,
    marginTop: 10,
  },
  saveBtn: {
    marginTop: 20,
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: 20,
  },
  radioOption: {
    minHeight: layout.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: radius.chip,
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
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    ...typography.bodySmall,
    fontSize: 15,
    color: colors.textSecondary,
  },
  radioLabelActive: {
    color: colors.textPrimary,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500' as const,
  },
  });
