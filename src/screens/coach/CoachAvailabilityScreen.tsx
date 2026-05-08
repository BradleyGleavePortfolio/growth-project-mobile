// CoachAvailabilityScreen — shell for the coach's call-window settings.
//
// The actual editor (recurring rules, blackout dates, capacity) lands once
// the backend availability endpoints exist. This shell renders the entry
// point + calendar-connection state so the surface is ready to flesh out.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  COACH_AVAILABILITY,
  SESSIONS_DISABLED_PLACEHOLDER,
  calendarConnectionLabel,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type {
  CalendarConnectionStatus,
  CoachAvailability,
} from '../../types/sessions';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'CoachAvailability'>;
  route: RouteProp<ClientsStackParamList, 'CoachAvailability'>;
};

export default function CoachAvailabilityScreen({ route }: Props) {
  const { coachId } = route.params;
  const enabled = isSessionsFeatureEnabled(
    'SESSIONS_COACH_AVAILABILITY_ENABLED',
  );
  const [windows, setWindows] = useState<CoachAvailability[]>([]);
  const [conn, setConn] = useState<CalendarConnectionStatus>('not_connected');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const adapter = getSessionsAdapter();
    Promise.all([
      adapter.listAvailabilityForClient(coachId),
      adapter.getCalendarConnection(coachId),
    ])
      .then(([w, c]) => {
        if (!alive) return;
        setWindows(w);
        setConn(c);
      })
      .catch(() => {
        // Leave defaults — fail-closed.
      });
    return () => {
      alive = false;
    };
  }, [enabled, coachId]);

  if (!enabled) {
    return (
      <View style={styles.root} testID="coach-availability-disabled">
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>
            {SESSIONS_DISABLED_PLACEHOLDER.title}
          </Text>
          <Text style={styles.placeholderBody}>
            {SESSIONS_DISABLED_PLACEHOLDER.body}
          </Text>
        </View>
      </View>
    );
  }

  const calStatusLabel = calendarConnectionLabel(conn);

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          {COACH_AVAILABILITY.title}
        </Text>
        <Text style={styles.intro}>{COACH_AVAILABILITY.intro}</Text>

        <View
          style={styles.calBox}
          testID="coach-availability-cal-state"
          accessible
          accessibilityLabel={`Calendar status: ${calStatusLabel}`}
        >
          <Text style={styles.calLabel}>Calendar</Text>
          <Text style={styles.calValue}>{calStatusLabel}</Text>
          {conn === 'not_connected' ? (
            <Text style={styles.calBody}>
              {COACH_AVAILABILITY.notConnectedCalendarBody}
            </Text>
          ) : null}
          {conn === 'expired' || conn === 'revoked' ? (
            <Text style={styles.calBody}>
              {COACH_AVAILABILITY.expiredCalendarBody}
            </Text>
          ) : null}
        </View>

        {windows.length === 0 ? (
          <View
            style={styles.placeholderInline}
            testID="coach-availability-empty"
          >
            <Text style={styles.placeholderTitle}>
              {COACH_AVAILABILITY.emptyTitle}
            </Text>
            <Text style={styles.placeholderBody}>
              {COACH_AVAILABILITY.emptyBody}
            </Text>
          </View>
        ) : (
          windows.map((w) => (
            <View
              key={w.id}
              style={styles.windowRow}
              accessible
              accessibilityLabel={`Availability window: ${new Date(w.startsAt).toLocaleString()} to ${new Date(w.endsAt).toLocaleString()}`}
            >
              <Text style={styles.windowTime}>
                {new Date(w.startsAt).toLocaleString()} -{' '}
                {new Date(w.endsAt).toLocaleString()}
              </Text>
              <Text style={styles.windowMeta}>
                {w.sessionTypes.join(' · ')}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bone },
  content: { padding: spacing.lg },
  heading: { ...typography.h2, color: colors.ink, marginBottom: spacing.sm },
  intro: { ...typography.body, color: colors.charcoal, marginBottom: spacing.lg },
  calBox: {
    backgroundColor: colors.cream,
    padding: spacing.lg,
    borderRadius: 8,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
  },
  calLabel: { ...typography.eyebrow, color: colors.charcoal },
  calValue: { ...typography.h3, color: colors.ink, marginTop: spacing.xs },
  calBody: { ...typography.body, color: colors.charcoal, marginTop: spacing.sm },
  windowRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stone,
  },
  windowTime: { ...typography.body, color: colors.ink },
  windowMeta: { ...typography.caption, color: colors.stone, marginTop: spacing.xs },
  placeholder: {
    flex: 1,
    margin: spacing.lg,
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInline: {
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
  },
  placeholderTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
});
