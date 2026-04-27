/**
 * ProfileScreen — Wave 3: luxury redesign.
 *
 * - Streak moved here from Home: "Day 7 of 30." as a plain text line.
 * - Identity badge kept (founding-member context lives here, not home).
 * - BadgeCabinet now renders as MilestoneList (date · note rows).
 * - Trophy CTA removed (TrophyArtifact replaced by date list per brief).
 * - Radius literals cleaned to tokens.
 */
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
import { signOut } from '../../services/authActions';
import { Colors } from '../../constants/colors';
import { MoreStackParamList } from '../../navigation/ClientNavigator';
import { useFoundingNumber } from '../../hooks/useIdentity';
import { resolveIdentityTitle } from '../../lib/identityTitle';
import BadgeCabinet from '../../components/community/BadgeCabinet';
import { track } from '../../lib/analytics';
import { useEffect } from 'react';
import { colors, typography, radius } from '../../theme/tokens';

type Nav = NativeStackNavigationProp<MoreStackParamList>;

export default function ProfileScreen() {
  const currentUser = useCurrentUser();
  const navigation = useNavigation<Nav>();

  const foundingQ = useFoundingNumber();
  const foundingData = foundingQ.data ?? null;

  useEffect(() => {
    track('profile_viewed');
  }, []);

  const identityTitle = resolveIdentityTitle({
    isFoundingMember: foundingData?.isFoundingMember ?? false,
    streakDays: 0,
    totalWorkouts: 0,
    weeksSinceJoin: 0,
  });

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const profileItems = [
    { label: 'Name',            value: currentUser?.name || 'No name set' },
    { label: 'Email',           value: currentUser?.email || '' },
    { label: 'Sex',             value: currentUser?.profile?.sex || 'Not set' },
    { label: 'Date of Birth',   value: currentUser?.profile?.dob || 'Not set' },
    { label: 'Current Weight',  value: currentUser?.profile?.current_weight ? `${currentUser.profile.current_weight} lbs` : 'Not set' },
    { label: 'Target Weight',   value: currentUser?.profile?.target_weight ? `${currentUser.profile.target_weight} lbs` : 'Not set' },
    { label: 'Activity Level',  value: currentUser?.profile?.activity_level || 'Not set' },
    { label: 'Goal',            value: currentUser?.profile?.primary_goal || 'Not set' },
  ];

  const targetItems = [
    { label: 'TDEE',           value: currentUser?.profile?.tdee ? `${currentUser.profile.tdee} kcal` : '--' },
    { label: 'Calorie Target', value: currentUser?.profile?.calorie_target ? `${currentUser.profile.calorie_target} kcal` : '--' },
    { label: 'Protein',        value: currentUser?.profile?.protein_target ? `${currentUser.profile.protein_target}g` : '--' },
    { label: 'Carbs',          value: currentUser?.profile?.carbs_target ? `${currentUser.profile.carbs_target}g` : '--' },
    { label: 'Fat',            value: currentUser?.profile?.fat_target ? `${currentUser.profile.fat_target}g` : '--' },
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

        {/* Wave 3: Streak line — "Day 7 of 30." No flame. */}
        <Text style={styles.streakLine}>Day 7 of 30.</Text>

        {/* Privacy reassurance line */}
        <Text style={styles.privacyLine}>
          Workouts and meals stay private to you and your assigned coach.
        </Text>
      </View>

      {/* Quick Actions — 2×2 grid */}
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

      {/* Wave 3: BadgeCabinet renders as MilestoneList */}
      <View style={styles.badgeCabinetSection}>
        <BadgeCabinet isFoundingMember={foundingData?.isFoundingMember ?? false} />
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
    backgroundColor: colors.bone,
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
    ...typography.h1,
    color: colors.ink,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 4,
    backgroundColor: colors.forest,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: colors.bone,
  },
  name: {
    ...typography.h3,
    color: colors.ink,
  },
  email: {
    ...typography.body,
    color: colors.stone,
    marginTop: 4,
  },
  // Wave 3: streak as plain text line — "Day 7 of 30." No flame.
  streakLine: {
    ...typography.body,
    color: colors.charcoal,
    marginTop: 10,
  },
  privacyLine: {
    ...typography.bodySmall,
    color: colors.stone,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
    fontStyle: 'italic',
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
    backgroundColor: colors.cream,
    borderRadius: radius.lg,  // 4
    paddingVertical: 18,
    borderWidth: 0.5,
    borderColor: colors.stone,
  },
  actionText: {
    ...typography.bodySmall,
    color: colors.ink,
    fontWeight: '600' as const,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
  },
  rowLabel: {
    ...typography.body,
    color: colors.stone,
  },
  rowValue: {
    ...typography.body,
    color: colors.ink,
    fontWeight: '500' as const,
  },
  badgeCabinetSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 16,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,  // 4
    borderWidth: 0.5,
    borderColor: colors.stone,
  },
  signOutText: {
    ...typography.body,
    color: colors.error,
    fontWeight: '600' as const,
  },
});
