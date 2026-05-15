import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
  Share,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../services/api';

import { mediumTap, successTap, warningTap } from '../../utils/haptics';
import { buildInviteUniversalLink } from '../../utils/deepLink';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

interface InviteCode {
  id: string;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  revoked: boolean;
  created_at?: string;
}

export default function InviteCodesScreen({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [maxUsesText, setMaxUsesText] = useState('');
  const [expiresInDaysText, setExpiresInDaysText] = useState('');
  const [createError, setCreateError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await coachApi.listInviteCodes();
      const rows: InviteCode[] = Array.isArray(res.data) ? res.data : (res.data?.codes || []);
      setCodes(rows);
    } catch (err) {
      console.error('InviteCodesScreen: load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleCreate = async () => {
    setCreateError('');
    const body: { expires_at?: string; max_uses?: number } = {};
    if (maxUsesText.trim()) {
      const n = parseInt(maxUsesText.trim(), 10);
      if (isNaN(n) || n < 1) {
        setCreateError('Max uses must be a positive number');
        return;
      }
      body.max_uses = n;
    }
    if (expiresInDaysText.trim()) {
      const days = parseInt(expiresInDaysText.trim(), 10);
      if (isNaN(days) || days < 1) {
        setCreateError('Days until expiry must be a positive number');
        return;
      }
      const d = new Date();
      d.setDate(d.getDate() + days);
      body.expires_at = d.toISOString();
    }

    setCreating(true);
    try {
      const res = await coachApi.createInviteCode(body);
      const created: InviteCode = res.data;
      successTap();
      setCodes((prev) => [created, ...prev]);
      track(AnalyticsEvents.COACH_CLIENT_INVITED, {
        has_max_uses: body.max_uses != null,
        has_expiry: body.expires_at != null,
      });
      setShowCreateModal(false);
      setMaxUsesText('');
      setExpiresInDaysText('');
    } catch (err) {
      const msg = errorMessage(err, 'Failed to create code');
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleShare = async (code: string) => {
    mediumTap();
    try {
      // Universal link is the canonical share format — taps from SMS / email /
      // WhatsApp open the app via App Links (iOS) / Android App Links and
      // pre-fill the invite code on the signup screen. The code is included
      // in the body so recipients without the app installed can still copy it
      // into manual entry on the web fallback.
      const url = buildInviteUniversalLink(code);
      await Share.share({
        url,
        message: `Join me on The Growth Project: ${url}\nInvite code: ${code}`,
      });
    } catch (err) {
      console.error('InviteCodesScreen: share failed', err);
    }
  };

  const handleRevoke = (id: string, code: string) => {
    Alert.alert('Revoke code?', `Revoke invite code ${code}? Clients can no longer use it to sign up.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          warningTap();
          try {
            await coachApi.revokeInviteCode(id);
            setCodes((prev) =>
              prev.map((c) => (c.id === id ? { ...c, revoked: true } : c)),
            );
          } catch (err) {
            Alert.alert('Error', errorMessage(err, 'Failed to revoke'));
          }
        },
      },
    ]);
  };

  const formatExpiry = (iso: string | null): string => {
    if (!iso) return 'Never expires';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    const now = Date.now();
    if (d.getTime() < now) return 'Expired';
    return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const statusLabel = (c: InviteCode): { text: string; color: string } => {
    if (c.revoked) return { text: 'Revoked', color: colors.textMuted };
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) {
      return { text: 'Expired', color: colors.textMuted };
    }
    if (c.max_uses && c.used_count >= c.max_uses) {
      return { text: 'Used up', color: colors.textMuted };
    }
    return { text: 'Active', color: colors.success };
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Invite Codes</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <Text style={styles.intro}>
          Share an invite code with a new client. When they sign up using your code, they'll be
          linked to you as their coach automatically.
        </Text>

        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => setShowCreateModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Create new invite code"
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.textOnPrimary} />
          <Text style={styles.createBtnText}>Create new invite code</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate('CoachBulkInvite')}
          accessibilityRole="button"
          accessibilityLabel="Bulk invite clients"
        >
          <Ionicons name="people-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>Bulk invite from a list</Text>
        </TouchableOpacity>

        {codes.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="key-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No codes yet</Text>
            <Text style={styles.emptyText}>Create your first invite code above.</Text>
          </View>
        ) : (
          codes.map((c) => {
            const status = statusLabel(c);
            const isActive = status.text === 'Active';
            return (
              <View key={c.id} style={styles.codeCard}>
                <View style={styles.codeCardTop}>
                  <Text style={styles.codeText} selectable>
                    {c.code}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: status.color + '22' }]}>
                    <Text style={[styles.statusPillText, { color: status.color }]}>
                      {status.text}
                    </Text>
                  </View>
                </View>
                <View style={styles.codeMetaRow}>
                  <View style={styles.codeMeta}>
                    <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.codeMetaText}>
                      {c.used_count}
                      {c.max_uses ? ` / ${c.max_uses}` : ''} used
                    </Text>
                  </View>
                  <View style={styles.codeMeta}>
                    <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.codeMetaText}>{formatExpiry(c.expires_at)}</Text>
                  </View>
                </View>
                <View style={styles.codeActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleShare(c.code)}
                    accessibilityRole="button"
                    accessibilityLabel={`Share code ${c.code}`}
                  >
                    <Ionicons name="share-outline" size={16} color={colors.primary} />
                    <Text style={styles.actionBtnText}>Share</Text>
                  </TouchableOpacity>
                  {c.used_count > 0 && (
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() =>
                        navigation.navigate('InviteCodeRedeemers', {
                          inviteCodeId: c.id,
                          code: c.code,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View redeemers of code ${c.code}`}
                    >
                      <Ionicons name="people-outline" size={16} color={colors.primary} />
                      <Text style={styles.actionBtnText}>
                        Redeemers ({c.used_count})
                      </Text>
                    </TouchableOpacity>
                  )}
                  {isActive && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                      onPress={() => handleRevoke(c.id, c.code)}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke code ${c.code}`}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.actionBtnText, { color: colors.error }]}>Revoke</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Invite Code</Text>
            <Text style={styles.modalDesc}>
              Both fields are optional. Leave blank for unlimited uses / no expiry.
            </Text>

            <Text style={styles.inputLabel}>Max uses</Text>
            <TextInput
              style={styles.input}
              value={maxUsesText}
              onChangeText={setMaxUsesText}
              placeholder="e.g. 5"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              accessibilityLabel="Max uses"
            />

            <Text style={styles.inputLabel}>Expires in (days)</Text>
            <TextInput
              style={styles.input}
              value={expiresInDaysText}
              onChangeText={setExpiresInDaysText}
              placeholder="e.g. 30"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              accessibilityLabel="Expires in days"
            />

            {createError ? (
              <Text style={styles.errorText} accessibilityLiveRegion="assertive">{createError}</Text>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowCreateModal(false);
                  setCreateError('');
                  setMaxUsesText('');
                  setExpiresInDaysText('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, creating && styles.buttonDisabled]}
                onPress={handleCreate}
                disabled={creating}
                accessibilityRole="button"
                accessibilityLabel="Create invite code"
              >
                {creating ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.modalSaveText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  intro: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    gap: 8,
    marginBottom: 24,
  },
  createBtnText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '500' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 2,
    paddingVertical: 14,
    gap: 8,
    marginTop: -16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryBtnText: { color: colors.primary, fontSize: 15, fontWeight: '500' },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  emptyText: { fontSize: 13, color: colors.textSecondary },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  codeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeText: { fontSize: 20, fontWeight: '500', color: colors.textPrimary, letterSpacing: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
  codeMetaRow: { flexDirection: 'row', gap: 16 },
  codeMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeMetaText: { fontSize: 12, color: colors.textMuted },
  codeActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
  },
  actionBtnDanger: { backgroundColor: colors.error + '18' },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: colors.surface, borderRadius: 4, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  modalDesc: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  inputLabel: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  errorText: { color: colors.error, fontSize: 13, marginTop: 12, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: colors.surfaceElevated, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: colors.primary, alignItems: 'center' },
  modalSaveText: { fontSize: 15, fontWeight: '500', color: colors.textOnPrimary },
  buttonDisabled: { opacity: 0.6 },

  });
