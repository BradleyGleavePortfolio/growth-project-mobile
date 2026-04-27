/**
 * TrustCenterScreen — UX Psychology Report #2: Trust as Emotion
 *
 * "Trust & Privacy" screen accessible from Settings.
 *
 * Section 1: security metadata fetched from GET /api/system/trust-meta
 * Section 2: User actions — data export + account deletion
 * Section 3: Bullet list — who has access, what's encrypted, where data lives
 *
 * Analytics events (PII-safe):
 *   trust_center_opened
 *   data_export_requested
 *   account_deletion_requested
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Spacing, Radius } from '../theme/index';
import { typography, shadows } from '../theme/tokens';
import { track } from '../lib/analytics';
import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrustMeta {
  lastSecurityUpdate: string;
  encryptionLevel: string;
  dataResidency: string;
  auditPolicyVersion: string;
  dataExportSupported: boolean;
  accountDeletionSupported: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return '1 month ago';
    if (diffMonths < 12) return `${diffMonths} months ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
  } catch {
    return isoString;
  }
}

// ─── Metadata row component ───────────────────────────────────────────────────

function MetaRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={metaStyles.row}>
      <Ionicons name={icon} size={18} color={Colors.primary} style={metaStyles.icon} />
      <View style={metaStyles.textGroup}>
        <Text style={metaStyles.label}>{label}</Text>
        <Text style={metaStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

const metaStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  icon: {
    marginTop: 2,
  },
  textGroup: {
    flex: 1,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
});

// ─── Bullet item ─────────────────────────────────────────────────────────────

function BulletItem({ text }: { text: string }) {
  return (
    <View style={bulletStyles.row}>
      <View style={bulletStyles.dot} />
      <Text style={bulletStyles.text}>{text}</Text>
    </View>
  );
}

const bulletStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 7,
  },
  text: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: Colors.textSecondary,
  },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TrustCenterScreen({ navigation }: any) {
  const [meta, setMeta] = useState<TrustMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Fire trust_center_opened once on mount
  useEffect(() => {
    track('trust_center_opened');
  }, []);

  // Fetch trust-meta (no auth required)
  useEffect(() => {
    api
      .get<TrustMeta>('/system/trust-meta')
      .then((res) => setMeta(res.data))
      .catch(() => {
        // Fallback to static values if network fails
        setMeta({
          lastSecurityUpdate: '2026-04-25T20:00:00Z',
          encryptionLevel: 'TLS 1.3 + AES-256',
          dataResidency: 'US East',
          auditPolicyVersion: 'v1.0',
          dataExportSupported: true,
          accountDeletionSupported: true,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDataExport = useCallback(async () => {
    track('data_export_requested');
    setExportBusy(true);
    try {
      await api.post('/users/me/data-export');
      Alert.alert(
        'Export Requested',
        'Your data export has been queued. You will receive an email within 24 hours.',
        [{ text: 'OK' }],
      );
    } catch {
      Alert.alert('Request Failed', 'Could not submit your export request. Please try again later.');
    } finally {
      setExportBusy(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete My Account',
      'This will schedule your account for permanent deletion after a 30-day grace period. You can cancel within that window by contacting support.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Deletion',
          style: 'destructive',
          onPress: async () => {
            track('account_deletion_requested');
            setDeleteBusy(true);
            try {
              await api.delete('/users/me/account');
              Alert.alert(
                'Account Scheduled for Deletion',
                'Your account will be permanently deleted in 30 days. Contact support within this window to cancel.',
              );
            } catch {
              Alert.alert('Request Failed', 'Could not schedule account deletion. Please try again later.');
            } finally {
              setDeleteBusy(false);
            }
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <HapticPressable
          intent="light"
          onPress={() => navigation?.goBack?.()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle}>Trust & Privacy</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Hero lockup */}
      <View style={styles.heroSection}>
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark" size={32} color={Colors.primary} />
        </View>
        <Text style={styles.heroSubtitle}>
          Your health data is sensitive. Here is exactly how we protect it.
        </Text>
      </View>

      {/* ── Section 1: Security metadata ─────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security Status</Text>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : meta ? (
            <>
              <MetaRow
                icon="time-outline"
                label="Last security update"
                value={formatRelativeDate(meta.lastSecurityUpdate)}
              />
              <MetaRow
                icon="lock-closed-outline"
                label="Encryption"
                value="TLS 1.3 + AES-256 at rest"
              />
              <MetaRow
                icon="location-outline"
                label="Data residency"
                value="US East"
              />
              <MetaRow
                icon="document-text-outline"
                label="Audit policy"
                value={`Version ${meta.auditPolicyVersion}`}
              />
            </>
          ) : null}
        </View>
      </View>

      {/* ── Section 2: User actions ───────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What You Can Do</Text>
        <View style={styles.card}>
          {/* Info row — no action */}
          <View style={styles.actionInfoRow}>
            <View style={styles.actionIconWrap}>
              <Ionicons name="people-outline" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.actionInfoText}>
              Workouts and meals stay private to you and your assigned coach
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Data export */}
          <HapticPressable
            intent="medium"
            style={styles.actionBtn}
            onPress={handleDataExport}
            disabled={exportBusy}
            accessibilityRole="button"
            accessibilityLabel="Request data export"
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="download-outline" size={18} color={Colors.primary} />
            </View>
            <View style={styles.actionBtnText}>
              <Text style={styles.actionBtnLabel}>Request data export</Text>
              <Text style={styles.actionBtnSub}>Receive all your data within 24 hours</Text>
            </View>
            {exportBusy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            )}
          </HapticPressable>

          <View style={styles.divider} />

          {/* Account deletion */}
          <HapticPressable
            intent="warning"
            style={styles.actionBtn}
            onPress={handleDeleteAccount}
            disabled={deleteBusy}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
          >
            <View style={[styles.actionIconWrap, styles.actionIconDanger]}>
              <Ionicons name="trash-outline" size={18} color={Colors.error} />
            </View>
            <View style={styles.actionBtnText}>
              <Text style={[styles.actionBtnLabel, styles.dangerText]}>Delete my account</Text>
              <Text style={styles.actionBtnSub}>30-day grace period before permanent deletion</Text>
            </View>
            {deleteBusy ? (
              <ActivityIndicator size="small" color={Colors.error} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            )}
          </HapticPressable>
        </View>
      </View>

      {/* ── Section 3: Transparency bullets ──────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Full Transparency</Text>
        <View style={styles.card}>
          <Text style={styles.bulletGroupLabel}>Who can see your data</Text>
          <BulletItem text="You — always" />
          <BulletItem text="Your assigned coach — only what you log (meals + workouts)" />
          <BulletItem text="No one else — we do not sell, share, or license your data" />

          <Text style={[styles.bulletGroupLabel, { marginTop: 16 }]}>What is encrypted</Text>
          <BulletItem text="All data in transit uses TLS 1.3 (the strongest available)" />
          <BulletItem text="All stored data is encrypted with AES-256 at rest" />
          <BulletItem text="Authentication tokens are stored in your device's secure enclave (Keychain / Keystore)" />

          <Text style={[styles.bulletGroupLabel, { marginTop: 16 }]}>Where your data lives</Text>
          <BulletItem text="Servers located in US East data centres" />
          <BulletItem text="We do not transfer data outside the US without your consent" />
          <BulletItem text="Backups are encrypted and stored in the same region" />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Questions? Email{' '}
          <Text style={styles.footerLink}>support@thegrowthproject.app</Text>
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.background,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 24,
    gap: 12,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSubtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...shadows.sm,
  },
  actionInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionIconDanger: {
    backgroundColor: '#FEF2F2',
  },
  actionInfoText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: Colors.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  actionBtnText: {
    flex: 1,
  },
  actionBtnLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  actionBtnSub: {
    fontSize: typography.bodySmall.fontSize,
    color: Colors.textMuted,
    marginTop: 2,
  },
  dangerText: {
    color: Colors.error,
  },
  bulletGroupLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: typography.bodySmall.fontSize,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  footerLink: {
    color: Colors.primary,
    fontWeight: '600',
  },
});
