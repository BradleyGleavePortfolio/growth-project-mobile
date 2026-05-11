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
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  const oxblood = colors.danger;
  const { data, isLoading, isError, refetch } = useCoachAvailability(coachId);
  const setAvailability = useSetAvailability(coachId);
  const [draft, setDraft] = useState<DraftWindow[]>([]);
  const [pickerFor, setPickerFor] = useState<
    { key: string; field: 'start_minute' | 'end_minute' } | null
  >(null);

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
        Times shown in {deviceTimezone()}.
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
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Edit start time, currently ${minutesToLabel(w.start_minute)}`}
                onPress={() =>
                  setPickerFor({ key: w._key, field: 'start_minute' })
                }
                style={[styles.timeBtn, { borderColor: colors.border }]}
              >
                <Text
                  style={[typography.body, { color: colors.textPrimary }]}
                >
                  {minutesToLabel(w.start_minute)}
                </Text>
              </TouchableOpacity>
              <Text
                style={[typography.body, { color: colors.textMuted, marginHorizontal: spacing.xs }]}
              >
                to
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Edit end time, currently ${minutesToLabel(w.end_minute)}`}
                onPress={() =>
                  setPickerFor({ key: w._key, field: 'end_minute' })
                }
                style={[styles.timeBtn, { borderColor: colors.border }]}
              >
                <Text
                  style={[typography.body, { color: colors.textPrimary }]}
                >
                  {minutesToLabel(w.end_minute)}
                </Text>
              </TouchableOpacity>
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

      {pickerFor ? (
        <DateTimePicker
          value={(() => {
            const w = draft.find((x) => x._key === pickerFor.key);
            const m = w ? w[pickerFor.field] : 540;
            const d = new Date();
            d.setHours(Math.floor(m / 60), m % 60, 0, 0);
            return d;
          })()}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, selected) => {
            if (Platform.OS === 'android') setPickerFor(null);
            if (selected) {
              const minute = selected.getHours() * 60 + selected.getMinutes();
              updateTime(pickerFor.key, pickerFor.field, minute);
            }
          }}
        />
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
  timeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 64,
    alignItems: 'center',
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
