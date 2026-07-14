import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
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
import { featureFlags } from '../../config/featureFlags';

import { mediumTap, warningTap, successTap } from '../../utils/haptics';
import { updateSupabasePassword } from '../../utils/supabaseAuth';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { errorMessage, errorStatus } from '../../types/common';
import BiometricUnlockSetting from '../../components/BiometricUnlockSetting';
// FACE+VOICE contract: the Roman concierge entry row is a Roman-voiced coach
// surface, so it must carry Roman's actual face — never a disembodied sparkles
// glyph. Canonical avatar lives in the roman/ lane (D-013).
import RomanAvatar from '../../components/roman/RomanAvatar';

import { makeStyles } from './settings/styles';
import { COACH_SETTINGS_KEY, DEFAULT_SETTINGS, type CoachSettings } from './settings/types';
import { ProfileSection } from './settings/ProfileSection';
import { SettingsToggles } from './settings/SettingsToggles';
import { BillingSection } from './settings/BillingSection';
import { DangerZone } from './settings/DangerZone';

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

  // Payments surface — packages marketplace, Connect onboarding, earnings.
  const handleOpenPackages = () => {
    mediumTap();
    navigation.navigate('CoachPackagesList');
  };
  const handleOpenConnect = () => {
    mediumTap();
    navigation.navigate('CoachConnect');
  };
  const handleOpenEarnings = () => {
    mediumTap();
    navigation.navigate('CoachEarnings');
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

      <ProfileSection
        initials={initials}
        firstName={currentUser?.firstName}
        lastName={currentUser?.lastName}
        email={currentUser?.email}
        bioText={bioText}
        onOpenBio={() => setShowBioModal(true)}
        onOpenPassword={() => setShowPasswordModal(true)}
        colors={colors}
        styles={styles}
      />

      {/* Client Management */}
      <Text style={styles.sectionHeader}>Client Management</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Active Clients</Text>
          <Text style={styles.rowValueHighlight}>{clientCount}</Text>
        </View>
        <View style={styles.divider} />
        {/* Importer v0.3 — coach-facing Import Data entry. Rendered ONLY when
            featureFlags.extensionImport is true (default OFF). NOT the Day-1
            client-invite CoachPairing flow. */}
        {featureFlags.extensionImport && (
          <>
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('ImportData')}
              accessibilityRole="button"
              accessibilityLabel="Import data from another platform"
              accessibilityHint="Bring your clients and history across from a coaching platform you already use"
              testID="settings-import-data"
            >
              <Ionicons name="cloud-download-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.rowLabel}>Import Data</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
          </>
        )}
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
        {/* Email Pipeline v1 — new bulk-invite + per-recipient delivery view. */}
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

      {/* Payments — Coach marketplace + payouts. Each leaf screen renders an
          actionable config-required state if the backend module isn't
          deployed in this env, so it's safe to keep these rows visible
          unconditionally. */}
      <Text style={styles.sectionHeader}>Payments</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenPackages}
          accessibilityRole="button"
          accessibilityLabel="Manage packages"
        >
          <Ionicons name="pricetags-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Packages</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenConnect}
          accessibilityRole="button"
          accessibilityLabel="Set up Stripe payouts"
        >
          <Ionicons name="wallet-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Payouts (Stripe Connect)</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={handleOpenEarnings}
          accessibilityRole="button"
          accessibilityLabel="View earnings"
        >
          <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Earnings</Text>
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

      <BillingSection
        onOpenTeamProfile={() => {
          mediumTap();
          navigation.navigate('CoachTeamProfile');
        }}
        onOpenBusinessMetrics={() => {
          mediumTap();
          navigation.navigate('CoachBusinessMetrics');
        }}
        onOpenEarnings={() => {
          mediumTap();
          navigation.navigate('CoachEarnings');
        }}
        onOpenBilling={handleOpenBilling}
        colors={colors}
        styles={styles}
      />

      <SettingsToggles
        settings={settings}
        onUpdateSetting={updateSetting}
        onOpenNotificationPreferences={() => navigation.navigate('NotificationPreferences')}
        colors={colors}
        styles={styles}
      />

      {/* Security */}
      <Text style={styles.sectionHeader}>Security</Text>
      <View style={styles.section}>
        <BiometricUnlockSetting />
      </View>

      {/* Roman P1 chat (coach surface). Entry row present ONLY when
          featureFlags.romanChat is true (default OFF) — when OFF there is no row
          and no dead-end, since the 'RomanChat' route is itself registered only
          behind the same flag (CoachNavigator). Routes into the coach surface. */}
      {featureFlags.romanChat ? (
        <>
          <Text style={styles.sectionHeader}>Concierge</Text>
          <View style={styles.section} role="list">
            {/* listitem wrapper exposes list structure to assistive tech while
                the inner pressable keeps its button role + action (R3 P1-3).
                ARIA `role` is used because RN's AccessibilityRole union omits
                "listitem". */}
            <View role="listitem">
              <TouchableOpacity
                style={styles.row}
                onPress={() => navigation.navigate('RomanChat')}
                accessibilityRole="button"
                accessibilityLabel="Open a conversation with Roman"
                accessibilityHint="Ask for a brief, a client read, or the next step"
              >
                <RomanAvatar crop="neutral" size={28} testID="coach-roman-entry-avatar" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Roman</Text>
                  {/* Coach register: operational, not the generic "ask anything"
                      client copy (R1 UX finding P2). */}
                  <Text style={styles.rowSubLabel}>Ask for a brief, a client read, or the next step.</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : null}

      {/* iMessage-grade DM — Apple App Review 1.2 compliance. The coach must
          be able to view and undo their blocks from Settings. */}
      <Text style={styles.sectionHeader}>Privacy</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('BlockedUsers')}
          accessibilityRole="button"
          accessibilityLabel="Blocked Users"
          accessibilityHint="View and manage the users you've blocked"
        >
          <Ionicons name="ban-outline" size={20} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Blocked Users</Text>
            <Text style={styles.rowSubLabel}>
              Review and unblock people you've blocked from DMs
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
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

      <DangerZone
        accountStatus={accountStatus}
        accountStatusLoading={accountStatusLoading}
        deletionBusy={deletionBusy}
        permanentDate={permanentDate}
        onOpenTrustCenter={handleOpenTrustCenter}
        onOpenDataExport={handleOpenDataExport}
        onOpenDeleteAccount={() => navigation.navigate('DeleteAccount')}
        onCancelDeletion={handleCancelDeletion}
        onSignOut={handleSignOut}
        colors={colors}
        styles={styles}
      />

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
