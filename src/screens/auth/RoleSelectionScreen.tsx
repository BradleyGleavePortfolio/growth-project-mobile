import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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

export default function RoleSelectionScreen(_: Props) {
  const [loading, setLoading] = useState(false);

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

        {/*
         * Coach card hidden: coach accounts are SQL-provisioned per operator
         * (see fitness-client-pov-audit.md A1 — the in-app flow always 403s
         * on /auth/select-role). Bringing it back requires a real coach
         * signup story on the backend.
         */}
      </View>
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
});
