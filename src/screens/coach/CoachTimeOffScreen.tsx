/**
 * CoachTimeOffScreen — S-SCHED time off (availability overrides).
 *
 * Add a full day off or a blocked stretch of hours on a date; remove it
 * again. Dates and times are in the coach profile's time zone. Calendar
 * refreshes open slots; the existing backend slot cache lasts up to 60 seconds.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AvailabilityOverride } from '../../api/schedulingApi';
import {
  useCreateAvailabilityOverride,
  useDeleteAvailabilityOverride,
  useMyAvailabilityOverrides,
  useSchedulingTimezone,
} from '../../hooks/useCalendar';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { calendarDateInZone } from '../../calendar/calendarTime';
import { useCurrentUser } from '../../hooks/useCurrentUser';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function hhmm(min: number | null): string {
  if (min === null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function describeOverride(o: AvailabilityOverride): string {
  const date = o.date.slice(0, 10);
  if (o.kind === 'extra') return `${date}, extra hours ${hhmm(o.start_minute)} to ${hhmm(o.end_minute)}`;
  if (o.start_minute === null) return `${date}, full day off`;
  return `${date}, off ${hhmm(o.start_minute)} to ${hhmm(o.end_minute)}`;
}

/** Returns an error message, or null when the entry can be saved. */
export function validateTimeOff(date: string, fullDay: boolean, start: string, end: string, today: string): string | null {
  if (!DATE_RE.test(date)) return 'Enter the date as YYYY-MM-DD.';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'That date does not exist. Choose a valid calendar date.';
  if (date < today) return 'Pick today or a later date.';
  if (fullDay) return null;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return 'Enter times as HH:MM, for example 13:00.';
  if (start >= end) return 'The end time must be after the start time.';
  return null;
}

