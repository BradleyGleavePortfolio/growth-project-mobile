/**
 * CoachBookingInboxScreen — pending booking requests, with Confirm /
 * Decline actions.
 *
 * Backend has no dedicated "pending" endpoint. We use the session
 * list and filter to `status === 'requested'` client-side. Documented
 * in /home/user/workspace/concierge-phase1-mobile/AUDIT.md §3.
 */

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useApproveSession,
  useDeclineSession,
  useMyUpcomingSessions,
} from '../../hooks/useScheduling';
import type { CoachingSession } from '../../api/schedulingApi';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function CoachBookingInboxScreen() {
  const { colors } = useTheme();
  const oxblood = colors.danger;
  const { data, isLoading, isError, refetch } = useMyUpcomingSessions(100);
  const approve = useApproveSession();
  const decline = useDeclineSession();

  const pending = useMemo<CoachingSession[]>(
    () => (data ?? []).filter((s) => s.status === 'requested'),
    [data],
  );

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={oxblood} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>
          Could not load requests.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[styles.primaryBtn, { backgroundColor: oxblood }]}
        >
          <Text style={[typography.body, { color: colors.textOnPrimary }]}>
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        Pending requests
      </Text>

      {pending.length === 0 ? (
        <Text
          style={[
            typography.body,
            {
              color: colors.textMuted,
              marginTop: spacing.lg,
              textAlign: 'center',
            },
          ]}
        >
          No pending requests.
        </Text>
      ) : null}

      {pending.map((s) => {
        const busy =
          (approve.isPending && approve.variables?.id === s.id) ||
          (decline.isPending && decline.variables?.id === s.id);
        return (
          <View
            key={s.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              {s.title}
            </Text>
            <Text
              style={[
                typography.bodySmall,
                { color: colors.textMuted, marginTop: spacing.xs },
              ]}
            >
              {formatRange(s.start_at, s.end_at)}
            </Text>
            <Text
              style={[
                typography.bodySmall,
                { color: colors.textMuted, marginTop: spacing.xs },
              ]}
            >
              Client: {s.client_id ?? 'unknown'}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Confirm session ${s.title}`}
                disabled={busy}
                onPress={() => approve.mutate({ id: s.id })}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: oxblood, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[typography.body, { color: colors.textOnPrimary }]}
                >
                  Confirm
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Decline session ${s.title}`}
                disabled={busy}
                onPress={() => decline.mutate({ id: s.id })}
                style={[
                  styles.declineBtn,
                  { borderColor: oxblood, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={[typography.body, { color: oxblood }]}>
                  Decline
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return `${s.toLocaleString()} – ${e.toLocaleTimeString()}`;
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  confirmBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginRight: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginLeft: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: spacing.md,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
