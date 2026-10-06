/**
 * TrustCenterScreen — UX Psychology Report #2: Trust as Emotion
 *
 * "Trust & Privacy" screen accessible from Settings.
 *
 * Section 1: security metadata fetched from GET /api/system/trust-meta
 * Section 2: User actions — data export + account deletion
 * Section 3: Bullet list — who has access, what's encrypted
 * Footer: Privacy Policy, Consumer Health Data Privacy Policy, help centre.
 *   A link that does not open shows, under it, what happened and what to do
 *   next for that cause (offline / cannot open links / anything else), see
 *   trustCenterLinkFailure.ts (OR-112-15).
 *
 * Analytics events (PII-safe):
 *   trust_center_opened
 *   data_export_requested
 *   account_deletion_requested
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import HapticPressable from '../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';

import { Spacing, Radius } from '../theme/index';
import { typography, shadows } from '../theme/tokens';
import { track } from '../lib/analytics';
import api from '../services/api';
import { dataExportApi } from '../services/dataExportApi';
import { trustCenterLinks } from './trustCenterLinks';
import type { TrustCenterLink } from './trustCenterLinks';
import {
  LINK_FAILURE_ACTIONS,
  linkFailureEmailSubject,
  linkFailureMessage,
  openTrustCenterLink,
} from './trustCenterLinkFailure';
import type { LinkFailure } from './trustCenterLinkFailure';
import { SupportEmailFallback, useSupportEmail } from '../components/support/SupportEmailFallback';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';
import { Colors } from '../constants/colors';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { deletionErrorCopy } from './settings/deletionErrors';

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
  const { colors } = useTheme();
  const metaStyles = useMemo(() => makeMetaStyles(colors), [colors]);
  return (
    <View style={metaStyles.row}>
      <Ionicons name={icon} size={18} color={colors.primary} style={metaStyles.icon} />
      <View style={metaStyles.textGroup}>
        <Text style={metaStyles.label}>{label}</Text>
        <Text style={metaStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

const makeMetaStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },

  });

// ─── Bullet item ─────────────────────────────────────────────────────────────

function BulletItem({ text }: { text: string }) {
  const { colors } = useTheme();
  const bulletStyles = useMemo(() => makeBulletStyles(colors), [colors]);
  return (
    <View style={bulletStyles.row}>
      <View style={bulletStyles.dot} />
      <Text style={bulletStyles.text}>{text}</Text>
    </View>
  );
}

const makeBulletStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  text: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textSecondary,
  },

  });

// ─── Link failure notice ─────────────────────────────────────────────────────

type CopyState = 'idle' | 'copied' | 'copy_failed';

/**
 * Shown under a footer link that did not open (OR-112-15). Offline: what
 * happened and to tap again once connected. Cannot open links: the exact web
 * address, selectable, with Copy web address. Anything else: the address, the
 * support email with a reference, Email support, and the shared support email
 * fallback if no email app opens.
 */
function LinkFailureNotice({ link, failure }: { link: TrustCenterLink; failure: LinkFailure }) {
  const { colors } = useTheme();
  const noticeStyles = useMemo(() => makeNoticeStyles(colors), [colors]);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  // Checklist (b): a copy result that lands after the notice is gone writes nothing.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const unexpected = failure.cause === 'unexpected';
  const supportEmail = useSupportEmail(unexpected ? linkFailureEmailSubject(link, failure) : undefined);
  const showAddress = failure.cause !== 'offline';

  const copyAddress = useCallback(async () => {
    try {
      const ok = await Clipboard.setStringAsync(link.url);
      if (alive.current) setCopyState(ok === false ? 'copy_failed' : 'copied');
    } catch {
      if (alive.current) setCopyState('copy_failed');
    }
  }, [link.url]);

  return (
    <View style={noticeStyles.wrap} testID="trust-link-failure" accessibilityLiveRegion="polite">
      <Text style={noticeStyles.text} accessibilityRole="alert" testID="trust-link-failure-message">
        {linkFailureMessage(link, failure)}
      </Text>
      {showAddress ? (
        <>
          <Text selectable style={[noticeStyles.text, noticeStyles.address]} testID="trust-link-failure-address">
            {link.url}
          </Text>
          <View style={noticeStyles.actions}>
            <Pressable
              onPress={() => void copyAddress()}
              accessibilityRole="button"
              accessibilityLabel={`Copy the web address of the ${link.pageName}`}
              hitSlop={8}
              style={noticeStyles.action}
              testID="trust-link-failure-copy"
            >
              <Text style={noticeStyles.actionText}>{LINK_FAILURE_ACTIONS.copy}</Text>
            </Pressable>
            {unexpected ? (
              <Pressable
                onPress={() => void supportEmail.open()}
                accessibilityRole="button"
                accessibilityLabel="Email support"
                hitSlop={8}
                style={noticeStyles.action}
                testID="trust-link-failure-email"
              >
                <Text style={noticeStyles.actionText}>{LINK_FAILURE_ACTIONS.email}</Text>
              </Pressable>
            ) : null}
          </View>
          {copyState !== 'idle' ? (
            <Text
              style={noticeStyles.text}
              accessibilityLiveRegion="polite"
              testID="trust-link-failure-copy-status"
            >
              {copyState === 'copied' ? LINK_FAILURE_ACTIONS.copied : LINK_FAILURE_ACTIONS.copyFailed}
            </Text>
          ) : null}
        </>
      ) : null}
      {unexpected ? (
        <SupportEmailFallback
          handle={supportEmail}
          textStyle={noticeStyles.text}
          linkColor={colors.primary}
          testID="trust-link-failure-support"
          centered
        />
      ) : null}
    </View>
  );
}

const makeNoticeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    marginTop: 8,
    marginBottom: 4,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: colors.surface,
    gap: 8,
  },
  text: {
    fontSize: typography.bodySmall.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  address: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
  },
  actionText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: typography.bodySmall.fontSize,
    textDecorationLine: 'underline',
  },

  });

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TrustCenterScreen({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [meta, setMeta] = useState<TrustMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  // The footer link that last failed to open, and why. `attempt` remounts the
  // notice on every new failure so its copy/email state starts fresh.
  const [linkFailure, setLinkFailure] = useState<
    { link: TrustCenterLink; failure: LinkFailure; attempt: number } | null
  >(null);
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const opening = useRef(false);
  const attempts = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      await dataExportApi.requestExport();
      Alert.alert(
        'Export Requested',
        'Your data export has been queued. Open Privacy in Settings to track progress and download the file when ready.',
        [{ text: 'OK' }],
      );
    } catch (err) {
      Alert.alert('Export not started', deletionErrorCopy(err, 'export', 'trust_center.export'));
    } finally {
      setExportBusy(false);
    }
  }, []);

  // openTrustCenterLink never rejects; one open at a time (a second tap while
  // the first is still checking is ignored).
  const handleOpenLink = useCallback(async (link: TrustCenterLink) => {
    if (opening.current) return;
    opening.current = true;
    setLinkFailure(null);
    try {
      const failure = await openTrustCenterLink(link);
      if (mounted.current && failure) {
        attempts.current += 1;
        setLinkFailure({ link, failure, attempt: attempts.current });
      }
    } finally {
      opening.current = false;
    }
  }, []);

  // The notice sits at the foot of a scrolling screen: bring it into view, and
  // read it out on iOS (Android reads the polite live region).
  useEffect(() => {
    if (!linkFailure) return;
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(
        linkFailureMessage(linkFailure.link, linkFailure.failure),
      );
    }
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(id);
  }, [linkFailure]);

  // Deletion needs re-authentication and shows the scheduled date + cancel,
  // so it lives on the shared Delete account screen (registered in both the
  // client and coach navigators), not in an inline alert.
  const handleDeleteAccount = useCallback(() => {
    track('account_deletion_opened');
    navigation?.navigate?.('DeleteAccount');
  }, [navigation]);

  return (
    <ScrollView
      ref={scrollRef}
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
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle}>Trust & Privacy</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Hero lockup */}
      <View style={styles.heroSection}>
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
        </View>
        <Text style={styles.heroSubtitle}>
          Your health data is sensitive. Here is exactly how it is protected.
        </Text>
      </View>

      {/* ── Section 1: Security metadata ─────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security Status</Text>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
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
              <Ionicons name="people-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.actionInfoText}>
              Your answers and logs are shared with your coach. Your Roman conversations stay private from your coach.
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
              <Ionicons name="download-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.actionBtnText}>
              <Text style={styles.actionBtnLabel}>Request data export</Text>
              <Text style={styles.actionBtnSub}>Receive all your data within 24 hours</Text>
            </View>
            {exportBusy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            )}
          </HapticPressable>

          <View style={styles.divider} />

          {/* Account deletion */}
          <HapticPressable
            intent="warning"
            style={styles.actionBtn}
            onPress={handleDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <View style={[styles.actionIconWrap, styles.actionIconDanger]}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <View style={styles.actionBtnText}>
              <Text style={[styles.actionBtnLabel, styles.dangerText]}>Delete account</Text>
              <Text style={styles.actionBtnSub}>A grace period to change your mind before permanent deletion</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>
      </View>

      {/* ── Section 3: Transparency bullets ──────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Full Transparency</Text>
        <View style={styles.card}>
          <Text style={styles.bulletGroupLabel}>Who can see your data</Text>
          <BulletItem text="You — always" />
          <BulletItem text="Your coach — your consultation answers, logs, check-ins and connected health data" />
          <BulletItem text="Not your coach — your Roman conversations, which are kept until you delete them or your account" />
          <BulletItem text="Service providers that run the app for The Growth Project, such as Anthropic for Roman, only as described in the Privacy Policy" />
          <BulletItem text="Your data is never sold, and your health data is never used for advertising" />

          <Text style={[styles.bulletGroupLabel, { marginTop: 16 }]}>What is encrypted</Text>
          <BulletItem text="All data in transit uses TLS 1.3 (the strongest available)" />
          <BulletItem text="All stored data is encrypted with AES-256 at rest" />
          <BulletItem text="Authentication tokens are stored in your device's secure enclave (Keychain / Keystore)" />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Questions or concerns?</Text>
        {trustCenterLinks().map((link) => (
          <React.Fragment key={link.testID}>
            <Text
              testID={link.testID}
              style={styles.footerLink}
              accessibilityRole="link"
              accessibilityLabel={link.accessibilityLabel}
              onPress={() => void handleOpenLink(link)}
            >
              {link.label}
            </Text>
            {linkFailure?.link.id === link.id ? (
              <LinkFailureNotice
                key={linkFailure.attempt}
                link={linkFailure.link}
                failure={linkFailure.failure}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: colors.background,
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
    color: colors.textPrimary,
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
    backgroundColor: colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSubtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textSecondary,
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
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.surface,
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
    backgroundColor: colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionIconDanger: {
    backgroundColor: Colors.noticeCriticalFaintBg,
  },
  actionInfoText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
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
    color: colors.textPrimary,
  },
  actionBtnSub: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textMuted,
    marginTop: 2,
  },
  dangerText: {
    color: colors.error,
  },
  bulletGroupLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
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
    color: colors.textMuted,
    textAlign: 'center',
  },
  footerLink: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: typography.bodySmall.fontSize,
    marginTop: 6,
  },

  });
