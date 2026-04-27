import React, { useEffect, useState, useCallback } from 'react';
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
import { Colors } from '../../constants/colors';
import { mediumTap, successTap, warningTap } from '../../utils/haptics';

interface InviteCode {
  id: string;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  revoked: boolean;
  created_at?: string;
}

export default function InviteCodesScreen({ navigation }: any) {
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
    } catch (err: any) {
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
      setShowCreateModal(false);
      setMaxUsesText('');
      setExpiresInDaysText('');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to create code';
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleShare = async (code: string) => {
    mediumTap();
    try {
      await Share.share({
        message: `Join me on The Growth Project. Use invite code ${code} when signing up.`,
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
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message || 'Failed to revoke');
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
    if (c.revoked) return { text: 'Revoked', color: Colors.textMuted };
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) {
      return { text: 'Expired', color: Colors.textMuted };
    }
    if (c.max_uses && c.used_count >= c.max_uses) {
      return { text: 'Used up', color: Colors.textMuted };
    }
    return { text: 'Active', color: Colors.success };
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
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
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Invite Codes</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
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
          <Ionicons name="add-circle-outline" size={20} color={Colors.textOnPrimary} />
          <Text style={styles.createBtnText}>Create new invite code</Text>
        </TouchableOpacity>

        {codes.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="key-outline" size={48} color={Colors.textMuted} />
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
                    <Ionicons name="people-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.codeMetaText}>
                      {c.used_count}
                      {c.max_uses ? ` / ${c.max_uses}` : ''} used
                    </Text>
                  </View>
                  <View style={styles.codeMeta}>
                    <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
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
                    <Ionicons name="share-outline" size={16} color={Colors.primary} />
                    <Text style={styles.actionBtnText}>Share</Text>
                  </TouchableOpacity>
                  {isActive && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                      onPress={() => handleRevoke(c.id, c.code)}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke code ${c.code}`}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={Colors.error} />
                      <Text style={[styles.actionBtnText, { color: Colors.error }]}>Revoke</Text>
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
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              accessibilityLabel="Max uses"
            />

            <Text style={styles.inputLabel}>Expires in (days)</Text>
            <TextInput
              style={styles.input}
              value={expiresInDaysText}
              onChangeText={setExpiresInDaysText}
              placeholder="e.g. 30"
              placeholderTextColor={Colors.textMuted}
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
                  <ActivityIndicator color={Colors.textOnPrimary} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' },
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
  topTitle: { fontSize: 18, fontWeight: '500', color: Colors.textPrimary },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  intro: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    gap: 8,
    marginBottom: 24,
  },
  createBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '500' },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary },
  codeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  codeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeText: { fontSize: 20, fontWeight: '500', color: Colors.textPrimary, letterSpacing: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
  codeMetaRow: { flexDirection: 'row', gap: 16 },
  codeMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeMetaText: { fontSize: 12, color: Colors.textMuted },
  codeActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.primaryPale,
    borderRadius: 4, // radius.lg
  },
  actionBtnDanger: { backgroundColor: Colors.error + '18' },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: Colors.surface, borderRadius: 4, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '500', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  modalDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  inputLabel: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  errorText: { color: Colors.error, fontSize: 13, marginTop: 12, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: Colors.surfaceElevated, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: Colors.primary, alignItems: 'center' },
  modalSaveText: { fontSize: 15, fontWeight: '500', color: Colors.textOnPrimary },
  buttonDisabled: { opacity: 0.6 },
});
