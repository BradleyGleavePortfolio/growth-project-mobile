/**
 * CoachInvitesScreen — Email Pipeline v1.
 *
 * Coach-only invite-code list with delivery surface. Mounts a list of
 * invites from `GET /coach/invite-codes`, filter chips, and per-row
 * actions:
 *   - Resend (PENDING only; gracefully hidden if backend lacks the route)
 *   - Copy invite link
 *   - Revoke (with confirm dialog)
 *
 * The legacy InviteCodesScreen is preserved unchanged so existing
 * navigate('InviteCodes') deep links continue to resolve. This screen
 * is the v1 successor — it surfaces the per-recipient email status the
 * legacy code-centric view doesn't.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { invitesApi } from '../../api/invites';
import { buildInviteUniversalLink } from '../../utils/deepLink';
import type {
  EmailStatus,
  Invite,
  InviteListFilter,
  InviteStatus,
} from '../../types/invites';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { mediumTap, successTap, warningTap } from '../../utils/haptics';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

const FILTERS: InviteListFilter[] = ['all', 'pending', 'accepted', 'expired'];

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 60 * 60_000) {
    const m = Math.round(diffMs / 60_000);
    return `${m}m ago`;
  }
  if (diffMs < day) {
    const h = Math.round(diffMs / (60 * 60_000));
    return `${h}h ago`;
  }
  const d = Math.round(diffMs / day);
  return `${d}d ago`;
}

function statusLabel(s: InviteStatus): string {
  switch (s) {
    case 'PENDING':
      return 'Pending';
    case 'ACCEPTED':
      return 'Accepted';
    case 'EXPIRED':
      return 'Expired';
    case 'REVOKED':
      return 'Revoked';
  }
}

const KNOWN_EMAIL_STATUSES: ReadonlyArray<EmailStatus> = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'FAILED',
];

function toEmailStatus(value: string | null | undefined): EmailStatus | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return (KNOWN_EMAIL_STATUSES as ReadonlyArray<string>).includes(upper)
    ? (upper as EmailStatus)
    : null;
}

function emailStatusLabel(s: EmailStatus): string {
  switch (s) {
    case 'QUEUED':
      return 'Queued';
    case 'SENT':
      return 'Sent';
    case 'DELIVERED':
      return 'Delivered';
    case 'BOUNCED':
      return 'Bounced';
    case 'FAILED':
      return 'Failed';
  }
}

export default function CoachInvitesScreen({
  navigation,
}: {
  navigation: NavigationProp<ParamListBase>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [filter, setFilter] = useState<InviteListFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Tri-state per backend support: `null` = unknown, `true` = endpoint
   * works, `false` = endpoint returned 404. Once we know the backend
   * doesn't implement resend we hide the affordance for every row.
   */
  const [resendSupported, setResendSupported] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await invitesApi.listInvites('all');
      setInvites(next);
    } catch (err) {
      console.error('CoachInvitesScreen: load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return invites;
    const target: InviteStatus =
      filter === 'pending'
        ? 'PENDING'
        : filter === 'accepted'
          ? 'ACCEPTED'
          : 'EXPIRED';
    return invites.filter((i) => i.status === target);
  }, [invites, filter]);

  const handleResend = useCallback(
    async (invite: Invite) => {
      mediumTap();
      if (!invite.clientEmail) {
        Alert.alert(
          'No recipient',
          'This invite is missing an email address. Use "Copy link" to share it directly.',
        );
        return;
      }
      try {
        const result = await invitesApi.resendInvite(
          invite.id,
          invite.clientEmail,
        );
        if (!result.supported) {
          setResendSupported(false);
          Alert.alert(
            'Not available',
            'Resend isn\'t supported by the backend yet. Use "Copy link" to share the invite directly.',
          );
          return;
        }
        setResendSupported(true);
        successTap();
        Alert.alert('Queued', `Invite re-sent to ${invite.clientEmail}.`);
      } catch (err) {
        console.error(
          'CoachInvitesScreen: resend failed',
          errorMessage(err),
        );
        Alert.alert(
          'Could not complete this action',
          'Please try again.',
        );
      }
    },
    [],
  );

  const handleCopyLink = useCallback(async (invite: Invite) => {
    mediumTap();
    const url = buildInviteUniversalLink(invite.code);
    await Clipboard.setStringAsync(url);
    Alert.alert('Copied', 'Invite link copied to clipboard.');
  }, []);

  const handleRevoke = useCallback((invite: Invite) => {
    Alert.alert(
      'Revoke invite?',
      `Revoke invite for ${invite.clientEmail ?? invite.code}? They can no longer accept it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            warningTap();
            try {
              await invitesApi.revokeInvite(invite.id);
              setInvites((prev) =>
                prev.map((i) =>
                  i.id === invite.id ? { ...i, status: 'REVOKED' } : i,
                ),
              );
            } catch (err) {
              console.error(
                'CoachInvitesScreen: revoke failed',
                errorMessage(err),
              );
              Alert.alert(
                'Could not complete this action',
                'Please try again.',
              );
            }
          },
        },
      ],
    );
  }, []);

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
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Invites</Text>
        <Pressable
          onPress={() => navigation.navigate('BulkInvite' as never)}
          style={styles.actionBtnTop}
          accessibilityRole="button"
          accessibilityLabel="Bulk invite"
          testID="coach-invites-bulk-cta"
        >
          <Ionicons name="add" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${f}`}
              onPress={() => setFilter(f)}
              style={[
                styles.filterChip,
                active && styles.filterChipActive,
              ]}
              testID={`coach-invites-filter-${f}`}
            >
              <Text
                style={[
                  styles.filterChipText,
                  active && styles.filterChipTextActive,
                ]}
              >
                {f === 'all'
                  ? 'All'
                  : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="mail-outline" size={42} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No invites</Text>
            <Text style={styles.emptyText}>
              Send your first invite from the bulk-invite screen.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isPending = item.status === 'PENDING';
          const showResend = isPending && resendSupported !== false;
          return (
            <View style={styles.row} testID={`invite-row-${item.id}`}>
              <View style={styles.rowMain}>
                <Text style={styles.rowEmail}>
                  {item.clientEmail ?? '(no email)'}
                </Text>
                <View style={styles.rowMetaRow}>
                  <StatusBadge status={item.status} colors={colors} />
                  {(() => {
                    const emailStatus = toEmailStatus(item.lastEmailStatus);
                    return emailStatus ? (
                      <EmailBadge status={emailStatus} colors={colors} />
                    ) : null;
                  })()}
                  <Text style={styles.rowMetaText}>
                    {formatRelative(item.createdAt)}
                  </Text>
                </View>
              </View>
              <View style={styles.rowActions}>
                {showResend && (
                  <Pressable
                    onPress={() => handleResend(item)}
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Resend invite"
                    testID={`invite-resend-${item.id}`}
                  >
                    <Ionicons
                      name="refresh-outline"
                      size={16}
                      color={colors.primary}
                    />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => handleCopyLink(item)}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Copy invite link"
                  testID={`invite-copy-${item.id}`}
                >
                  <Ionicons
                    name="link-outline"
                    size={16}
                    color={colors.primary}
                  />
                </Pressable>
                {isPending && (
                  <Pressable
                    onPress={() => handleRevoke(item)}
                    style={[styles.actionBtn, styles.actionBtnDanger]}
                    accessibilityRole="button"
                    accessibilityLabel="Revoke invite"
                    testID={`invite-revoke-${item.id}`}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={16}
                      color={colors.error}
                    />
                  </Pressable>
                )}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function StatusBadge({
  status,
  colors,
}: {
  status: InviteStatus;
  colors: ThemeColors;
}) {
  const tint =
    status === 'ACCEPTED'
      ? colors.success
      : status === 'PENDING'
        ? colors.primary
        : colors.textMuted;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: `${tint}22` }]}>
      <Text style={[badgeStyles.text, { color: tint }]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function EmailBadge({
  status,
  colors,
}: {
  status: EmailStatus;
  colors: ThemeColors;
}) {
  const tint =
    status === 'DELIVERED' || status === 'SENT'
      ? colors.success
      : status === 'BOUNCED' || status === 'FAILED'
        ? colors.error
        : colors.textMuted;
  return (
    <View style={[badgeStyles.microPill, { backgroundColor: `${tint}1A` }]}>
      <Text style={[badgeStyles.microText, { color: tint }]}>
        {emailStatusLabel(status)}
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  text: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  microPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  microText: { fontSize: 9, fontWeight: '500', textTransform: 'uppercase' },
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
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
    actionBtnTop: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
    filters: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterChipText: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    filterChipTextActive: { color: colors.textOnPrimary },
    list: { paddingHorizontal: 16, paddingBottom: 40 },
    empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    emptyText: { fontSize: 13, color: colors.textSecondary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 8,
      marginBottom: 8,
    },
    rowMain: { flex: 1 },
    rowEmail: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    rowMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    rowMetaText: { fontSize: 11, color: colors.textMuted },
    rowActions: { flexDirection: 'row', gap: 6 },
    actionBtn: {
      width: 32,
      height: 32,
      borderRadius: 999,
      backgroundColor: colors.primaryPale,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionBtnDanger: { backgroundColor: `${colors.error}1A` },
  });
}

// Exported for tests.
export const __test = { formatRelative, statusLabel, emailStatusLabel };
