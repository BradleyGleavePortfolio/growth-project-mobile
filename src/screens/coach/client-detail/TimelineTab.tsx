import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { errorMessage } from '../../../types/common';
import { successTap, warningTap } from '../../../utils/haptics';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import type { TimelineEvent } from './types';

/**
 * A check-in row offers "Mark reviewed" only when it is unreviewed and is
 * attached to the signed-in coach: the server accepts the review from that
 * coach only, so any other row would be a button that always fails.
 */
export function canMarkReviewed(event: TimelineEvent, viewerId: string | null | undefined): boolean {
  const c = event.checkIn;
  return !!c && !c.reviewed && !!viewerId && c.coachId === viewerId;
}

/** "Reviewed" tick, or the "Mark reviewed" action with its own busy/error state. */
function CheckInReview({
  checkInId,
  reviewed,
  onMarkReviewed,
}: {
  checkInId: string;
  reviewed: boolean;
  onMarkReviewed?: (checkInId: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const tlStyles = useMemo(() => makeTlStyles(colors), [colors]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reviewed) {
    return (
      <View style={tlStyles.reviewedRow} testID={`timeline-checkin-reviewed-${checkInId}`}>
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
        <Text style={tlStyles.reviewedText}>Reviewed</Text>
      </View>
    );
  }
  if (!onMarkReviewed) return null;

  const onPress = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onMarkReviewed(checkInId);
      successTap();
    } catch (err) {
      warningTap();
      setError(errorMessage(err, 'This check-in could not be marked reviewed. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={tlStyles.reviewBtn}
        onPress={onPress}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Mark check-in reviewed"
        accessibilityState={{ busy: saving }}
        testID={`timeline-checkin-review-${checkInId}`}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={tlStyles.reviewBtnText}>Mark reviewed</Text>
        )}
      </TouchableOpacity>
      {error ? (
        <Text style={tlStyles.reviewError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </>
  );
}

export function TimelineTab({
  events,
  onLoad,
  days,
  viewerId,
  onMarkReviewed,
  loading = false,
  error = null,
}: {
  events: TimelineEvent[];
  onLoad: () => void;
  days: number;
  /** Signed-in coach id; check-in review is offered only for their rows. */
  viewerId?: string | null;
  onMarkReviewed?: (checkInId: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}) {
  const { colors } = useTheme();
  const tlStyles = useMemo(() => makeTlStyles(colors), [colors]);
  React.useEffect(() => {
    onLoad();
  }, [days]);

  if (loading) return <QuietLoading label="Loading timeline" testID="client-timeline-loading" />;
  if (error) return <QuietError message={error} onRetry={onLoad} testID="client-timeline-error" />;

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (events.length === 0) {
    return (
      <View style={tlStyles.empty}>
        <Ionicons name="time-outline" size={40} color={colors.textMuted} />
        <Text style={tlStyles.emptyText}>No activity in the last {days} days</Text>
      </View>
    );
  }

  return (
    <View style={tlStyles.container}>
      <Text style={tlStyles.header}>Activity — Last {days} Days</Text>
      {events.map((event, idx) => (
        <View key={event.id} style={tlStyles.eventRow}>
          {/* Left column: icon + line */}
          <View style={tlStyles.leftCol}>
            <View style={[tlStyles.iconCircle, { backgroundColor: event.iconColor + '20' }]}>
              <Ionicons name={event.icon} size={16} color={event.iconColor} />
            </View>
            {idx < events.length - 1 && <View style={tlStyles.line} />}
          </View>
          {/* Right column: content */}
          <View style={tlStyles.content}>
            <Text style={tlStyles.title}>{event.title}</Text>
            <Text style={tlStyles.subtitle}>{event.subtitle}</Text>
            <Text style={tlStyles.date}>{formatDate(event.date)}</Text>
            {event.checkIn && (event.checkIn.reviewed || canMarkReviewed(event, viewerId)) ? (
              <CheckInReview
                checkInId={event.checkIn.id}
                reviewed={event.checkIn.reviewed}
                onMarkReviewed={onMarkReviewed}
              />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export const makeTlStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  header: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 16,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  eventRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 0,
  },
  leftCol: {
    alignItems: 'center',
    width: 32,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 4, // radius.lg
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  date: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  reviewedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  reviewedText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.success,
  },
  reviewBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 120,
    marginTop: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.primary,
  },
  reviewError: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },

  });
