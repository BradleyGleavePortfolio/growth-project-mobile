/**
 * CoachAvailabilityEditorScreen — weekly recurring availability editor.
 *
 * Backend: GET /scheduling/coaches/:id/availability + POST same path
 * (atomic replace). The coach edits a local copy of the window set;
 * Save submits the full set in one call.
 *
 * Why local-edit-then-save: the backend exposes only atomic replace.
 * Per-window upsert/delete endpoints do not exist. Documented in
 * /home/user/workspace/concierge-phase1-mobile/AUDIT.md §3.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  useCoachAvailability,
  useSetAvailability,
} from '../../hooks/useScheduling';
import type {
  AvailabilityWindow,
  UpsertAvailabilityWindowInput,
} from '../../api/schedulingApi';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export type CoachAvailabilityEditorParams = { coachId: string };

interface Props {
  route: RouteProp<
    { CoachAvailabilityEditor: CoachAvailabilityEditorParams },
    'CoachAvailabilityEditor'
  >;
}

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm}`;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type DraftWindow = UpsertAvailabilityWindowInput & { _key: string };

function toDraft(w: AvailabilityWindow): DraftWindow {
  return {
    _key: w.id,
    day_of_week: w.day_of_week,
    start_minute: w.start_minute,
    end_minute: w.end_minute,
    session_type_id: w.session_type_id ?? undefined,
  };
}

export default function CoachAvailabilityEditorScreen({ route }: Props) {
  const { coachId } = route.params;
  const { colors } = useTheme();
  const oxblood = colors.error;
  const { data, isLoading, isError, refetch } = useCoachAvailability(coachId);
  const setAvailability = useSetAvailability(coachId);
  const [draft, setDraft] = useState<DraftWindow[]>([]);

  useEffect(() => {
    if (data) setDraft(data.map(toDraft));
  }, [data]);

  const groupedByDay = useMemo(() => {
    const out: Record<number, DraftWindow[]> = {};
    for (let i = 0; i < 7; i += 1) out[i] = [];
    for (const w of draft) out[w.day_of_week].push(w);
    for (let i = 0; i < 7; i += 1) {
      out[i].sort((a, b) => a.start_minute - b.start_minute);
    }
    return out;
  }, [draft]);

  const addWindow = useCallback((dayOfWeek: number) => {
    const _key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setDraft((cur) => [
      ...cur,
      {
        _key,
        day_of_week: dayOfWeek,
        start_minute: 9 * 60,
        end_minute: 10 * 60,
      },
    ]);
  }, []);

  const removeWindow = useCallback((key: string) => {
    setDraft((cur) => cur.filter((w) => w._key !== key));
  }, []);

  const updateTime = useCallback(
    (key: string, field: 'start_minute' | 'end_minute', minute: number) => {
      setDraft((cur) =>
        cur.map((w) => (w._key === key ? { ...w, [field]: minute } : w)),
      );
    },
    [],
  );

  const onSave = useCallback(() => {
    const windows: UpsertAvailabilityWindowInput[] = draft.map(
      ({ _key: _unused, ...rest }) => rest,
    );
    setAvailability.mutate({ windows });
  }, [draft, setAvailability]);

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
          Could not load availability.
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

  const isSaving = setAvailability.isPending;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        Weekly availability
      </Text>
      <Text
        style={[
          typography.bodySmall,
          { color: colors.textMuted, marginBottom: spacing.md },
        ]}
      >
        {/* V-5 fix: the previous copy claimed "Times shown in
            <deviceTZ>" but the editor stores minute-of-day that the
            backend interprets relative to the coach's profile timezone,
            not the device TZ. That's correct behaviour (DST-stable, no
            client-clock drift) but the label was misleading and the
            audit caught it. Make the contract explicit. */}
        Times are stored in your coach profile timezone. Your device shows{' '}
        {deviceTimezone()}.
      </Text>

      {DAY_LABELS.map((label, dayIdx) => (
        <View
          key={label}
          style={[styles.dayCard, { backgroundColor: colors.surface }]}
        >
          <Text style={[typography.h3, { color: colors.textPrimary }]}>
            {label}
          </Text>
          {groupedByDay[dayIdx].length === 0 ? (
            <Text
              style={[
                typography.bodySmall,
                { color: colors.textMuted, marginTop: spacing.xs },
              ]}
            >
              No windows.
            </Text>
          ) : null}
          {groupedByDay[dayIdx].map((w) => (
            <View key={w._key} style={styles.windowRow}>
              <View style={styles.stepperGroup}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Start time minus 30 minutes"
                  onPress={() =>
                    updateTime(
                      w._key,
                      'start_minute',
                      Math.max(0, w.start_minute - 30),
                    )
                  }
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={[typography.body, { color: colors.textPrimary }]}>−</Text>
                </TouchableOpacity>
                <View style={[styles.timeChip, { borderColor: colors.border }]}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>
                    {minutesToLabel(w.start_minute)}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Start time plus 30 minutes"
                  onPress={() =>
                    updateTime(
                      w._key,
                      'start_minute',
                      Math.min(w.end_minute - 30, w.start_minute + 30),
                    )
                  }
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={[typography.body, { color: colors.textPrimary }]}>+</Text>
                </TouchableOpacity>
              </View>
              <Text
                style={[typography.body, { color: colors.textMuted, marginHorizontal: spacing.xs }]}
              >
                to
              </Text>
              <View style={styles.stepperGroup}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="End time minus 30 minutes"
                  onPress={() =>
                    updateTime(
                      w._key,
                      'end_minute',
                      Math.max(w.start_minute + 30, w.end_minute - 30),
                    )
                  }
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={[typography.body, { color: colors.textPrimary }]}>−</Text>
                </TouchableOpacity>
                <View style={[styles.timeChip, { borderColor: colors.border }]}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>
                    {minutesToLabel(w.end_minute)}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="End time plus 30 minutes"
                  onPress={() =>
                    updateTime(
                      w._key,
                      'end_minute',
                      Math.min(1440, w.end_minute + 30),
                    )
                  }
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={[typography.body, { color: colors.textPrimary }]}>+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Remove window"
                onPress={() => removeWindow(w._key)}
                style={styles.removeBtn}
              >
                <Text style={[typography.body, { color: oxblood }]}>
                  Remove
                </Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => addWindow(dayIdx)}
            style={[styles.addBtn, { borderColor: oxblood }]}
          >
            <Text style={[typography.body, { color: oxblood }]}>
              Add window
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        accessibilityRole="button"
        disabled={isSaving}
        onPress={onSave}
        style={[
          styles.primaryBtn,
          { backgroundColor: oxblood, opacity: isSaving ? 0.6 : 1 },
        ]}
      >
        <Text style={[typography.body, { color: colors.textOnPrimary }]}>
          {isSaving ? 'Saving...' : 'Save availability'}
        </Text>
      </TouchableOpacity>

      {setAvailability.isError ? (
        <Text
          style={[
            typography.bodySmall,
            { color: oxblood, marginTop: spacing.sm },
          ]}
        >
          Save failed. Check your connection and try again.
        </Text>
      ) : null}
      {setAvailability.isSuccess ? (
        <Text
          style={[
            typography.bodySmall,
            { color: colors.textMuted, marginTop: spacing.sm },
          ]}
        >
          Saved.
        </Text>
      ) : null}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  dayCard: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  stepperGroup: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    borderWidth: 1,
    borderRadius: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 64,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  removeBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  addBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: spacing.md,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
});
