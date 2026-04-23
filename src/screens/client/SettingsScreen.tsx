import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
// Security: sign-out now flows through a central helper that clears tokens,
// AsyncStorage, and every in-memory Zustand store — replacing the old
// useAuthStore.signOut() which only cleared tokens as a side effect.
import { signOut } from '../../services/signOut';
import { useSettings } from '../../hooks/useSettings';
import { profileApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { Colors } from '../../constants/colors';
import { mediumTap, warningTap, successTap } from '../../utils/haptics';

export default function SettingsScreen({ navigation }: any) {
  const currentUser = useCurrentUser();
  const { settings, updateSetting } = useSettings();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleChangePassword = () => {
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    successTap();
    setShowPasswordModal(false);
    setCurrentPassword('');
    setNewPassword('');
    Alert.alert('Success', 'Password changed successfully.');
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

  const stepMeals = (delta: number) => {
    const next = Math.min(6, Math.max(2, settings.mealsPerDay + delta));
    mediumTap();
    updateSetting('mealsPerDay', next);
  };

  const stepWater = (delta: number) => {
    const next = Math.min(200, Math.max(40, settings.waterGoalOz + delta));
    updateSetting('waterGoalOz', next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
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
          <TouchableOpacity style={styles.row} onPress={() => setShowPasswordModal(true)}>
            <Text style={styles.rowLabel}>Change Password</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Nutrition Preferences */}
        <Text style={styles.sectionLabel}>Nutrition Preferences</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Units</Text>
            <View style={styles.segmented}>
              {(['lbs', 'kg'] as const).map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.segBtn, settings.unit === u && styles.segBtnActive]}
                  onPress={() => updateSetting('unit', u)}
                >
                  <Text style={[styles.segText, settings.unit === u && styles.segTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Meals Per Day</Text>
            <View style={styles.stepper}>
              <TouchableOpacity onPress={() => stepMeals(-1)} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.stepValue}>{settings.mealsPerDay}</Text>
              <TouchableOpacity onPress={() => stepMeals(1)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Water Goal (fl oz)</Text>
            <View style={styles.stepper}>
              <TouchableOpacity onPress={() => stepWater(-10)} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.stepValue}>{settings.waterGoalOz}</Text>
              <TouchableOpacity onPress={() => stepWater(10)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Calorie Display</Text>
            <View style={styles.segmented}>
              {(['net', 'gross'] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.segBtn, settings.calorieDisplay === c && styles.segBtnActive]}
                  onPress={() => updateSetting('calorieDisplay', c)}
                >
                  <Text style={[styles.segText, settings.calorieDisplay === c && styles.segTextActive]}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </Text>
                </TouchableOpacity>
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
              onValueChange={(v) => updateSetting('dailyCheckin', v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
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
              onValueChange={(v) => updateSetting('mealReminders', v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Fasting Alerts</Text>
            <Switch
              value={settings.fastingAlerts}
              onValueChange={(v) => updateSetting('fastingAlerts', v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Weekly Summary</Text>
            <Switch
              value={settings.weeklySummary}
              onValueChange={(v) => updateSetting('weeklySummary', v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* App Preferences */}
        <Text style={styles.sectionLabel}>App Preferences</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Theme</Text>
            <Text style={styles.rowValueMuted}>Light</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Haptics</Text>
            <Switch
              value={settings.hapticsEnabled}
              onValueChange={(v) => updateSetting('hapticsEnabled', v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Data & Privacy */}
        <Text style={styles.sectionLabel}>Data & Privacy</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={() => setShowExportModal(true)}>
            <Text style={styles.rowLabel}>Export Data</Text>
            <Ionicons name="download-outline" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={handleResetOnboarding}>
            <Text style={styles.rowLabel}>Reset Onboarding</Text>
            <Ionicons name="refresh-outline" size={18} color={Colors.warning} />
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* About */}
        <View style={styles.about}>
          <Text style={styles.aboutText}>The Growth Project v1.0.0</Text>
          <Text style={styles.aboutSub}>Built with love for your health</Text>
        </View>
      </ScrollView>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder="New password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleChangePassword}>
              <Text style={styles.saveBtnText}>Update Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Export Modal */}
      <Modal visible={showExportModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Export Data</Text>
              <TouchableOpacity onPress={() => setShowExportModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.exportText}>
              Your data export would include all food logs, weight logs, fasting sessions, and profile data.
            </Text>
            <Text style={styles.exportHint}>
              This feature will be available in a future update with cloud sync.
            </Text>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: Colors.surface }]}
              onPress={() => setShowExportModal(false)}
            >
              <Text style={[styles.saveBtnText, { color: Colors.textPrimary }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  avatar: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 16,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  rowValueMuted: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 8,
    overflow: 'hidden',
  },
  segBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  segBtnActive: {
    backgroundColor: Colors.primary,
  },
  segText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  segTextActive: {
    color: '#fff',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error,
  },
  about: {
    alignItems: 'center',
    marginTop: 24,
    gap: 4,
  },
  aboutText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  aboutSub: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
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
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  exportText: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 22,
    marginBottom: 12,
  },
  exportHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
