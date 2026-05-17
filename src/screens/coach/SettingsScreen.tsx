import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
// Security: sign-out now flows through authActions which clears tokens
// (in SecureStore), AsyncStorage, and notifies the auth event emitter —
// replacing the old useAuthStore.signOut() which only cleared tokens as a
// side effect and left previous-user data in memory for the next login.
import { signOut } from '../../services/authActions';
import { coachApi, profileApi, notificationsApi, usersApi, AccountStatus } from '../../services/api';
import { helpUrl } from '../../config/env';

import { mediumTap, warningTap, successTap } from '../../utils/haptics';
import { updateSupabasePassword } from '../../utils/supabaseAuth';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage, errorStatus } from '../../types/common';
import BiometricUnlockSetting from '../../components/BiometricUnlockSetting';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  // signOut imported directly — no store wiring needed.
  const [settings, setSettings] = useState<CoachSettings>(DEFAULT_SETTINGS);
  const [clientCount, setClientCount] = useState(0);
  const [bioText, setBioText] = useState('');
  const [showBioModal, setShowBioModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [accountStatusLoading, setAccountStatusLoading] = useState(true);
  const [deletionBusy, setDeletionBusy] = useState(false);

  const userId = currentUser?.id || '';

  const loadSettings = useCallback(async () => {
    try {
      // Load notification prefs from backend (source of truth); fall back to AsyncStorage
      try {
        const prefsRes = await notificationsApi.getPreferences();
        const prefs = prefsRes.data;
        if (prefs) {
          const serverSettings = {
            hapticsEnabled: true, // haptics is local-only, not persisted to backend
            dailyCheckin: prefs.daily_checkin_enabled ?? true,
            newClientAlerts: prefs.new_client_alerts ?? true,
            weeklySummary: prefs.weekly_summary_enabled ?? true,
          };
          // Preserve local haptics preference
          const raw = await AsyncStorage.getItem(COACH_SETTINGS_KEY + '_' + userId);
          if (raw) {
            const localSettings = JSON.parse(raw);
            serverSettings.hapticsEnabled = localSettings.hapticsEnabled ?? true;
          }
          setSettings(serverSettings);
          await AsyncStorage.setItem(COACH_SETTINGS_KEY + '_' + userId, JSON.stringify(serverSettings));
        }
      } catch {
        // Backend unavailable — fall back to AsyncStorage
        const raw = await AsyncStorage.getItem(COACH_SETTINGS_KEY + '_' + userId);
        if (raw) setSettings(JSON.parse(raw));
      }
      // Bio: try backend first (source of truth); fall back to AsyncStorage cache
      try {
        const profileRes = await profileApi.get();
        const backendBio: string | null = profileRes.data?.bio ?? null;
        if (backendBio !== null) {
          setBioText(backendBio);
          // Keep local cache in sync
          await AsyncStorage.setItem('gp_coach_bio_' + userId, backendBio);
        } else {
          const localBio = await AsyncStorage.getItem('gp_coach_bio_' + userId);
          if (localBio) setBioText(localBio);
        }
      } catch {
        const localBio = await AsyncStorage.getItem('gp_coach_bio_' + userId);
        if (localBio) setBioText(localBio);
      }
      if (userId) {
        const res = await coachApi.getClients();
        const clients = res.data;
        setClientCount(Array.isArray(clients) ? clients.length : 0);
      }
    } catch (err) {
      // Best-effort read: coach settings fall back to defaults, bio stays empty,
      // client count stays 0. No user action is useful here.
      console.error('coach SettingsScreen: loadSettings failed', err);
    }
  }, [userId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadAccountStatus = useCallback(async () => {
    setAccountStatusLoading(true);
    try {
      const res = await usersApi.getAccountStatus();
      setAccountStatus(res.data ?? null);
    } catch (err) {
      // 404 means the backend has not yet shipped the status endpoint — treat
      // as "no scheduled deletion" so the UI shows the request-deletion path.
      if (errorStatus(err) === 404) {
        setAccountStatus({ deletionScheduled: false });
      } else {
        // On other errors, hide the section entirely rather than render a
        // misleading state.
        setAccountStatus(null);
      }
    } finally {
      setAccountStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccountStatus();
  }, [loadAccountStatus]);

  const updateSetting = async <K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) => {
    const previous = settings;
    const updated = { ...settings, [key]: value };

    // Optimistic update — instant UI response.
    setSettings(updated);
    if (updated.hapticsEnabled) mediumTap();

    // Sync notification toggles to backend. On failure, roll back both
    // the in-memory state and the AsyncStorage cache so UI matches server.
    const notifFieldMap: Partial<Record<keyof CoachSettings, string>> = {
      dailyCheckin: 'daily_checkin_enabled',
      newClientAlerts: 'new_client_alerts',
      weeklySummary: 'weekly_summary_enabled',
    };
    const notifField = notifFieldMap[key];
    if (notifField) {
      try {
        await notificationsApi.updatePreferences({ [notifField]: value });
        // Only persist locally after backend confirms. This ensures
        // AsyncStorage never drifts ahead of the source of truth.
        await AsyncStorage.setItem(COACH_SETTINGS_KEY + '_' + userId, JSON.stringify(updated));
      } catch (err) {
        // Roll back to previous state — server rejected the change.
        setSettings(previous);
        // AsyncStorage still holds previous value (we didn’t write yet),
        // so no rollback write needed here.
        console.warn('coach SettingsScreen: notification sync failed — rolled back', err);
      }
    } else {
      // Non-backend settings (haptics, display prefs) — persist locally only.
      await AsyncStorage.setItem(COACH_SETTINGS_KEY + '_' + userId, JSON.stringify(updated));
    }
  };

  const handleSaveBio = async () => {
    // Optimistic: write to AsyncStorage cache first for instant UI
    await AsyncStorage.setItem('gp_coach_bio_' + userId, bioText);
    // Backend is source of truth
    try {
      await profileApi.update({ bio: bioText });
    } catch (err) {
      console.warn('coach SettingsScreen: failed to sync bio to backend', errorMessage(err));
    }
    successTap();
    setShowBioModal(false);
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
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

  const handleOpenInviteCodes = () => {
    mediumTap();
    navigation.navigate('ClientsStack', { screen: 'InviteCodes' });
  };

  // Email Pipeline v1 — new bulk-invite + delivery surface.
  const handleOpenInvitesAndEmail = () => {
    mediumTap();
    navigation.navigate('ClientsStack', { screen: 'CoachInvites' });
  };

  const handleOpenBulkInvite = () => {
    mediumTap();
    navigation.navigate('ClientsStack', { screen: 'BulkInvite' });
  };

  const handleOpenBilling = () => {
    mediumTap();
    navigation.navigate('Billing');
  };

  const handleOpenTrustCenter = () => {
    mediumTap();
    navigation.navigate('TrustCenter');
  };

  // Phase 10 — GDPR Article 20 data portability
  const handleOpenDataExport = () => {
    mediumTap();
    navigation.navigate('DataExport');
  };

  const handleOpenHelp = async () => {
    mediumTap();
    const url = helpUrl('/coach');
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Help unavailable', 'Could not open the help centre right now. Please try again later.');
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      console.warn('coach SettingsScreen: failed to open help URL', err);
      Alert.alert('Help unavailable', 'Could not open the help centre right now. Please try again later.');
    }
  };

  const handleRequestDeletion = () => {
    warningTap();
    Alert.alert(
      'Delete account',
      'Your account will be scheduled for permanent deletion after a 30-day grace period. You can cancel any time during the window from this screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Schedule deletion',
          style: 'destructive',
          onPress: async () => {
            setDeletionBusy(true);
            try {
              const res = await usersApi.deleteAccount();
              const grace = res.data?.gracePeriodDays ?? 30;
              await loadAccountStatus();
              Alert.alert(
                'Account scheduled for deletion',
                `Your account will be permanently deleted in ${grace} days. Cancel any time before then from Settings.`,
              );
            } catch (err) {
              const msg =
                errorMessage(err, 'Could not schedule account deletion. Please try again.');
              Alert.alert('Request failed', msg);
            } finally {
              setDeletionBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleCancelDeletion = () => {
    mediumTap();
    Alert.alert(
      'Keep account',
      'Cancel the scheduled deletion and keep your account active?',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Keep account',
          onPress: async () => {
            setDeletionBusy(true);
            try {
              await usersApi.cancelAccountDeletion();
              await loadAccountStatus();
              successTap();
              Alert.alert('Deletion canceled', 'Your account is no longer scheduled for deletion.');
            } catch (err) {
              const msg =
                errorMessage(err, 'Could not cancel deletion. Contact support if this keeps happening.');
              Alert.alert('Could not cancel', msg);
            } finally {
              setDeletionBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleSignOut = () => {
    warningTap();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const initials = `${currentUser?.firstName?.[0] || ''}${currentUser?.lastName?.[0] || ''}`;

  const formatPermanentDate = (iso?: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const permanentDate = formatPermanentDate(accountStatus?.permanentDeletionAt);

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
          <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Name</Text>
          <Text style={styles.rowValue}>
            {currentUser?.firstName} {currentUser?.lastName}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{currentUser?.email}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => setShowBioModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Edit bio"
        >
          <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Bio</Text>
          <Text style={styles.rowValueMuted} numberOfLines={1}>
            {bioText || 'Add a bio'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => setShowPasswordModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Change password"
        >
          <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Change Password</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Client Management */}
      <Text style={styles.sectionHeader}>Client Management</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Active Clients</Text>
          <Text style={styles.rowValueHighlight}>{clientCount}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenInviteCodes}
          accessibilityRole="button"
          accessibilityLabel="Manage invite codes"
        >
          <Ionicons name="link-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Invite Codes</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenBulkInvite}
          accessibilityRole="button"
          accessibilityLabel="Bulk invite clients by email"
          testID="settings-bulk-invite"
        >
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Bulk invite clients</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenInvitesAndEmail}
          accessibilityRole="button"
          accessibilityLabel="Invites and email delivery"
          testID="settings-invites-and-email"
        >
          <Ionicons name="paper-plane-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Invites & email</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Coach Tools — surfaces the per-coach building tools that previously
          had no inbound nav (audit P0: 6 dead routes).  */}
      <Text style={styles.sectionHeader}>Coach Tools</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('ClientsStack', { screen: 'CoachWorkoutBuilder' });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open workout builder"
        >
          <Ionicons name="barbell-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Workout Builder</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('ClientsStack', { screen: 'CoachMealTemplates' });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open meal templates"
        >
          <Ionicons name="restaurant-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Meal Templates</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('ClientsStack', { screen: 'CoachBookingInbox' });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open booking inbox"
        >
          <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Booking Inbox</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            const coachId = currentUser?.id;
            if (!coachId) {
              Alert.alert('Not signed in', 'Could not resolve your coach profile.');
              return;
            }
            navigation.navigate('ClientsStack', {
              screen: 'CoachAvailabilityEditor',
              params: { coachId },
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open availability editor"
        >
          <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Availability</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Legacy single-invite generator. The new email-pipeline Bulk
            invite + Invites & email rows live under Client Management. */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('ClientsStack', { screen: 'CoachBulkInvite' });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open legacy bulk invite generator"
        >
          <Ionicons name="people-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Invite Codes (bulk)</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Business — Stripe Connect-backed business metrics + team profile.
          Both screens render honest empty states when the backend hasn't
          provisioned the relevant endpoints. */}
      <Text style={styles.sectionHeader}>Business</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('CoachTeamProfile');
          }}
          accessibilityRole="button"
          accessibilityLabel="Open team profile"
        >
          <Ionicons name="business-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Team / Gym profile</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('CoachBusinessMetrics');
          }}
          accessibilityRole="button"
          accessibilityLabel="Open business metrics"
        >
          <Ionicons name="trending-up-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Revenue & metrics</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Packages CRUD — backend PR #215. */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('CoachPackages');
          }}
          accessibilityRole="button"
          accessibilityLabel="Open packages"
        >
          <Ionicons name="pricetags-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Packages</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Earnings + payout readiness — backend PR #216. */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            mediumTap();
            navigation.navigate('CoachEarnings');
          }}
          accessibilityRole="button"
          accessibilityLabel="Open earnings and payouts"
        >
          <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Earnings & payouts</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Subscription & access */}
      <Text style={styles.sectionHeader}>Subscription</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenBilling}
          accessibilityRole="button"
          accessibilityLabel="Open billing and subscription"
        >
          <Ionicons name="card-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Billing & access</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Notifications */}
      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="alarm-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Daily Check-in</Text>
          <Switch
            value={settings.dailyCheckin}
            onValueChange={(v) => updateSetting('dailyCheckin', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>New Client Alerts</Text>
          <Switch
            value={settings.newClientAlerts}
            onValueChange={(v) => updateSetting('newClientAlerts', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="stats-chart-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Weekly Summary</Text>
          <Switch
            value={settings.weeklySummary}
            onValueChange={(v) => updateSetting('weeklySummary', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        {/* Audit P1: surface the canonical NotificationPreferences screen. */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('NotificationPreferences')}
          accessibilityRole="button"
          accessibilityLabel="Notification preferences"
          accessibilityHint="Channel and quiet-hour controls"
        >
          <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Notification preferences</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* App Preferences */}
      <Text style={styles.sectionHeader}>App Preferences</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Haptics</Text>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={(v) => updateSetting('hapticsEnabled', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
      </View>

      {/* Security */}
      <Text style={styles.sectionHeader}>Security</Text>
      <View style={styles.section}>
        <BiometricUnlockSetting />
      </View>

      {/* Stage 3 — cross-pillar federated coach surface. Settings row
          enters the nested CrossPillarNavigator, which runs the
          practice-selection flow on first open and the live dashboard
          afterwards. */}
      <Text style={styles.sectionHeader}>Cross-pillar practice</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('BothPillars')}
          accessibilityRole="button"
          accessibilityLabel="Open the cross-pillar coach surface"
          accessibilityHint="Unified Body and Wealth roster, universal search, and cross-pillar insights"
        >
          <Ionicons name="git-merge-outline" size={20} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Both pillars view</Text>
            <Text style={styles.rowSubLabel}>
              Unified roster · universal search · holistic insights
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Privacy & data */}
      <Text style={styles.sectionHeader}>Privacy & Data</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenTrustCenter}
          accessibilityRole="button"
          accessibilityLabel="Open trust and privacy center"
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Trust & Privacy</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Phase 10 — GDPR Article 20 data portability */}
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenDataExport}
          accessibilityRole="button"
          accessibilityLabel="Request my data export"
          accessibilityHint="Download a complete copy of all your personal data"
        >
          <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>My data</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {accountStatusLoading ? (
          <View style={styles.row}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Account deletion</Text>
            <Text style={styles.rowValueMuted}>Checking…</Text>
          </View>
        ) : accountStatus?.deletionScheduled ? (
          <TouchableOpacity
            style={styles.row}
            onPress={handleCancelDeletion}
            disabled={deletionBusy}
            accessibilityRole="button"
            accessibilityLabel="Cancel scheduled deletion"
          >
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.warning }]}>
                Deletion scheduled
              </Text>
              {permanentDate ? (
                <Text style={styles.rowSubLabel}>
                  Permanent on {permanentDate} — tap to cancel
                </Text>
              ) : (
                <Text style={styles.rowSubLabel}>Tap to cancel deletion</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('DeleteAccount')}
            disabled={deletionBusy}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityHint="Opens the account deletion screen with a 14-day grace period"
          >
            <Ionicons name="trash-outline" size={20} color={colors.error} />
            <Text style={[styles.rowLabel, { color: colors.error }]}>Delete my account</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Support */}
      <Text style={styles.sectionHeader}>Support</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('SupportInbox')}
          accessibilityRole="button"
          accessibilityLabel="Contact support"
          accessibilityHint="Opens the live support inbox"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Support</Text>
            <Text style={styles.rowSubLabel}>Live chat with the support team</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenHelp}
          accessibilityRole="link"
          accessibilityLabel="Open help centre"
          accessibilityHint="Opens the help centre in your browser"
        >
          <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Help centre</Text>
            <Text style={styles.rowSubLabel}>Guides for inviting clients, billing, and troubleshooting</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Sign Out */}
      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
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
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bioText.length}/300</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowBioModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveBio}
                accessibilityRole="button"
                accessibilityLabel="Save bio"
              >
                <Text style={styles.modalSaveText}>Save</Text>
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
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password (min 8 chars)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              accessibilityLabel="New password"
              textContentType="newPassword"
            />
            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
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
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowPasswordModal(false);
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, passwordBusy && { opacity: 0.6 }]}
                onPress={handleChangePassword}
                disabled={passwordBusy}
                accessibilityRole="button"
                accessibilityLabel="Update password"
              >
                <Text style={styles.modalSaveText}>{passwordBusy ? 'Updating…' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontWeight: '500',
    color: colors.textPrimary,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 24,
    borderRadius: 4, // radius.lg
    padding: 20,
    gap: 16,
    marginBottom: 28,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textOnPrimary,
    fontSize: 20,
    fontWeight: '500',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profileRole: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 24,
    marginBottom: 8,
    marginTop: 4,
  },
  section: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
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
    color: colors.textPrimary,
  },
  rowSubLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowValue: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowValueMuted: {
    fontSize: 14,
    color: colors.textMuted,
    maxWidth: 140,
  },
  rowValueHighlight: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 48,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 2, // radius.md
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: 24,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
  aboutSection: {
    alignItems: 'center',
    paddingBottom: 20,
    gap: 2,
  },
  aboutText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  aboutSubText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  bioInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    height: 100,
  },
  charCount: {
    fontSize: 11,
    color: colors.textMuted,
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
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textOnPrimary,
  },

  });
