/**
 * MembershipScreen — Sale-readiness: client-facing membership and access surface.
 *
 * The Growth Project is a coach-managed platform. Access is granted via an
 * invite code from the coach (Stripe / external billing is handled outside
 * the mobile app). This screen is informational: it shows the active
 * membership status, the coach's identity, and a clear path to the coach
 * for any access changes — without reintroducing in-app billing chrome.
 *
 * No placeholder copy, no fake values. If structured context cannot be
 * loaded, the screen renders a calm "we couldn't reach the server" state.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { aiApi, AIStructuredContext, usersApi } from '../../services/api';

import { colors as colorTokens, typography } from '../../theme/tokens';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
type FoundingInfo = { rank: number; total: number; isFoundingMember: boolean };

export default function MembershipScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const [coach, setCoach] = useState<AIStructuredContext['coach'] | null>(null);
  const [founding, setFounding] = useState<FoundingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Both calls are independent — issue them in parallel. Either one may
        // fail without invalidating the screen; we degrade gracefully.
        const [ctxResult, foundingResult] = await Promise.allSettled([
          aiApi.getStructuredContext(),
          usersApi.getFoundingNumber(),
        ]);

        if (cancelled) return;

        if (ctxResult.status === 'fulfilled') {
          setCoach(ctxResult.value.data?.coach ?? null);
        }
        if (foundingResult.status === 'fulfilled') {
          setFounding(foundingResult.value.data ?? null);
        }
        // If BOTH failed, surface the unreachable state. One failing alone
        // is fine — the screen still has useful local data to show.
        if (
          ctxResult.status === 'rejected' &&
          foundingResult.status === 'rejected'
        ) {
          setReachable(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const coachName = coach?.name || coach?.business_name;
  const accessGranted = Boolean(currentUser?.coach_id);
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Membership
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Status card */}
            <View style={styles.card}>
              <Text style={styles.eyebrow}>STATUS</Text>
              <Text style={styles.statusValue}>
                {accessGranted ? 'Active' : 'Awaiting coach access'}
              </Text>
              <Text style={styles.statusSub}>
                {accessGranted
                  ? coachName
                    ? `Access provided by ${coachName}.`
                    : 'Access provided by your coach.'
                  : 'Your coach will activate access once your invite is attached.'}
              </Text>
              {founding?.isFoundingMember && founding.rank > 0 ? (
                <View style={styles.foundingRow}>
                  <Ionicons name="bookmark" size={14} color={colors.warning} />
                  <Text style={styles.foundingText}>
                    Founding member · No. {founding.rank} of {founding.total}
                  </Text>
                </View>
              ) : null}
            </View>

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
                invites you, sets your training and nutrition plan, and
                handles billing outside the app. To pause, change tier, or
                cancel, message your coach directly.
              </Text>
            </View>

            {!reachable ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Some details couldn’t be reached. Pull to refresh once
                  you’re back online.
                </Text>
              </View>
            ) : null}

            {/* Primary action — contact coach */}
            <HapticPressable
              intent="medium"
              style={styles.primaryAction}
              onPress={onContactCoach}
              accessibilityRole="button"
              accessibilityLabel="Message your coach"
              accessibilityHint="Opens the in-app messages channel to your coach"
            >
              <Text style={styles.primaryActionLabel}>MESSAGE YOUR COACH</Text>
            </HapticPressable>

            {/* Secondary — open the public site for general inquiries */}
            <HapticPressable
              intent="light"
              style={styles.secondaryAction}
              onPress={() =>
                Linking.openURL('https://app.trygrowthproject.com').catch(
                  () => undefined,
                )
              }
              accessibilityRole="link"
              accessibilityLabel="Open trygrowthproject.com"
            >
              <Text style={styles.secondaryActionLabel}>
                Open trygrowthproject.com
              </Text>
            </HapticPressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    ...typography.h3,
    color: colorTokens.ink,
  },
  content: { padding: 24, paddingBottom: 64, gap: 24 },
  loadingWrap: { paddingVertical: 80, alignItems: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: { ...typography.eyebrow, color: colorTokens.stone, marginBottom: 8 },
  statusValue: { ...typography.h2, color: colorTokens.ink, marginBottom: 6 },
  statusSub: { ...typography.bodySmall, color: colorTokens.charcoal },
  foundingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  foundingText: { ...typography.caption, color: colors.warning },
  detailGroup: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailLabel: { ...typography.eyebrow, color: colorTokens.stone },
  detailValue: {
    ...typography.bodySmall,
    color: colorTokens.ink,
    maxWidth: '60%',
    textAlign: 'right',
  },
  explainBlock: { gap: 8 },
  explainTitle: { ...typography.h3, color: colorTokens.ink },
  explainBody: { ...typography.body, color: colorTokens.charcoal },
  notice: {
    backgroundColor: 'rgba(176,141,87,0.08)',
    borderLeftWidth: 2,
    borderLeftColor: colorTokens.camel,
    padding: 16,
    borderRadius: 2,
  },
  noticeText: { ...typography.bodySmall, color: colorTokens.charcoal },
  primaryAction: {
    backgroundColor: colorTokens.ink,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryActionLabel: { ...typography.eyebrow, color: colorTokens.bone },
  secondaryAction: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryActionLabel: { ...typography.bodySmall, color: colorTokens.charcoal },

  });
