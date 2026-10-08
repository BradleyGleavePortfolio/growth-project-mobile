/**
 * CoachTeamProfileScreen
 *
 * The coach's business profile. Renders the coach's
 * permanent invite link (the code every sign-up path accepts) and the client
 * count. AUDIT-16-125: the stored team code (GP-TEAM-...) is not accepted by
 * any sign-up or join path, so it is no longer shown or shared; the invented
 * seat capacity and the unreachable sub-coach link are gone too.
 *
 * Renders an honest setup CTA when the backend has not provisioned the
 * /coach/team endpoint yet (404). Never invents data. agent 132
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  coachTeamApi,
  type TeamProfile,
  type TeamResult,
} from '../../api/coachTeamApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import InviteShareCard from '../../components/coach/setup/InviteShareCard';
import { QuietError } from '../../ui/states/QuietStates';
import { typography, withAlpha } from '../../theme/tokens';

const BUSINESS_NAME_MAX_LENGTH = 120;

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
    setTeam(null);
    const res = await coachTeamApi.getProfile();
    setTeam(res);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveProfile = async () => {
    setSaveError('');
    const name = savingName.trim();
    if (!name) {
      setSaveError('Business name is required.');
      return;
    }
    if (name.length > BUSINESS_NAME_MAX_LENGTH) {
      setSaveError('Use 120 characters or fewer for the business name.');
      return;
    }
    setSaving(true);
    try {
      const res = await coachTeamApi.upsertProfile({ business_name: name });
      setTeam({ ok: true, data: res.data });
      setSetupOpen(false);
      setSavingName('');
    } catch (err) {
      setSaveError(errorMessage(err, 'The business profile could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (!team) {
    return <SkeletonScreen count={5} />;
  }

  if (!team.ok && team.reason === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Business profile</Text>
        <QuietError message={team.message} onRetry={load} />
      </View>
    );
  }

  // Not configured — render setup CTA.
  if (!team.ok) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Business profile</Text>
        <View style={styles.gate}>
          <Ionicons name="business-outline" size={36} color={colors.textMuted} />
          <Text style={styles.gateTitle}>Set up your business profile</Text>
          <Text style={styles.gateBody}>
            Add the name clients know your business by.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => setSetupOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Set up business profile"
          >
            <Text style={styles.ctaText}>Set up profile</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={setupOpen} transparent animationType="fade" onRequestClose={() => setSetupOpen(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Business profile</Text>
              <Text style={styles.label}>Business name</Text>
              <TextInput
                value={savingName}
                onChangeText={setSavingName}
                maxLength={BUSINESS_NAME_MAX_LENGTH}
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
                  onPress={handleSaveProfile}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Save business profile"
                >
                  {saving ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.ctaText}>Save</Text>
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
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.header}>{profile.business_name}</Text>
      <Text style={styles.subheader}>Business profile</Text>

      <Text style={styles.codeLabel}>CLIENT INVITE LINK</Text>
      <InviteShareCard testID="team-invite-share" />

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{profile.clients_assigned}</Text>
          <Text style={styles.statLabel}>Clients</Text>
        </View>
      </View>

      {!profile.payouts_enabled ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('CoachSetup', { section: 'get_paid' })}
          accessibilityRole="button"
          accessibilityLabel="Payouts are not enabled. Connect Stripe"
          style={styles.warnBanner}
        >
          <Ionicons name="warning-outline" size={16} color={colors.textMuted} />
          <Text style={styles.warnText}>
            Payouts are not enabled. Connect Stripe to enable revenue.
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('CoachMoney')}
        accessibilityRole="button"
        accessibilityLabel="Open Money"
      >
        <Ionicons name="trending-up-outline" size={20} color={colors.primary} />
        <Text style={styles.linkText}>Money and business numbers</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('ClientsStack', { screen: 'InviteCodes', initial: false })}
        accessibilityRole="button"
        accessibilityLabel="Open invite codes"
      >
        <Ionicons name="key-outline" size={20} color={colors.primary} />
        <Text style={styles.linkText}>Invite codes</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20, paddingTop: 56 },
    page: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 32 },
    header: { ...typography.h1, color: colors.textPrimary },
    subheader: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: 16 },
    codeLabel: { ...typography.eyebrow, color: colors.textMuted, marginTop: 12, marginBottom: 8 },
    statsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    statCard: {
      flex: 1,
      padding: 12,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    statValue: { ...typography.h2, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statLabel: { ...typography.bodySmall, color: colors.textMuted, marginTop: 4 },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 44,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    linkText: { ...typography.bodySmall, flex: 1, color: colors.textPrimary },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { ...typography.bodyMd, color: colors.textPrimary, marginTop: 12, textAlign: 'center' },
    gateBody: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
    cta: { backgroundColor: colors.primary, borderRadius: 4, minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
    ctaDisabled: { opacity: 0.5 },
    ctaText: { ...typography.bodyMd, color: colors.textOnPrimary },
    cancelText: { ...typography.bodySmall, color: colors.textSecondary, paddingVertical: 12, paddingHorizontal: 16 },
    modalOverlay: { flex: 1, backgroundColor: withAlpha(colors.textPrimary, 0.4), justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: colors.background, borderRadius: 4, padding: 20 },
    modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: 12 },
    label: { ...typography.bodySmall, color: colors.textMuted, marginBottom: 6 },
    input: {
      ...typography.bodySmall,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 4,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' },
    errorText: { ...typography.bodySmall, color: colors.textPrimary, marginTop: 8 },
    warnBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    warnText: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
  });
