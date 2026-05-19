/**
 * ApplicationStatusScreen — Phase 11 / Track 8
 *
 * Shows the authenticated user's coach application status. Displays the
 * most recent application's lifecycle state, reviewer notes (when available),
 * and a human-readable explanation of what each status means.
 *
 * Navigation: reachable from coach settings / profile screens once a user has
 * submitted a coach application. Placement in the navigator is deferred to
 * Track 8.5 when the full marketplace UI lands; a standalone route reference
 * is added in this PR to keep the merge tractable.
 *
 * Out of scope this PR:
 *   - The public application form (lives on the marketing site; backend
 *     POST /apply/coach endpoint is ready on the backend).
 *   - Offer list / offer acceptance (Track 8.5).
 *   - Connect onboarding redirect (Track 8.5).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { ThemeColors } from '../../theme/ThemeProvider';
import {
  talentMarketplaceApi,
  type MyCoachApplication,
  type CoachApplicationStatus,
} from '../../services/talentMarketplaceApi';

// ─── Status copy ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<CoachApplicationStatus, string> = {
  pending:  'Under review',
  reviewed: 'Reviewed',
  approved: 'Approved',
  pool:     'In the talent pool',
  placed:   'Placed',
  inactive: 'Inactive',
};

const STATUS_DESCRIPTION: Record<CoachApplicationStatus, string> = {
  pending:
    'Your application has been received and is being reviewed by our team. We aim to respond within 5 business days.',
  reviewed:
    'Our team has reviewed your application. A decision is being finalised.',
  approved:
    'Your application has been approved. You will be added to the talent pool shortly.',
  pool:
    'You are in the talent pool and may receive offers from coaches on the platform.',
  placed:
    'You have accepted an offer and are now working with a coach on this platform.',
  inactive:
    'Your application is no longer active. Contact support if you believe this is an error.',
};

/** Token-mapped accent colour per status. Uses theme tokens only. */
function statusColor(
  status: CoachApplicationStatus,
  colors: ThemeColors,
): string {
  switch (status) {
    case 'pending':  return colors.warning;
    case 'reviewed': return colors.info;
    case 'approved': return colors.success;
    case 'pool':     return colors.primary;
    case 'placed':   return colors.success;
    case 'inactive': return colors.textMuted;
    default:         return colors.textMuted;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApplicationStatusScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [applications, setApplications] = useState<MyCoachApplication[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApplications = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await talentMarketplaceApi.getMyApplications();
      setApplications(res.data);
    } catch {
      setError('Unable to load your application. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchApplications();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchApplications(true);
  };

  // Announce status changes to screen readers.
  useEffect(() => {
    const latest = applications?.[0];
    if (latest) {
      AccessibilityInfo.announceForAccessibility(
        `Application status: ${STATUS_LABEL[latest.status]}`,
      );
    }
  }, [applications]);

  // ─── Render states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centeredContainer} accessibilityLabel="Loading application status">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => void fetchApplications()}
          accessibilityLabel="Retry loading application status"
          accessibilityRole="button"
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!applications || applications.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.centeredContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={styles.emptyHeading} accessibilityRole="header">
          No application on file
        </Text>
        <Text style={styles.emptyBody}>
          You have not yet submitted a coach application. The application form
          is available on our website.
        </Text>
      </ScrollView>
    );
  }

  const latest = applications[0]!;
  const accentColor = statusColor(latest.status, colors);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          accessibilityLabel="Pull to refresh application status"
        />
      }
    >
      {/* Status badge */}
      <View
        style={[styles.statusBadge, { borderColor: accentColor }]}
        accessibilityLabel={`Application status: ${STATUS_LABEL[latest.status]}`}
        accessibilityRole="text"
      >
        <Text style={[styles.statusLabel, { color: accentColor }]}>
          {STATUS_LABEL[latest.status]}
        </Text>
      </View>

      {/* Description */}
      <Text style={styles.statusDescription}>
        {STATUS_DESCRIPTION[latest.status]}
      </Text>

      {/* Reviewer notes */}
      {latest.reviewer_notes ? (
        <View style={styles.notesCard} accessibilityLabel="Reviewer notes">
          <Text style={styles.notesHeading}>Reviewer notes</Text>
          <Text style={styles.notesBody}>{latest.reviewer_notes}</Text>
        </View>
      ) : null}

      {/* Application summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryHeading}>Your application</Text>
        <SummaryRow label="Certifications" value={latest.certifications.join(', ') || 'None listed'} />
        <SummaryRow label="Specializations" value={latest.specializations.join(', ') || 'None listed'} />
        <SummaryRow label="Experience" value={`${latest.years_experience} year${latest.years_experience !== 1 ? 's' : ''}`} />
        <SummaryRow label="Availability" value={`${latest.availability_hours_per_week} hrs/week`} />
        <SummaryRow label="Client focus" value={latest.preferred_client_type} />
        <SummaryRow label="Background check" value={latest.background_verified ? 'Verified' : 'Pending'} />
      </View>

      {/* History label when there are older applications */}
      {applications.length > 1 ? (
        <Text style={styles.historyNote}>
          Showing your most recent application. You have {applications.length} total.
        </Text>
      ) : null}
    </ScrollView>
  );
}

// ─── Summary row sub-component ────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 14, flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 24,
      paddingBottom: 48,
    },
    centeredContainer: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    statusBadge: {
      alignSelf: 'flex-start',
      borderWidth: 1.5,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginBottom: 16,
    },
    statusLabel: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    statusDescription: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginBottom: 24,
    },
    notesCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    notesHeading: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    notesBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    },
    summaryHeading: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    historyNote: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 8,
    },
    emptyHeading: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 12,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    errorText: {
      fontSize: 15,
      color: colors.error,
      textAlign: 'center',
      marginBottom: 16,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    retryButtonText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
}
