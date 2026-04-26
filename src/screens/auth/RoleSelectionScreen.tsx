import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'RoleSelection'>;
};

export default function RoleSelectionScreen(_: Props) {
  const [loading, setLoading] = useState(false);
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [coachPassword, setCoachPassword] = useState('');
  const [coachPasswordError, setCoachPasswordError] = useState('');

  const handleRoleSelect = async (role: 'coach' | 'student', coachCode?: string) => {
    setLoading(true);
    try {
      const res = await authApi.selectRole(role, coachCode);
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const user = JSON.parse(raw);
        user.role = res.data.role;
        await AsyncStorage.setItem('user_data', JSON.stringify(user));
      }
      await AsyncStorage.removeItem('needs_role_selection');
      authEvents.emit();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to set role. Try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStudentSelect = () => handleRoleSelect('student');

  const handleCoachConfirm = async () => {
    setCoachPasswordError('');
    if (coachPassword.length < 8) {
      setCoachPasswordError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.becomeCoach(coachPassword);
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const user = JSON.parse(raw);
        user.role = res.data.role;
        await AsyncStorage.setItem('user_data', JSON.stringify(user));
      }
      await AsyncStorage.removeItem('needs_role_selection');
      setShowCoachModal(false);
      authEvents.emit();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to become coach. Check your password.';
      setCoachPasswordError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.greeting}>Almost there!</Text>
        <Text style={styles.title}>Choose Your Role</Text>
        <Text style={styles.subtitle}>
          How will you be using The Growth Project?
        </Text>
      </View>

      <View style={styles.cardsContainer}>
        <TouchableOpacity
          style={styles.roleCard}
          onPress={handleStudentSelect}
          disabled={loading}
          activeOpacity={0.8}
        >
          <View style={styles.roleIconContainer}>
            <Ionicons name="person" size={32} color={Colors.primary} />
          </View>
          <Text style={styles.roleTitle}>I'm a Student</Text>
          <Text style={styles.roleDescription}>
            Track nutrition, workouts, and get personalized coaching
          </Text>
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
          ) : (
            <View style={styles.roleArrow}>
              <Ionicons name="arrow-forward" size={20} color={Colors.primary} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.roleCard, styles.coachCard]}
          onPress={() => setShowCoachModal(true)}
          disabled={loading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Register as a coach"
        >
          <View style={[styles.roleIconContainer, { backgroundColor: Colors.primaryDark + '20' }]}>
            <Ionicons name="people" size={32} color={Colors.primaryDark} />
          </View>
          <Text style={styles.roleTitle}>I'm a Coach</Text>
          <Text style={styles.roleDescription}>
            Manage clients, assign meal plans, and track their progress
          </Text>
          <View style={styles.roleArrow}>
            <Ionicons name="arrow-forward" size={20} color={Colors.primaryDark} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Coach password-confirmation modal */}
      <Modal visible={showCoachModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirm Your Password</Text>
            <Text style={styles.modalDesc}>
              Enter your current password to activate your coach account.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={coachPassword}
              onChangeText={setCoachPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoFocus
              textContentType="password"
              accessibilityLabel="Current password"
            />
            {coachPasswordError ? (
              <Text style={styles.errorText}>{coachPasswordError}</Text>
            ) : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowCoachModal(false);
                  setCoachPassword('');
                  setCoachPasswordError('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, loading && { opacity: 0.6 }]}
                onPress={handleCoachConfirm}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.textOnPrimary} size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
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
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  header: {
    marginBottom: 40,
  },
  greeting: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  cardsContainer: {
    gap: 16,
  },
  roleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 24,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  coachCard: {
    borderColor: Colors.primaryDark + '40',
  },
  roleIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  roleTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  roleDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  roleArrow: {
    marginTop: 12,
    alignSelf: 'flex-end',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
});
