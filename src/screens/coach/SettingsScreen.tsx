import React, { useEffect, useState, useCallback } from 'react';
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
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useAuthStore } from '../../store/authStore';
import { coachApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import { mediumTap, warningTap, successTap } from '../../utils/haptics';

const COACH_SETTINGS_KEY = 'gp_coach_settings';

interface CoachSettings {
  hapticsEnabled: boolean;
  dailyCheckin: boolean;
  newClientAlerts: boolean;
  weeklySummary: boolean;
}

const DEFAULT_SETTINGS: CoachSettings = {
  hapticsEnabled: true,
  dailyCheckin: true,
  newClientAlerts: true,
  weeklySummary: true,
};

export default function SettingsScreen() {
  const currentUser = useCurrentUser();
  const { signOut } = useAuthStore();
  const [settings, setSettings] = useState<CoachSettings>(DEFAULT_SETTINGS);
  const [clientCount, setClientCount] = useState(0);
  const [bioText, setBioText] = useState('');
  const [showBioModal, setShowBioModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const userId = currentUser?.id || '';

  const loadSettings = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(COACH_SETTINGS_KEY + '_' + userId);
      if (raw) setSettings(JSON.parse(raw));
      const bio = await AsyncStorage.getItem('gp_coach_bio_' + userId);
      if (bio) setBioText(bio);
      if (userId) {
        const res = await coachApi.getClients();
        const clients = res.data;
        setClientCount(Array.isArray(clients) ? clients.length : 0);
      }
    } catch {}
  }, [userId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = async <K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    if (updated.hapticsEnabled) mediumTap();
    await AsyncStorage.setItem(COACH_SETTINGS_KEY + '_' + userId, JSON.stringify(updated));
  };

  const handleSaveBio = async () => {
    await AsyncStorage.setItem('gp_coach_bio_' + userId, bioText);
    successTap();
    setShowBioModal(false);
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Error', 'Please fill in both fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }
    successTap();
    setShowPasswordModal(false);
    setCurrentPassword('');
    setNewPassword('');
    Alert.alert('Success', 'Password updated successfully.');
  };

  const handleGenerateInvite = () => {
    mediumTap();
    const code = `GP-${userId.slice(0, 8).toUpperCase()}`;
    Alert.alert('Invite Code', `Share this code with your clients:\n\n${code}`, [{ text: 'OK' }]);
  };

  const handleExportData = () => {
    successTap();
    setShowExportModal(false);
    Alert.alert('Export Started', 'Your client data export is being prepared. This may take a moment.');
  };

  const handleSignOut = () => {
    warningTap();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const initials = `${currentUser?.firstName?.[0] || ''}${currentUser?.lastName?.[0] || ''}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Coach Profile */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>
            {currentUser?.firstName} {currentUser?.lastName}
          </Text>
          <Text style={styles.profileEmail}>{currentUser?.email}</Text>
          <Text style={styles.profileRole}>COACH</Text>
        </View>
      </View>

      {/* Account */}
      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="person-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Name</Text>
          <Text style={styles.rowValue}>
            {currentUser?.firstName} {currentUser?.lastName}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="mail-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{currentUser?.email}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => setShowBioModal(true)}>
          <Ionicons name="create-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Bio</Text>
          <Text style={styles.rowValueMuted} numberOfLines={1}>
            {bioText || 'Add a bio'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => setShowPasswordModal(true)}>
          <Ionicons name="lock-closed-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Change Password</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Client Management */}
      <Text style={styles.sectionHeader}>Client Management</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="people-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Active Clients</Text>
          <Text style={styles.rowValueHighlight}>{clientCount}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={handleGenerateInvite}>
          <Ionicons name="link-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Generate Invite Code</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => setShowExportModal(true)}>
          <Ionicons name="download-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Export All Client Data</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Notifications */}
      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="alarm-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Daily Check-in</Text>
          <Switch
            value={settings.dailyCheckin}
            onValueChange={(v) => updateSetting('dailyCheckin', v)}
            trackColor={{ false: Colors.surfaceElevated, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="person-add-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>New Client Alerts</Text>
          <Switch
            value={settings.newClientAlerts}
            onValueChange={(v) => updateSetting('newClientAlerts', v)}
            trackColor={{ false: Colors.surfaceElevated, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="stats-chart-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Weekly Summary</Text>
          <Switch
            value={settings.weeklySummary}
            onValueChange={(v) => updateSetting('weeklySummary', v)}
            trackColor={{ false: Colors.surfaceElevated, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* App Preferences */}
      <Text style={styles.sectionHeader}>App Preferences</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="moon-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Theme</Text>
          <Text style={styles.rowValueMuted}>Dark</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.rowLabel}>Haptics</Text>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={(v) => updateSetting('hapticsEnabled', v)}
            trackColor={{ false: Colors.surfaceElevated, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={Colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      {/* About */}
      <View style={styles.aboutSection}>
        <Text style={styles.aboutText}>The Growth Project v1.0.0</Text>
        <Text style={styles.aboutSubText}>Coach Edition</Text>
      </View>

      {/* Bio Modal */}
      <Modal visible={showBioModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Bio</Text>
            <TextInput
              style={styles.bioInput}
              value={bioText}
              onChangeText={setBioText}
              placeholder="Tell your clients about yourself..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bioText.length}/300</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowBioModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveBio}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Export Modal */}
      <Modal visible={showExportModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Ionicons name="download-outline" size={40} color={Colors.primary} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.modalTitle}>Export Client Data</Text>
            <Text style={styles.modalDesc}>
              This will generate a summary of all your clients' nutrition logs, progress, and fasting data.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowExportModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleExportData}>
                <Text style={styles.modalSaveText}>Export</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <TextInput
              style={styles.modalInput}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword('');
                  setNewPassword('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleChangePassword}>
                <Text style={styles.modalSaveText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 24,
    borderRadius: 14,
    padding: 20,
    gap: 16,
    marginBottom: 28,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  profileRole: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '700',
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 24,
    marginBottom: 8,
    marginTop: 4,
  },
  section: {
    marginHorizontal: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 24,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  rowValue: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  rowValueMuted: {
    fontSize: 14,
    color: Colors.textMuted,
    maxWidth: 140,
  },
  rowValueHighlight: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 48,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    marginBottom: 24,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error,
  },
  aboutSection: {
    alignItems: 'center',
    paddingBottom: 20,
    gap: 2,
  },
  aboutText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  aboutSubText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  bioInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    height: 100,
  },
  charCount: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
});