export default function CoachTimeOffScreen() {
  const { colors } = useTheme();
  const me = useCurrentUser();
  const timezone = useSchedulingTimezone(me?.id);
  const today = timezone.data ? calendarDateInZone(new Date(), timezone.data) : '';
  const until = useMemo(() => {
    if (!today) return '';
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 180);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const create = useCreateAvailabilityOverride();
  const remove = useDeleteAvailabilityOverride();
  const [date, setDate] = useState('');
  useEffect(() => { if (today) setDate((current) => current || today); }, [today]);
  const [fullDay, setFullDay] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const q = useMyAvailabilityOverrides(today, DATE_RE.test(date) && date > until ? date : until);

  const add = () => {
    if (saving.current || !timezone.data) return;
    const problem = validateTimeOff(date.trim(), fullDay, start.trim(), end.trim(), today);
    if (problem) {
      setError(problem);
      return;
    }
    saving.current = true;
    setError(null);
    create.mutate(
      {
        date: date.trim(),
        kind: fullDay ? 'holiday' : 'block',
        ...(fullDay ? {} : { start_time: start.trim(), end_time: end.trim() }),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => setNote(''),
        onError: (err) => setError(calendarErrorMessage(err, 'save time off', 'coach')),
        onSettled: () => {
          saving.current = false;
        },
      },
    );
  };

  const confirmRemove = (o: AvailabilityOverride) => {
    Alert.alert('Remove this time off?', describeOverride(o), [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        if (saving.current || remove.isPending) return;
        saving.current = true;
        remove.mutate({ id: o.id }, {
          onError: (err) => setError(calendarErrorMessage(err, 'remove time off', 'coach')),
          onSettled: () => { saving.current = false; },
        });
      } },
    ]);
  };

  const rows = q.data ?? [];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} testID="coach-time-off">
      <Text style={[typography.h2, { color: colors.textPrimary }]} accessibilityRole="header">
        Time off
      </Text>
      <Text style={[typography.bodySmall, { color: colors.textMuted, marginTop: spacing.sm }]}>
        Time off removes open times in Calendar. Existing bookings are not cancelled. Dates and times use your coach profile time zone, which may differ from this device.
      </Text>
      <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
        {timezone.data ? `Coach calendar time zone: ${timezone.data.replace(/_/g, ' ')}.` : 'Loading the coach calendar time zone.'}
      </Text>
      {timezone.isError ? (
        <View>
          <Text style={[typography.bodySmall, { color: colors.error }]}>{calendarErrorMessage(timezone.error, 'load the calendar time zone', 'coach')}</Text>
          <Pressable onPress={() => void timezone.refetch()} accessibilityRole="button" accessibilityLabel="Refresh calendar time zone" style={styles.primary}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh calendar time zone</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={[styles.label, { color: colors.textMuted }]}>Date (YYYY-MM-DD)</Text>
      <TextInput value={date} onChangeText={setDate} maxLength={10} autoCorrect={false} accessibilityLabel="Date" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="time-off-date" />
      <View style={styles.switchRow}>
        <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>Full day</Text>
        <Switch value={fullDay} onValueChange={setFullDay} accessibilityLabel="Full day" testID="time-off-full-day" />
      </View>
      {!fullDay ? (
        <View style={styles.timeRow}>
          <View style={styles.timeCol}>
            <Text style={[styles.label, { color: colors.textMuted }]}>From (HH:MM)</Text>
            <TextInput value={start} onChangeText={setStart} maxLength={5} accessibilityLabel="From" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="time-off-start" />
          </View>
          <View style={styles.timeCol}>
            <Text style={[styles.label, { color: colors.textMuted }]}>To (HH:MM)</Text>
            <TextInput value={end} onChangeText={setEnd} maxLength={5} accessibilityLabel="To" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="time-off-end" />
          </View>
        </View>
      ) : null}
      <Text style={[styles.label, { color: colors.textMuted }]}>Note for yourself (optional)</Text>
      <TextInput value={note} onChangeText={setNote} maxLength={200} accessibilityLabel="Note" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} />
      {error ? (
        <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.md }]} testID="time-off-error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Pressable onPress={add} disabled={create.isPending || !timezone.data} accessibilityRole="button" accessibilityLabel="Add time off" accessibilityState={{ disabled: create.isPending || !timezone.data, busy: create.isPending }} style={[styles.primary, { backgroundColor: colors.textPrimary, opacity: create.isPending || !timezone.data ? 0.6 : 1 }]} testID="time-off-add">
        <Text style={[typography.bodyMd, { color: colors.background }]}>Add time off</Text>
      </Pressable>

      <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing.xl }]} accessibilityRole="header">
        Coming up
      </Text>
      {q.isLoading ? <Text style={[typography.body, { color: colors.textMuted }]}>Loading.</Text> : null}
      {q.isError ? (
        <View>
          <Text style={[typography.body, { color: colors.textMuted }]}>{calendarErrorMessage(q.error, 'load time off', 'coach')}</Text>
          <Pressable onPress={() => void q.refetch()} accessibilityRole="button" accessibilityLabel="Refresh time off" style={[styles.secondary, { borderColor: colors.border }]}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh time off</Text>
          </Pressable>
        </View>
      ) : null}
      {timezone.data && !q.isLoading && !q.isError && rows.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.md }]} testID="time-off-empty">
          No time off planned.
        </Text>
      ) : null}
      {rows.map((o) => (
        <View key={o.id} style={[styles.card, { borderColor: colors.border }]} testID={`time-off-${o.id}`}>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{describeOverride(o)}</Text>
          {o.note ? <Text style={[typography.bodySmall, { color: colors.textMuted }]}>{o.note}</Text> : null}
          <Pressable onPress={() => confirmRemove(o)} disabled={remove.isPending || create.isPending} accessibilityRole="button" accessibilityLabel={`Remove ${describeOverride(o)}`} style={[styles.secondary, { borderColor: colors.textPrimary }]} testID={`time-off-remove-${o.id}`}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  label: { ...typography.caption, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, padding: spacing.md, ...typography.body },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  timeRow: { flexDirection: 'row', gap: spacing.md },
  timeCol: { flex: 1 },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, padding: spacing.md, marginTop: spacing.md },
  secondary: { minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
});
