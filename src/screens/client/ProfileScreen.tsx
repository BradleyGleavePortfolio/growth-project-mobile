import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCurrentUser } from '../../hooks/useCurrentUser';
// Security: sign-out was previously routed through the dead SQLite-backed
// useAuthStore, which only cleared tokens as a side effect and left Zustand
// state in memory from the previous user. It now goes through authActions
// which clears tokens, storage, and notifies the auth event emitter.
import { signOut } from '../../services/authActions';
import { Colors } from '../../constants/colors';
// Round 3: ProfileStack was folded into MoreStack during the 9→5 tab consolidation.
// Settings/Report/Widgets/Learn screens are unchanged — only the parent stack is renamed.
import { MoreStackParamList } from '../../navigation/ClientNavigator';

type Nav = NativeStackNavigationProp<MoreStackParamList>;

export default function ProfileScreen() {
  const currentUser = useCurrentUser();
  // signOut imported directly — no store wiring needed.
  const navigation = useNavigation<Nav>();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const profileItems = [
    { label: 'Name', value: currentUser?.name || 'No name set' },
    { label: 'Email', value: currentUser?.email || '' },
    { label: 'Sex', value: currentUser?.profile?.sex || 'Not set' },
    { label: 'Date of Birth', value: currentUser?.profile?.dob || 'Not set' },
    { label: 'Current Weight', value: currentUser?.profile?.current_weight ? `${currentUser.profile.current_weight} lbs` : 'Not set' },
    { label: 'Target Weight', value: currentUser?.profile?.target_weight ? `${currentUser.profile.target_weight} lbs` : 'Not set' },
    { label: 'Activity Level', value: currentUser?.profile?.activity_level || 'Not set' },
    { label: 'Goal', value: currentUser?.profile?.primary_goal || 'Not set' },
  ];

  const targetItems = [
    { label: 'TDEE', value: currentUser?.profile?.tdee ? `${currentUser.profile.tdee} kcal` : '--' },
    { label: 'Calorie Target', value: currentUser?.profile?.calorie_target ? `${currentUser.profile.calorie_target} kcal` : '--' },
    { label: 'Protein', value: currentUser?.profile?.protein_target ? `${currentUser.profile.protein_target}g` : '--' },
    { label: 'Carbs', value: currentUser?.profile?.carbs_target ? `${currentUser.profile.carbs_target}g` : '--' },
    { label: 'Fat', value: currentUser?.profile?.fat_target ? `${currentUser.profile.fat_target}g` : '--' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {currentUser?.name?.charAt(0)?.toUpperCase() || ''}
          </Text>
        </View>
        <Text style={styles.name}>
          {currentUser?.name || 'No name set'}
        </Text>
        <Text style={styles.email}>{currentUser?.email || ''}</Text>
      </View>

      {/* Quick Actions — 2x2 grid. Round 3: each TouchableOpacity gets a
          real a11y label / hint so VoiceOver announces destination, not "button". */}
      <View style={styles.actionsGrid}>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Opens app settings"
        >
          <Ionicons name="settings-outline" size={24} color={Colors.primary} />
          <Text style={styles.actionText}>Settings</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Report')}
          accessibilityRole="button"
          accessibilityLabel="My report"
          accessibilityHint="Opens your progress report"
        >
          <Ionicons name="document-text-outline" size={24} color={Colors.primary} />
          <Text style={styles.actionText}>My Report</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Widgets')}
          accessibilityRole="button"
          accessibilityLabel="Widgets"
          accessibilityHint="Customize your dashboard widgets"
        >
          <Ionicons name="apps-outline" size={24} color={Colors.primary} />
          <Text style={styles.actionText}>Widgets</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Learn')}
          accessibilityRole="button"
          accessibilityLabel="Learn"
          accessibilityHint="Opens learning content"
        >
          <Ionicons name="book-outline" size={24} color={Colors.primary} />
          <Text style={styles.actionText}>Learn</Text>
        </HapticPressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Personal Info</Text>
        {profileItems.map((item) => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily Targets</Text>
        {targetItems.map((item) => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={[styles.rowValue, { color: Colors.primary }]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      <HapticPressable intent="warning" style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={Colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </HapticPressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
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
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textOnPrimary, // Round 3: hex → token
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  email: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 28,
  },
  actionBtn: {
    width: '47%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error,
  },
});
