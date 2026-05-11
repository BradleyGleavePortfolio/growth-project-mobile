/**
 * RescheduleSheet — modal-style overlay that lets a client propose a
 * new start time for an existing session.
 *
 * Reuses the booking-request slot pattern: pick a date, pick a window
 * from the coach's recurring availability, submit via
 * `useRescheduleSession`. Falls back to a plain time picker if no
 * windows are configured yet (mirrors the booking-request empty state
 * without forcing the user to bail).
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { CoachingSession } from '../../api/schedulingApi';
import {
  useCoachAvailability,
  useRescheduleSession,
} from '../../hooks/useScheduling';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

interface Props {
  session: CoachingSession;
  onClose: () => void;
}

export default function RescheduleSheet({ session, onClose }: Props) {
  const { colors } = useTheme();
  const oxblood = colors.danger;
  const reschedule = useRescheduleSession();
  const { data: windows, isLoading } = useCoachAvailability(session.coach_id);

  const [pickedDate, setPickedDate] = useState<Date>(() => {
    const d = new Date(session.start_at);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [reason, setReason] = useState('');

  const onChooseSlot = useCallback(
    (startAt: Date, endAt: Date) => {
      reschedule.mutate(
        {
          id: session.id,
          input: {
            start_at: startAt.toISOString(),
            end_at: endAt.toISOString(),
            reason: reason.trim() === '' ? undefined : reason.trim(),
          },
        },
        {
          onSuccess: () => onClose(),
        },
      );
    },
    [reschedule, session.id, reason, onClose],
  );

  const dayWindows = (windows ?? []).filter(
    (w) => w.day_of_week === pickedDate.getDay(),
  );

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.container}
      >
        <View style={styles.headerRow}>
          <Text style={[typography.h2, { color: colors.textPrimary }]}>
            Reschedule
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.closeBtn}
          >
            <Text style={[typography.body, { color: oxblood }]}>Close</Text>
          </TouchableOpacity>
        </View>

        <Text
          style={[
            typography.bodySmall,
            { color: colors.textMuted, marginTop: spacing.md },
          ]}
        >
          Date
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setShowDatePicker(true)}
          style={[
            styles.dateBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {pickedDate.toDateString()}
          </Text>
        </TouchableOpacity>
        {showDatePicker ? (
          <DateTimePicker
            value={pickedDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_e, selected) => {
              if (Platform.OS === 'android') setShowDatePicker(false);
              if (selected) {
                const d = new Date(selected);
                d.setHours(0, 0, 0, 0);
                setPickedDate(d);
              }
            }}
          />
        ) : null}

        <Text
          style={[
            typography.bodySmall,
            { color: colors.textMuted, marginTop: spacing.lg },
          ]}
        >
          New time
        </Text>

        {isLoading ? (
          <ActivityIndicator color={oxblood} style={{ marginTop: spacing.md }} />
        ) : dayWindows.length === 0 ? (
          <Text
            style={[
              typography.body,
              { color: colors.textMuted, marginTop: spacing.sm },
            ]}
          >
            No available windows on this date. Pick another day.
          </Text>
        ) : (
          dayWindows
            .slice()
            .sort((a, b) => a.start_minute - b.start_minute)
            .map((w) => {
              const start = new Date(pickedDate);
              start.setMinutes(start.getMinutes() + w.start_minute);
              const end = new Date(pickedDate);
              end.setMinutes(end.getMinutes() + w.end_minute);
              const label = `${formatTime(start)}–${formatTime(end)}`;
              const pending = reschedule.isPending;
              return (
                <TouchableOpacity
                  key={w.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Reschedule to ${label}`}
                  disabled={pending}
                  onPress={() => onChooseSlot(start, end)}
                  style={[
                    styles.slotBtn,
                    {
                      borderColor: oxblood,
                      backgroundColor: colors.surface,
                      opacity: pending ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={[typography.body, { color: oxblood }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })
        )}

        <Text
          style={[
            typography.bodySmall,
            { color: colors.textMuted, marginTop: spacing.lg },
          ]}
        >
          Reason (optional)
        </Text>
        <TextInput
          accessibilityLabel="Reschedule reason"
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="Optional note to your coach"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.notes,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        />

        {reschedule.isError ? (
          <Text
            style={[
              typography.bodySmall,
              { color: oxblood, marginTop: spacing.sm },
            ]}
          >
            Could not reschedule. Try again.
          </Text>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  dateBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  slotBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  notes: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.xs,
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
