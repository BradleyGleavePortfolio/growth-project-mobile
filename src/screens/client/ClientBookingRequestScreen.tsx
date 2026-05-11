/**
 * ClientBookingRequestScreen — request a coaching session.
 *
 * The backend has no "open slots" endpoint yet (documented in
 * /home/user/workspace/concierge-phase1-mobile/AUDIT.md §3). When the
 * coach's availability is empty or when the open-slots fetch fails,
 * render the empty-state path: a calm placeholder with a retry button.
 *
 * Phase 1 keeps coach selection simple: the assigned coach comes from
 * `useCurrentUser().coach_id` (single-valued today). If the user has
 * no coach, render an empty state.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useCoachAvailability,
  useRequestSession,
} from '../../hooks/useScheduling';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function ClientBookingRequestScreen() {
  const { colors } = useTheme();
  const oxblood = colors.error;
  const user = useCurrentUser();
  const coachId = user?.coach_id;

  const [pickedDate, setPickedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const {
    data: windows,
    isLoading,
    isError,
    refetch,
  } = useCoachAvailability(coachId);
  const requestSession = useRequestSession();

  const dayOptions = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 14; i += 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  const onChooseSlot = useCallback(
    (startAt: Date, endAt: Date) => {
      if (!coachId) return;
      requestSession.mutate(
        {
          coach_id: coachId,
          title: 'Coaching session',
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
        },
        {
          onSuccess: () => setSubmitted(true),
        },
      );
    },
    [coachId, requestSession],
  );

  if (!coachId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.body, { color: colors.textPrimary, textAlign: 'center' }]}>
          You do not have an assigned coach yet.
        </Text>
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.h2, { color: colors.textPrimary, textAlign: 'center' }]}>
          Request sent.
        </Text>
        <Text
          style={[
            typography.body,
            {
              color: colors.textMuted,
              textAlign: 'center',
              marginTop: spacing.sm,
            },
          ]}
        >
          Your coach will confirm.
        </Text>
      </View>
    );
  }

  const dayOfWeek = pickedDate.getDay();
  const dayWindows = (windows ?? []).filter((w) => w.day_of_week === dayOfWeek);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        Request a session
      </Text>

      <Text
        style={[
          typography.bodySmall,
          { color: colors.textMuted, marginTop: spacing.md },
        ]}
      >
        Date
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayStrip}
      >
        {dayOptions.map((d) => {
          const selected = d.getTime() === pickedDate.getTime();
          return (
            <TouchableOpacity
              key={d.toISOString()}
              accessibilityRole="button"
              accessibilityLabel={`Pick ${d.toDateString()}`}
              accessibilityState={{ selected }}
              onPress={() => setPickedDate(d)}
              style={[
                styles.dayChip,
                {
                  borderColor: selected ? oxblood : colors.border,
                  backgroundColor: selected ? oxblood : colors.surface,
                },
              ]}
            >
              <Text
                style={[
                  typography.bodySmall,
                  {
                    color: selected ? colors.textOnPrimary : colors.textMuted,
                  },
                ]}
              >
                {dayShortLabel(d)}
              </Text>
              <Text
                style={[
                  typography.body,
                  {
                    color: selected ? colors.textOnPrimary : colors.textPrimary,
                  },
                ]}
              >
                {d.getDate()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text
        style={[
          typography.bodySmall,
          { color: colors.textMuted, marginTop: spacing.lg },
        ]}
      >
        Available times
      </Text>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={oxblood} />
        </View>
      ) : isError || dayWindows.length === 0 ? (
        <View
          style={[
            styles.emptyBox,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              typography.body,
              { color: colors.textPrimary, textAlign: 'center' },
            ]}
          >
            Available times will appear once your coach has set availability.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => refetch()}
            style={[
              styles.retryBtn,
              { borderColor: oxblood, marginTop: spacing.md },
            ]}
          >
            <Text style={[typography.body, { color: oxblood }]}>Retry</Text>
          </TouchableOpacity>
        </View>
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
            const pending = requestSession.isPending;
            return (
              <TouchableOpacity
                key={w.id}
                accessibilityRole="button"
                accessibilityLabel={`Request session ${label}`}
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
        Notes for your coach (optional)
      </Text>
      <TextInput
        accessibilityLabel="Notes for your coach"
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="What's top of mind?"
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

      {requestSession.isError ? (
        <Text
          style={[
            typography.bodySmall,
            { color: oxblood, marginTop: spacing.sm },
          ]}
        >
          Could not send request. Try again.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function dayShortLabel(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dayStrip: { paddingVertical: spacing.xs, paddingRight: spacing.md },
  dayChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    minWidth: 60,
    alignItems: 'center',
    minHeight: 60,
    justifyContent: 'center',
  },
  loadingBox: { paddingVertical: spacing.lg, alignItems: 'center' },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    marginTop: spacing.xs,
    alignItems: 'center',
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
