import React, { useState, useMemo } from 'react';
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
import { profileApi, notificationsApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';

import { mediumTap, warningTap, successTap } from '../../utils/haptics';
import { updateSupabasePassword } from '../../utils/supabaseAuth';
import { useTheme, ThemeColors, AppearanceOverride } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import BiometricUnlockSetting from '../../components/BiometricUnlockSetting';
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
    unit: 'weight_unit',
    mealsPerDay: 'meals_per_day',
    waterGoalOz: 'water_goal_oz',
    calorieDisplay: 'calorie_display',
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
        </View>

        {/* Nutrition Preferences */}
        <Text style={styles.sectionLabel}>Nutrition Preferences</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Units</Text>
            <View style={styles.segmented}>
              {(['lbs', 'kg'] as const).map((u) => (
                <HapticPressable
                  key={u}
                  intent="light"
                  style={[styles.segBtn, settings.unit === u && styles.segBtnActive]}
                  onPress={() => handleProfileSettingUpdate('unit', u)}
                >
                  <Text style={[styles.segText, settings.unit === u && styles.segTextActive]}>{u}</Text>
                </HapticPressable>
              ))}
            </View>
          </View>
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
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Calorie Display</Text>
            <View style={styles.segmented}>
              {(['net', 'gross'] as const).map((c) => (
                <HapticPressable
                  key={c}
                  intent="light"
                  style={[styles.segBtn, settings.calorieDisplay === c && styles.segBtnActive]}
                  onPress={() => handleProfileSettingUpdate('calorieDisplay', c)}
                >
                  <Text style={[styles.segText, settings.calorieDisplay === c && styles.segTextActive]}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </Text>
                </HapticPressable>
              ))}
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
          {settings.dailyCheckin && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Check-in Time</Text>
              <Text style={styles.rowValue}>{settings.checkinHour}:00 AM</Text>
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
          {/* Appearance — Phase 11 dark mode */}
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
            <Text style={styles.rowLabel}>Appearance</Text>
            <View style={styles.appearanceRow}>
              {(['system', 'light', 'dark'] as const).map((option: AppearanceOverride) => (
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

        {/* Personalization — Psych #4 */}
        <Text style={styles.sectionLabel}>Personalization</Text>
        <View style={styles.card}>
          <HapticPressable
            intent="light"
            style={styles.row}
            onPress={() => navigation.navigate('Preferences')}
            accessibilityRole="button"
            accessibilityLabel="Personalization"
            accessibilityHint="Opens preference controls for home modules, notifications, tone, and units"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="options-outline" size={18} color={colors.primary} />
              <Text style={styles.rowLabel}>Personalization</Text>
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

        {/* Data & Privacy */}
        <Text style={styles.sectionLabel}>Data & Privacy</Text>
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
          <HapticPressable
            intent="warning"
            style={styles.row}
            onPress={() => navigation.navigate('DeleteAccount')}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityHint="Opens the account deletion screen with a 14-day grace period"
          >
            <Text style={[styles.rowLabel, { color: colors.error }]}>Delete my account</Text>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
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

