/**
 * AdminControlRoomScreen — Wave 11.
 *
 * Governance view for admin/ops users. STUB: backend not live; renders
 * empty payload from the adapter.
 *
 * Doctrine: AI surfaces aggregate alerts and recommendations. Every action
 * (suspend coach, dismiss alert, escalate dispute) flows through admin
 * approval — there is no autonomous remediation in this UI.
 *
 * Role gating: this screen is mounted in the coach navigator under a
 * settings sub-route AND is gated by the `adminControlRoom` flag. The
 * flag stays OFF unless the admin role flips it on; the screen itself
 * does not check the role server-side at this layer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography, spacing, semantic } from '../../theme/tokens';
import { fetchAdminControlRoom } from '../../services/wave11Adapters';
import type { AdminAlert, AdminControlRoomPayload } from '../../types/wave11';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';

export default function AdminControlRoomScreen() {
  const [payload, setPayload] = useState<AdminControlRoomPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchAdminControlRoom();
      setPayload(next);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!featureFlags.adminControlRoom) {
    return (
      <View
        style={styles.flagOff}
        accessibilityLabel="Admin Control Room is preview-only"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Admin Control Room is preview-only"
          subtitle="Available to admins once the live data feed lands."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return <SkeletonScreen count={6} />;
  }

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const k = payload!.kpis;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="Admin Control Room screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel="Pull to refresh control room"
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">Control Room</Text>
      <Text style={styles.subtitle}>
        AI surfaces signal. Admin approves the response.
      </Text>

      <View
        style={styles.kpiGrid}
        accessibilityLabel="Platform KPIs"
        accessibilityRole="none"
      >
        <Kpi label="Active coaches" value={k.activeCoaches} />
        <Kpi label="Active clients" value={k.activeClients} />
        <Kpi label="Pending signoffs" value={k.pendingSignoffs} accent />
        <Kpi label="Flagged" value={k.flaggedItems} danger />
        <Kpi label="Disputed" value={k.disputedItems} danger />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Alerts</Text>
        {payload!.alerts.length === 0 ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="No active alerts"
            subtitle="When the AI flags abuse, dispute spikes, or signoff backlogs, you'll see them here."
          />
        ) : (
          payload!.alerts.map((a) => <AlertRow key={a.id} alert={a} />)
        )}
      </View>
    </ScrollView>
  );
}

function Kpi({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  const valueStyle = [
    styles.kpiValue,
    accent && { color: tokens.forest },
    danger && { color: semantic.danger.fg },
  ];
  return (
    <View
      style={styles.kpi}
      accessibilityRole="none"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={valueStyle}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function AlertRow({ alert }: { alert: AdminAlert }) {
  const palette =
    alert.severity === 'critical'
      ? semantic.danger
      : alert.severity === 'watch'
      ? semantic.warning
      : semantic.info;
  return (
    <View
      style={[
        styles.alert,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
      accessibilityRole="none"
      accessibilityLabel={`${alert.severity} alert: ${alert.headline}${alert.aiRecommendation ? '. AI suggests: ' + alert.aiRecommendation : ''}`}
    >
      <View style={styles.alertHead}>
        <Ionicons
          name={
            alert.severity === 'critical'
              ? 'alert-circle'
              : alert.severity === 'watch'
              ? 'warning-outline'
              : 'information-circle-outline'
          }
          size={16}
          color={palette.fg}
        />
        <Text style={[styles.alertHeadline, { color: palette.fg }]}>
          {alert.headline}
        </Text>
      </View>
      {alert.aiRecommendation ? (
        <Text style={styles.alertAi}>
          <Text style={styles.aiBadge}>AI suggests</Text> · {alert.aiRecommendation}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.bone },
  title: { ...typography.h1, color: tokens.ink, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: tokens.charcoal, marginBottom: spacing.lg },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  kpi: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.md,
    gap: 4,
  },
  kpiValue: {
    fontFamily: typography.h2.fontFamily,
    fontSize: 28,
    color: tokens.ink,
  },
  kpiLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.charcoal,
  },
  section: { marginTop: spacing.md, gap: spacing.md },
  sectionTitle: { ...typography.h3, color: tokens.ink, marginBottom: spacing.xs },
  alert: {
    borderRadius: 4,
    borderWidth: 1,
    padding: spacing.md,
    gap: 6,
  },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertHeadline: {
    ...typography.bodyMd,
    fontWeight: '600',
    flex: 1,
  },
  alertAi: { ...typography.bodySmall, color: tokens.charcoal },
  aiBadge: {
    fontWeight: '600',
    color: tokens.charcoal,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
  },
});
