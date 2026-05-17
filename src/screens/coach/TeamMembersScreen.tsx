/**
 * TeamMembersScreen — Sub-coach roster with per-coach revenue sharing toggle.
 *
 * Revenue sharing:
 *   GET  /coach/team/members/:sub_coach_id/revenue-sharing → { revenue_sharing_enabled }
 *   PATCH /coach/team/members/:sub_coach_id/revenue-sharing { enabled } → update
 *
 * Toggle state is cached in MMKV under 'coach.revenue_sharing_<id>' for
 * optimistic hydration before the API call resolves.
 *
 * Skeleton: 3 placeholder rows while the roster loads. No ActivityIndicator.
 * Error: RefreshControl retry when the members list fails to load.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { coachTeamApi, TeamMember } from '../../api/coachTeamApi';
import { prefsStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import api from '../../services/api';

// ─── Revenue sharing API helpers ─────────────────────────────────────────────

interface RevenueSharingStatus {
  revenue_sharing_enabled: boolean;
}

async function getRevenueSharing(subCoachId: string): Promise<boolean> {
  const res = await api.get<RevenueSharingStatus>(
    `/coach/team/members/${subCoachId}/revenue-sharing`,
  );
  return res.data.revenue_sharing_enabled;
}

async function patchRevenueSharing(subCoachId: string, enabled: boolean): Promise<void> {
  await api.patch(`/coach/team/members/${subCoachId}/revenue-sharing`, { enabled });
}

// ─── MMKV helpers ─────────────────────────────────────────────────────────────

function cacheKey(id: string) {
  return `coach.revenue_sharing_${id}`;
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.skeletonRow} />;
}

// ─── Member row ───────────────────────────────────────────────────────────────

interface MemberRowProps {
  member: TeamMember;
  enabled: boolean;
  onToggle: (id: string, value: boolean) => void;
  error: string | null;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function MemberRow({ member, enabled, onToggle, error, styles, colors }: MemberRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.memberName}>{member.name}</Text>
        <Text style={styles.memberEmail}>{member.email}</Text>
        <Text style={styles.memberClients}>
          {member.assigned_clients} {member.assigned_clients === 1 ? 'client' : 'clients'}
        </Text>
        <Text
          style={[
            styles.revenueDesc,
            enabled ? styles.revenueDescEnabled : styles.revenueDescDisabled,
          ]}
        >
          {enabled
            ? '5% of this coach\'s sales flows to you.'
            : 'Revenue sharing off.'}
        </Text>
        {error ? <Text style={styles.rowError}>{error}</Text> : null}
      </View>
      <Switch
        value={enabled}
        onValueChange={(val) => onToggle(member.id, val)}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={enabled ? colors.primary : colors.textMuted}
        accessibilityRole="switch"
        accessibilityLabel={`Revenue sharing for ${member.name}`}
        accessibilityState={{ checked: enabled }}
        testID={`revenue-sharing-toggle-${member.id}`}
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TeamMembersScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Per-member toggle state: id → boolean
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});
  // Per-member toggle error messages
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});

  // ── Load members ───────────────────────────────────────────────────────────
  const loadMembers = useCallback(async () => {
    setMembersError(null);
    try {
      const result = await coachTeamApi.getMembers();
      if (!result.ok) {
        setMembersError(
          result.reason === 'not_configured'
            ? 'Team not set up yet.'
            : result.message ?? 'Unable to load team. Pull to refresh.',
        );
        return;
      }
      const subCoaches = result.data.filter((m) => m.role === 'sub_coach');
      setMembers(subCoaches);

      // Hydrate from MMKV cache first (optimistic)
      const cachedStates: Record<string, boolean> = {};
      await Promise.all(
        subCoaches.map(async (m) => {
          const cached = await prefsStorage.getStringAsync(cacheKey(m.id));
          if (cached !== undefined) {
            cachedStates[m.id] = cached === 'true';
          }
        }),
      );
      setToggleStates((prev) => ({ ...prev, ...cachedStates }));

      // Fetch from API in parallel, overwrite cache
      const apiStates = await Promise.allSettled(
        subCoaches.map((m) => getRevenueSharing(m.id)),
      );
      const freshStates: Record<string, boolean> = {};
      apiStates.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          freshStates[subCoaches[idx].id] = result.value;
          // Write to cache
          prefsStorage
            .set(cacheKey(subCoaches[idx].id), String(result.value))
            .catch(() => {});
        }
      });
      setToggleStates((prev) => ({ ...prev, ...freshStates }));
    } catch {
      setMembersError('Unable to load team. Pull to refresh.');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setLoadingMembers(true);
    await loadMembers();
    setRefreshing(false);
  }, [loadMembers]);

  // ── Toggle handler (optimistic) ────────────────────────────────────────────
  const handleToggle = useCallback(async (id: string, value: boolean) => {
    // Clear any prior error for this row
    setToggleErrors((prev) => ({ ...prev, [id]: '' }));
    // Optimistic update
    setToggleStates((prev) => ({ ...prev, [id]: value }));

    try {
      await patchRevenueSharing(id, value);
      // Persist to cache on success
      prefsStorage.set(cacheKey(id), String(value)).catch(() => {});
    } catch {
      // Revert on failure
      setToggleStates((prev) => ({ ...prev, [id]: !value }));
      setToggleErrors((prev) => ({
        ...prev,
        [id]: 'Update failed. Please try again.',
      }));
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headline}>Your Team</Text>
          <Text style={styles.subtext}>Toggle revenue sharing per coach.</Text>
        </View>

        {/* Loading skeleton */}
        {loadingMembers && !refreshing && (
          <>
            <SkeletonRow styles={styles} />
            <SkeletonRow styles={styles} />
            <SkeletonRow styles={styles} />
          </>
        )}

        {/* Error state */}
        {!loadingMembers && membersError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{membersError}</Text>
          </View>
        )}

        {/* Member rows */}
        {!loadingMembers &&
          !membersError &&
          members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              enabled={toggleStates[member.id] ?? false}
              onToggle={handleToggle}
              error={toggleErrors[member.id] ?? null}
              styles={styles}
              colors={colors}
            />
          ))}

        {/* Empty state */}
        {!loadingMembers && !membersError && members.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No sub-coaches on your team yet.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: {
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 40,
    },
    header: { marginBottom: 28 },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    // Member row
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rowLeft: { flex: 1, paddingRight: 12 },
    memberName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    memberEmail: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 2,
    },
    memberClients: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 4,
    },
    revenueDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
    },
    revenueDescEnabled: { color: colors.primary },
    revenueDescDisabled: { color: colors.textMuted },
    rowError: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.error,
      marginTop: 4,
    },
    // Skeleton
    skeletonRow: {
      height: 72,
      borderRadius: 2,
      backgroundColor: colors.surface,
      marginBottom: 12,
    },
    // Error / empty
    errorContainer: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
    },
    emptyContainer: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textMuted,
    },
  });
