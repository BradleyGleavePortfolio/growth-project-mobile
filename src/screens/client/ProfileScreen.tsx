import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/colors';
import { ProfileStackParamList } from '../../navigation/ClientNavigator';

type Nav = NativeStackNavigationProp<ProfileStackParamList>;

export default function ProfileScreen() {
  const currentUser = useCurrentUser();
  const { clientProfile, signOut } = useAuthStore();
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
    { label: 'Sex', value: clientProfile?.sex || 'Not set' },
    { label: 'Date of Birth', value: clientProfile?.dob || 'Not set' },
    { label: 'Current Weight', value: clientProfile?.currentWeight ? `${clientProfile.currentWeight} lbs` : 'Not set' },
    { label: 'Target Weight', value: clientProfile?.targetWeight ? `${clientProfile.targetWeight} lbs` : 'Not set' },
    { label: 'Activity Level', value: clientProfile?.activityLevel || 'Not set' },
    { label: 'Goal', value: clientProfile?.primaryGoal || 'Not set' },
  ];

  const targetItems = [
    { label: 'TDEE', value: clientProfile?.tdee ? `${clientProfile.tdee} kcal` : '--' },
    { label: 'Calorie Target', value: clientProfile?.calorieTarget ? `${clientProfile.calorieTarget} kcal` : '--' },
    { label: 'Protein', value: clientProfile?.proteinTarget ? `${clientProfile.proteinTarget}g` : '--' },
    { label: 'Carbs', value: clientProfile?.carbTarget ? `${clientProfile.carbTarget}g` : '--' },
    { label: 'Fat', value: clientProfile?.fatTarget ? `${clientProfile.fatTarget}g` : '--' },
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

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="settings-outline" size={22} color={Colors.primary} />
          <Text style={styles.actionText}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Report')}>
          <Ionicons name="document-text-outline" size={22} color={Colors.primary} />
          <Text style={styles.actionText}>My Report</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Widgets')}>
          <Ionicons name="apps-outline" size={22} color={Colors.primary} />
          <Text style={styles.actionText}>Widgets</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Learn')}>
          <Ionicons name="book-outline" size={22} color={Colors.primary} />
          <Text style={styles.actionText}>Learn</Text>
        </TouchableOpacity>
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

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={Colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
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
    color: '#fff',
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
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 28,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionText: {
    fontSize: 15,
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
