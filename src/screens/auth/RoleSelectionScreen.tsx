import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  StatusBar,
  ActivityIndicator,
  Alert,
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

export default function RoleSelectionScreen({ navigation }: Props) {
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [coachPin, setCoachPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);

  const getUserName = async (): Promise<string> => {
    try {
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const user = JSON.parse(raw);
        return user.name?.split(' ')[0] || 'there';
      }
    } catch {}
    return 'there';
  };

  const handleRoleSelect = async (role: 'coach' | 'student', coachCode?: string) => {
    setLoading(true);
    try {
      const res = await authApi.selectRole(role, coachCode);
      // Update stored user_data with new role
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const user = JSON.parse(raw);
        user.role = res.data.role;
        await AsyncStorage.setItem('user_data', JSON.stringify(user));
      }
      // Clear the role selection flag — registration is fully complete
      await AsyncStorage.removeItem('needs_role_selection');
      // Fire auth event — RootNavigator will re-render with the right navigator
      authEvents.emit();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to set role. Try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStudentSelect = () => handleRoleSelect('student');

  const handleCoachPinSubmit = () => {
    if (coachPin.length < 7) {
      setPinError('Enter the full 7-digit code');
      return;
    }
    setShowCoachModal(false);
    setCoachPin('');
    setPinError('');
    handleRoleSelect('coach', coachPin);
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
          style={styles.roleCard}
          onPress={() => setShowCoachModal(true)}
          disabled={loading}
          activeOpacity={0.8}
        >
          <View style={[styles.roleIconContainer, styles.coachIcon]}>
            <Ionicons name="school" size={32} color="#40916c" />
          </View>
          <Text style={styles.roleTitle}>I'm a Coach</Text>
          <Text style={styles.roleDescription}>
            Manage clients, create plans, and track their progress
          </Text>
          <View style={styles.roleArrow}>
            <Ionicons name="arrow-forward" size={20} color="#40916c" />
          </View>
        </TouchableOpacity>
      </View>

      {/* Coach PIN Modal */}
      <Modal
        visible={showCoachModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCoachModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Coach Access Code</Text>
            <Text style={styles.modalSubtitle}>
              Enter the 7-digit code provided by The Growth Project
            </Text>

            {pinError ? (
              <View style={styles.pinErrorContainer}>
                <Ionicons name="alert-circle" size={16} color={Colors.error} />
                <Text style={styles.pinErrorText}>{pinError}</Text>
              </View>
            ) : null}

            <TextInput
              style={styles.pinInput}
              value={coachPin}
              onChangeText={(text) => {
                setCoachPin(text.replace(/[^0-9]/g, ''));
                setPinError('');
              }}
              placeholder="Enter 7-digit code"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              maxLength={7}
              textAlign="center"
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowCoachModal(false);
                  setCoachPin('');
                  setPinError('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmitButton,
                  coachPin.length < 7 && styles.modalSubmitDisabled,
                ]}
                onPress={handleCoachPinSubmit}
                disabled={coachPin.length < 7}
              >
                <Text style={styles.modalSubmitText}>Verify</Text>
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
    borderRadius: 16,
    padding: 24,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  roleIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  coachIcon: {
    backgroundColor: 'rgba(64, 145, 108, 0.12)',
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  pinErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(230, 57, 70, 0.1)',
    padding: 10,
    borderRadius: 8,
    gap: 6,
    marginBottom: 16,
  },
  pinErrorText: {
    color: Colors.error,
    fontSize: 13,
    flex: 1,
  },
  pinInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 4,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalSubmitButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSubmitDisabled: {
    opacity: 0.5,
  },
  modalSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});
