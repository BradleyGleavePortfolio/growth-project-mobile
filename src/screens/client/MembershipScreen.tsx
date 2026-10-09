/**
 * MembershipScreen — the client's membership and access surface.
 *
 * CF-MONEY-MEMBER-128 (FW-MONEY-128 B-3, U-4): STATUS is the client's real
 * plan, never the coach link alone. The plan read is
 * clientPaymentsApi.getPaymentStatus() (purchases joined with the coach's
 * packages); when it fails, the server entitlement the app already holds
 * (useEntitlement) decides, and an unknown state says so. The one forest
 * primary action opens ClientPackages, where Your plans holds the next
 * charge, Update card and End my plan. Pull to refresh and coming back to
 * the screen read everything again. Billing actions stay on ClientPackages.
 */

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { aiApi, AIStructuredContext, usersApi } from '../../services/api';
import { clientPaymentsApi, type ClientPaymentStatus, type PaymentsResult } from '../../api/clientPaymentsApi';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { nonP2PPurchasesHidden } from '../../config/purchaseSurfaces';
import { HELP_CONTACT_URL } from '../../config/env';

import { radius, typography, type SemanticTokens } from '../../theme/tokens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
type FoundingInfo = { rank: number; total: number; isFoundingMember: boolean };
type PlanRead = PaymentsResult<ClientPaymentStatus>;

