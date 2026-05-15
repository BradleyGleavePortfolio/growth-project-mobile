/**
 * CoachTeamProfileScreen
 *
 * The head coach's team / gym / organization profile. Renders the team
 * code clients can sign up with, total seat capacity across head coach +
 * sub-coaches, and links into TeamManagement for sub-coach administration.
 *
 * Renders an honest setup CTA when the backend has not provisioned the
 * /coach/team endpoint yet (404). Never invents data.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  coachTeamApi,
  type TeamProfile,
  type TeamResult,
} from '../../api/coachTeamApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { buildInviteUniversalLink } from '../../utils/deepLink';

export default function CoachTeamProfileScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<{
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
  }>();

  const [team, setTeam] = useState<TeamResult<TeamProfile> | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [savingName, setSavingName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    const res = await coachTeamApi.getProfile();
    setTeam(res);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateTeam = async () => {
    setSaveError('');
    const name = savingName.trim();
    if (!name) {
      setSaveError('Business name is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await coachTeamApi.upsertProfile({ business_name: name });
      setTeam({ ok: true, data: res.data });
      setSetupOpen(false);
      setSavingName('');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleShareTeamCode = async (profile: TeamProfile) => {
    try {
      const url = buildInviteUniversalLink(profile.team_code);
      await Share.share({
        url,
        message: `Join ${profile.business_name} on The Growth Project: ${url}\nTeam code: ${profile.team_code}`,
      });
    } catch {
      // Share sheet dismissed — no-op.
    }
  };

  if (!team) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!team.ok && team.reason === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Team</Text>
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.errorText}>{team.message} Tap to retry.</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Not configured — render setup CTA.
  if (!team.ok) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Team</Text>
        <View style={styles.gate}>
          <Ionicons name="business-outline" size={36} color={colors.textMuted} />
          <Text style={styles.gateTitle}>Set up your team</Text>
          <Text style={styles.gateBody}>
            Add a business name to generate a team code clients can use at signup.
            Sub-coaches you add later live under this team.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => setSetupOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Set up team"
          >
            <Text style={styles.ctaText}>Set up team</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={setupOpen} transparent animationType="fade" onRequestClose={() => setSetupOpen(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Set up team</Text>
              <Text style={styles.label}>Business name</Text>
              <TextInput
                value={savingName}
                onChangeText={setSavingName}
                placeholder="e.g. Atlas Coaching"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                accessibilityLabel="Business name"
              />
              {saveError ? <Text style={styles.errorText} accessibilityLiveRegion="assertive">{saveError}</Text> : null}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => {
                    setSetupOpen(false);
                    setSaveError('');
                    setSavingName('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cta, saving && styles.ctaDisabled]}
                  onPress={handleCreateTeam}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Create team"
                >
                  {saving ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.ctaText}>Create</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  const profile = team.data;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{profile.business_name}</Text>
      <Text style={styles.subheader}>Team profile</Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>TEAM CODE</Text>
        <Text style={styles.codeText} selectable>
          {profile.team_code}
        </Text>
        <Text style={styles.codeHint}>
          Clients who sign up with this code join your team. You can reassign them
          to any sub-coach.
        </Text>
        <View style={styles.codeActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleShareTeamCode(profile)}
            accessibilityRole="button"
            accessibilityLabel="Share team code"
          >
            <Ionicons name="share-outline" size={16} color={colors.primary} />
            <Text style={styles.actionBtnText}>Share team code</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{profile.clients_assigned}</Text>
          <Text style={styles.statLabel}>Clients</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{profile.client_capacity}</Text>
          <Text style={styles.statLabel}>Seats</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {profile.client_capacity > 0
              ? Math.max(0, profile.client_capacity - profile.clients_assigned)
              : 0}
          </Text>
          <Text style={styles.statLabel}>Open</Text>
        </View>
      </View>

      {!profile.payouts_enabled ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('CoachBusinessMetrics')}
          accessibilityRole="button"
          accessibilityLabel="Open business metrics"
          style={styles.warnBanner}
        >
          <Ionicons name="warning-outline" size={16} color="#fff" />
          <Text style={styles.warnText}>
            Payouts are not enabled. Connect Stripe to enable revenue.
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('TeamManagement')}
        accessibilityRole="button"
        accessibilityLabel="Open team management"
      >
        <Ionicons name="people-outline" size={20} color={colors.primary} />
        <Text style={styles.linkText}>Manage sub-coaches</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('CoachBusinessMetrics')}
        accessibilityRole="button"
        accessibilityLabel="Open business metrics"
      >
        <Ionicons name="trending-up-outline" size={20} color={colors.primary} />
        <Text style={styles.linkText}>Business metrics</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => {
          // The Invite Codes screen is on the Clients stack — bounce via the
          // parent navigator for that tab.
          Alert.alert(
            'Invite codes',
            'Open the Clients tab → Invite codes to manage one-off invite codes.',
            [{ text: 'OK' }],
          );
        }}
        accessibilityRole="button"
        accessibilityLabel="Invite codes help"
      >
        <Ionicons name="key-outline" size={20} color={colors.primary} />
        <Text style={styles.linkText}>Invite codes</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20, paddingTop: 56 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    header: { fontSize: 26, fontWeight: '600', color: colors.textPrimary },
    subheader: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
    codeCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 12,
    },
    codeLabel: { fontSize: 11, color: colors.textMuted, letterSpacing: 0.5 },
    codeText: { fontSize: 28, fontWeight: '600', color: colors.textPrimary, marginVertical: 4 },
    codeHint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginBottom: 12 },
    codeActions: { flexDirection: 'row', gap: 12 },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.primary + '15',
      borderRadius: 8,
    },
    actionBtnText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
    statsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    statCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    statValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
    statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    linkText: { flex: 1, fontSize: 15, color: colors.textPrimary },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 12 },
    gateBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
    cta: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
    ctaDisabled: { opacity: 0.5 },
    ctaText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    cancelText: { color: colors.textSecondary, fontWeight: '500', paddingVertical: 12, paddingHorizontal: 16 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: colors.surface, borderRadius: 16, padding: 20 },
    modalTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
    label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' },
    errorText: { color: colors.error, fontSize: 13, marginTop: 8 },
    warnBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.warning,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
      marginTop: 12,
    },
    warnText: { color: '#fff', fontSize: 13, flex: 1 },
  });
