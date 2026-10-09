/**
 * TrustCenterScreen — UX Psychology Report #2: Trust as Emotion
 *
 * "Trust & Privacy" screen accessible from Settings.
 *
 * Section 1: security status — the encryption line only. The invented "Last
 *   security update" date, the "Audit policy" version and their canned offline
 *   values are gone (FW-ACCOUNT-128 U3), so nothing is fetched for it.
 * Section 2: User actions — data export + account deletion
 * Section 3: Bullet list — who has access, what's encrypted. The coach and
 *   Roman lines follow the real coach link and the Coach sharing switches
 *   (GET /consent/me, clients only; trustCenterSharing.ts, FW-ACCOUNT-128 U2).
 * Footer: Privacy Policy, Consumer Health Data Privacy Policy, Terms of
 *   Service, help centre.
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

import { Spacing } from '../theme/index';
import { layout, radius, typography } from '../theme/tokens';
import { Headline, Lede, Screen, ScreenTopBar } from '../ui';
import { track } from '../lib/analytics';
import { dataExportApi } from '../services/dataExportApi';
import { readCoachSharing } from '../api/coachSharingApi';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { isCoachLikeRole } from '../lib/roleSelectionGate';
import { trustCoachLine, trustRomanLine } from './trustCenterSharing';
import type { TrustCoachView } from './trustCenterSharing';
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
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { deletionErrorCopy } from './settings/deletionErrors';

// ─── Metadata row component ───────────────────────────────────────────────────

function MetaRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { colors } = useTheme();
  const metaStyles = useMemo(() => makeMetaStyles(colors), [colors]);
  return (
    <View style={metaStyles.row}>
      <Ionicons name={icon} size={18} color={colors.textMuted} style={metaStyles.icon} />
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
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 4,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
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
    borderRadius: radius.chip,
    backgroundColor: colors.textMuted,
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
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
  const [exportBusy, setExportBusy] = useState(false);
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const coachAccount = isCoachLikeRole(user?.role);
  const cachedCoach = Boolean(user?.coach_id);
  const [coachView, setCoachView] = useState<TrustCoachView>({ kind: 'checking' });
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

  // Who can see your data: the server's coach link and Coach sharing switches
  // (400 = no coach). A coach account has no coach and /consent is for
  // clients only, so nothing is read for it. If the read fails, the account's
  // own coach link decides whether a coach line shows at all.
  useEffect(() => {
    if (!userId) return;
    if (coachAccount) {
      setCoachView({ kind: 'no_coach' });
      return;
    }
    let alive = true;
    void readCoachSharing().then((read) => {
      if (!alive) return;
      if (read.kind === 'ok') setCoachView({ kind: 'read', state: read.state });
      else setCoachView(read.kind === 'no_coach' || !cachedCoach ? { kind: 'no_coach' } : { kind: 'unread' });
    });
    return () => {
      alive = false;
    };
  }, [userId, coachAccount, cachedCoach]);
  const coachLine = trustCoachLine(coachView);

  const handleDataExport = useCallback(async () => {
    track('data_export_requested');
    setExportBusy(true);
    try {
      await dataExportApi.requestExport();
      Alert.alert(
        'Export requested',
        'Your data export has been queued. Open My data in Settings to track progress and download the file when ready.',
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
    <Screen
      edges={['top']}
      scroll={false}
      contentStyle={styles.frame}
      header={<ScreenTopBar onBack={() => navigation?.goBack?.()} backLabel="Go back" />}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroSection}>
        <Headline level="h1">Trust & Privacy</Headline>
        <Lede style={styles.heroSubtitle}>
          Your health data is sensitive. Here is exactly how it is protected.
        </Lede>
      </View>

      {/* ── Section 1: Security metadata ─────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security status</Text>
        <View style={styles.card}>
          <MetaRow
            icon="lock-closed-outline"
            label="Encryption"
            value="Encrypted in transit; secure token storage"
          />
        </View>
      </View>

      {/* ── Section 2: User actions ───────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What you can do</Text>
        <View style={styles.card}>
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
              <Text style={styles.actionBtnSub}>Usually ready to download in about a minute</Text>
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
            <View style={styles.actionIconWrap}>
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
        <Text style={styles.sectionTitle}>Full transparency</Text>
        <View style={styles.card}>
          <Text style={styles.bulletGroupLabel}>Who can see your data</Text>
          <BulletItem text="You — always" />
          {coachLine ? <BulletItem text={coachLine} /> : null}
          <BulletItem text="Members of your community spaces — the content you choose to share there. If you opt in to a leaderboard, other clients of your coach can also see your display name and participation score." />
          <BulletItem text={trustRomanLine(coachView)} />
          <BulletItem text="Service providers that run the app for The Growth Project, such as Anthropic for Roman, only as described in the Privacy Policy" />
          <BulletItem text="Your data is never sold, and your health data is never used for advertising" />

          <Text style={[styles.bulletGroupLabel, { marginTop: 16 }]}>Security and storage</Text>
          <BulletItem text="Data sent to The Growth Project's servers is encrypted in transit." />
          <BulletItem text="Authentication tokens use iOS Keychain or Android Keystore-backed secure storage." />
          <BulletItem text="Some app data is cached on this device. The Privacy Policy describes server storage and access." />
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
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  frame: { paddingHorizontal: 0 },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },
  heroSection: {
    paddingHorizontal: layout.gutter,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 8,
  },
  heroSubtitle: {
    maxWidth: 320,
  },
  section: {
    paddingHorizontal: layout.gutter,
    marginBottom: 24,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 4,
  },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: Spacing.sm,
  },
  actionIconWrap: {
    width: 24,
    alignItems: 'center',
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
    fontWeight: '500',
    color: colors.primary,
  },
  actionBtnSub: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dangerText: {
    color: colors.error,
  },
  bulletGroupLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 12,
  },
  footer: {
    paddingHorizontal: layout.gutter,
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  footerLink: {
    color: colors.primary,
    fontWeight: '500',
    fontSize: typography.bodySmall.fontSize,
    paddingVertical: 12,
  },

  });