export interface MembershipStatusView {
  value: string;
  planName: string | null;
  detail: string | null;
  /** A plan is on the account (it may be ending or past due). */
  hasPlan: boolean;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The plan's one line: the rules and words of ClientPackages' Current plan
 * line (currentPlanLine), kept here so Membership does not depend on that
 * screen's module.
 */
function planLine(d: ClientPaymentStatus): string | null {
  if (d.state === 'past_due') return 'To keep this plan, update your card in Your plans.';
  if (d.state === 'canceled' || d.cancel_at_period_end) {
    const ends = formatDate(d.current_period_end) ?? formatDate(d.access_expires_at);
    return ends
      ? `Ends ${ends}. Nothing more is charged.`
      : 'Ends at the close of this period. Nothing more is charged.';
  }
  const trialEnds = d.state === 'trialing' ? formatDate(d.trial_ends_at) : null;
  if (trialEnds) return `Trial ends ${trialEnds}`;
  const renews = formatDate(d.current_period_end);
  if (renews) return `Renews ${renews}`;
  const until = formatDate(d.access_expires_at);
  return until ? `Access until ${until}` : null;
}

/** B-3: what STATUS says. A coach link alone is never Active. */
export function membershipStatus(input: {
  hasCoach: boolean;
  coachName: string | null | undefined;
  plan: PlanRead | null;
  entitlementActive: boolean | null;
}): MembershipStatusView {
  const { hasCoach, coachName, plan, entitlementActive } = input;
  if (!hasCoach) {
    return {
      value: 'Awaiting coach access',
      planName: null,
      detail: 'Access starts when a coach invite is attached to this account.',
      hasPlan: false,
    };
  }
  if (plan !== null && plan.ok && plan.data.state !== 'none') {
    return {
      value: plan.data.state === 'past_due' ? 'Payment did not go through' : 'Active',
      planName: plan.data.package_name,
      detail: planLine(plan.data),
      hasPlan: true,
    };
  }
  // B-535-SOL-D-130-1 (Sol): a plan read that succeeded and found no plan is the truth. The entitlement the
  // app already holds can predate a refund, so it decides only while the plan read is missing or failed.
  if (entitlementActive === true && !plan?.ok) {
    return {
      value: 'Active',
      planName: null,
      detail: coachName ? `Access provided by ${coachName}.` : 'Access provided by your coach.',
      hasPlan: false,
    };
  }
  if (plan?.ok || entitlementActive === false) {
    return {
      value: 'No active plan',
      planName: null,
      detail: 'To start one, open View coaching plans or message your coach.',
      hasPlan: false,
    };
  }
  return { value: 'Status unavailable', planName: null, detail: null, hasPlan: false };
}

export default function MembershipScreen() {
  const { colors, semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, semanticColors), [colors, semanticColors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const { entitlementActive, refreshEntitlement } = useEntitlement();
  const [coach, setCoach] = useState<AIStructuredContext['coach'] | null>(null);
  const [founding, setFounding] = useState<FoundingInfo | null>(null);
  const [plan, setPlan] = useState<PlanRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reachable, setReachable] = useState(true);
  const mounted = useRef(true);
  const loadedOnce = useRef(false);

  // The reads are independent and run in parallel; any one may fail without
  // blanking the screen.
  const load = useCallback(async () => {
    const [ctxResult, foundingResult, planResult] = await Promise.allSettled([
      aiApi.getStructuredContext(),
      usersApi.getFoundingNumber(),
      clientPaymentsApi.getPaymentStatus(),
    ]);
    if (!mounted.current) return;
    if (ctxResult.status === 'fulfilled') {
      setCoach(ctxResult.value.data?.coach ?? null);
    }
    if (foundingResult.status === 'fulfilled') {
      setFounding(foundingResult.value.data ?? null);
    }
    setPlan(
      planResult.status === 'fulfilled'
        ? planResult.value
        : { ok: false, reason: 'error', message: 'Plan details could not be loaded.' },
    );
    // Both failing is the unreachable state; one alone still leaves useful data.
    setReachable(!(ctxResult.status === 'rejected' && foundingResult.status === 'rejected'));
    loadedOnce.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Back from Your plans (a plan ended, a card updated): read it again.
  useFocusEffect(
    useCallback(() => {
      if (loadedOnce.current) void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshEntitlement()]);
    if (mounted.current) setRefreshing(false);
  }, [load, refreshEntitlement]);

  const coachName = coach?.name || coach?.business_name;
  const hasCoach = Boolean(currentUser?.coach_id);
  const status = membershipStatus({ hasCoach, coachName, plan, entitlementActive });
  const notice =
    hasCoach && plan !== null && !plan.ok
      ? 'Plan details could not be loaded. Pull down to try again.'
      : !reachable
        ? 'Some details could not be loaded. Pull down to try again.'
        : null;
  const plansLabel = status.hasPlan ? 'Your plans' : 'View coaching plans';
  const memberSince = currentUser?.createdAt
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
        new Date(currentUser.createdAt),
      )
    : null;

  const onContactCoach = () => {
    // The Messages screen is the in-app channel to the coach. It's already
    // registered on the Home stack — go to the Home tab and push Messages.
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('Home', { screen: 'Messages' });
    } else {
      navigation.navigate('Messages' as never);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.header}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={semanticColors.textPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Membership
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        testID="membership-scroll"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
        }
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={semanticColors.accent} />
          </View>
        ) : (
          <>
            {/* Status: the real plan (B-3) */}
            <View style={styles.card} testID="membership-status">
              <Text style={styles.eyebrow}>STATUS</Text>
              <Text style={styles.statusValue}>{status.value}</Text>
              {status.planName ? <Text style={styles.planName}>{status.planName}</Text> : null}
              {status.detail ? <Text style={styles.statusSub}>{status.detail}</Text> : null}
              {notice ? (
                <Text style={styles.noticeText} accessibilityLiveRegion="polite">
                  {notice}
                </Text>
              ) : null}
              {founding?.isFoundingMember && founding.rank > 0 ? (
                <View style={styles.foundingRow}>
                  <Ionicons name="bookmark" size={14} color={colors.warning} />
                  <Text style={styles.foundingText}>
                    Founding member · No. {founding.rank} of {founding.total}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* The one forest primary action (U-4): ClientPackages, where Your
                plans holds the next charge, Update card and End my plan. */}
            <HapticPressable
              intent="medium"
              style={styles.primaryAction}
              onPress={() => navigation.navigate('ClientPackages')}
              accessibilityRole="button"
              accessibilityLabel={plansLabel}
              accessibilityHint="Opens your plans and the plans your coach offers"
              testID="membership-plans"
            >
              <Text style={styles.primaryActionLabel}>{plansLabel}</Text>
            </HapticPressable>

            {/* Detail rows */}
            <View style={styles.detailGroup}>
              {currentUser?.email ? (
                <DetailRow label="ACCOUNT" value={currentUser.email} />
              ) : null}
              {coachName ? <DetailRow label="COACH" value={coachName} /> : null}
              {memberSince ? (
                <DetailRow label="MEMBER SINCE" value={memberSince} />
              ) : null}
            </View>

            {/* How it works */}
            <View style={styles.explainBlock}>
              <Text style={styles.explainTitle}>How access works</Text>
              <Text style={styles.explainBody}>
                The Growth Project is a coach-managed platform. Your coach
                invites you, sets your training and nutrition plan, and may
                offer plans you can buy in the app. A plan bought in the app
                shows above. A renewing plan can be ended at any time in Your
                plans. For questions about a plan, message your coach.
              </Text>
            </View>

            <HapticPressable
              intent="light"
              style={styles.secondaryAction}
              onPress={onContactCoach}
              accessibilityRole="button"
              accessibilityLabel="Message your coach"
              accessibilityHint="Opens the in-app messages channel to your coach"
            >
              <Text style={styles.secondaryActionLabel}>Message your coach</Text>
            </HapticPressable>

            {/* Secondary — the contact support page for general inquiries.
                HUNT-09-124: the site root is not a page (it answers "Page
                not available"), so this opens /help/contact.
                Audit #304 C2: not rendered on hidden iOS builds. A website
                link from the membership/billing context reads as steering to
                an external purchase (Guideline 3.1.1). The permitted 1:1
                coaching path is the in-app ClientPackages screen. */}
            {nonP2PPurchasesHidden() ? null : (
              <HapticPressable
                testID="membership-website-link"
                intent="light"
                style={styles.secondaryAction}
                onPress={() =>
                  Linking.openURL(HELP_CONTACT_URL).catch(() => undefined)
                }
                accessibilityRole="link"
                accessibilityLabel="Contact support"
                accessibilityHint="Opens the contact support page in your browser"
              >
                <Text style={styles.secondaryActionLabel}>
                  Contact support
                </Text>
              </HapticPressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, semanticColors), [colors, semanticColors]);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// A23 calm: bone page, hairlines instead of filled boxes, theme colours only.
const makeStyles = (colors: ThemeColors, sc: SemanticTokens) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: sc.bgPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    ...typography.h3,
    color: sc.textPrimary,
  },
  content: { padding: 24, paddingBottom: 64, gap: 24 },
  loadingWrap: { paddingVertical: 80, alignItems: 'center' },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingTop: 18,
  },
  eyebrow: { ...typography.eyebrow, color: sc.textMuted, marginBottom: 8 },
  statusValue: { ...typography.h2, color: sc.textPrimary, marginBottom: 6 },
  planName: { ...typography.bodyMd, color: sc.textPrimary },
  statusSub: { ...typography.bodySmall, color: sc.textMuted },
  foundingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  foundingText: { ...typography.caption, color: colors.warning },
  detailGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  detailLabel: { ...typography.eyebrow, color: sc.textMuted },
  detailValue: {
    ...typography.bodySmall,
    color: sc.textPrimary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  explainBlock: { gap: 8 },
  explainTitle: { ...typography.h3, color: sc.textPrimary },
  explainBody: { ...typography.body, color: sc.textMuted },
  noticeText: { ...typography.bodySmall, color: sc.textPrimary, marginTop: 12 },
  primaryAction: {
    backgroundColor: sc.accent,
    borderRadius: radius.button,
    minHeight: 48,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionLabel: { ...typography.bodyMd, color: sc.textOnAccent },
  secondaryAction: {
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionLabel: { ...typography.bodyMd, color: sc.textPrimary },

  });
