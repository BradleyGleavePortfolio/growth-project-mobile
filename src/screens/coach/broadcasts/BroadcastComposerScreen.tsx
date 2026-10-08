/**
 * BroadcastComposerScreen — write one message and send it to many clients:
 * all clients, or the clients with a tag, on a package or on a program
 * (GET /coach/broadcasts/segment-options). Send now, schedule it, or repeat it
 * daily / weekly / monthly at a set time. The live count comes from
 * POST /coach/broadcasts/preview; sending is POST /coach/broadcasts with an
 * Idempotency-Key, so a retried tap never sends twice.
 *
 * Each client gets the message in their own coach thread, `{first_name}`
 * replaced with their first name.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation, usePreventRemove, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { broadcastErrorMessage, broadcastsApi, broadcastsOff, type SegmentOptions } from '../../../api/broadcastsApi';
import { spacing, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  BODY_MAX,
  WEEKDAYS_SHORT,
  audienceReady,
  deviceTimeZone,
  describeRepeat,
  formatLocalTime,
  formatWhen,
  newIdempotencyKey,
  recurrenceFor,
  segmentFor,
  toLocalTime,
  type Audience,
  type AudienceKind,
  type RepeatChoice,
  type RepeatKind,
} from './broadcastFormat';
import { broadcastsListKey } from './CoachBroadcastsScreen';

const AUDIENCE_LABELS: Record<AudienceKind, string> = { all: 'All clients', tag: 'Tag', package: 'Package', program: 'Program' };
const REPEAT_LABELS: Record<RepeatKind, string> = { none: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const MAX_LEAD_MS = 365 * 86_400_000;

function optionValues(kind: AudienceKind, o: SegmentOptions | undefined): Array<{ value: string; label: string }> {
  if (!o) return [];
  if (kind === 'tag') return o.tags.map((t) => ({ value: t.tag, label: `${t.tag} (${t.client_count})` }));
  if (kind === 'package') return o.packages.map((p) => ({ value: p.id, label: p.name }));
  if (kind === 'program') return o.programs.map((p) => ({ value: p.id, label: p.name }));
  return [];
}

/** First problem with the form, in plain words, or null when it can be sent. */
export function composerProblem(input: {
  body: string;
  audience: Audience;
  later: boolean;
  sendAt: Date | null;
  repeat: RepeatChoice;
  now: Date;
}): string | null {
  const text = input.body.trim();
  if (text.length === 0) return 'Write the message first.';
  if (text.length > BODY_MAX) return `Shorten the message to ${BODY_MAX} characters or fewer.`;
  if (!audienceReady(input.audience)) return `Pick at least one ${input.audience.kind} for the audience.`;
  if (input.later) {
    if (!input.sendAt) return 'Pick a date and time to send it.';
    if (input.sendAt.getTime() <= input.now.getTime()) return 'Pick a time later than now, or choose Send now.';
    if (input.sendAt.getTime() > input.now.getTime() + MAX_LEAD_MS) return 'Pick a time within the next 12 months.';
  }
  if (input.repeat.kind === 'weekly' && input.repeat.weekdays.length === 0) return 'Pick at least one day of the week.';
  if (input.repeat.kind === 'monthly' && !(input.repeat.monthDay >= 1 && input.repeat.monthDay <= 31)) return 'Pick a day of the month from 1 to 31.';
  return null;
}

export default function BroadcastComposerScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>({ kind: 'all', values: [] });
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState<Date | null>(null);
  const [repeat, setRepeat] = useState<RepeatChoice>({ kind: 'none', localTime: '09:00', weekdays: [new Date().getDay()], monthDay: new Date().getDate() });
  const [picker, setPicker] = useState<'date' | 'time' | 'repeatTime' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const keyRef = useRef(newIdempotencyKey());

  usePreventRemove(body.length > 0 && !sent, ({ data }) => {
    Alert.alert('Discard this message?', 'Leaving removes the text from this message.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Leave only after the successful send has disabled the native-stack guard.
  useEffect(() => {
    if (sent) navigation.goBack();
  }, [sent, navigation]);

  const options = useQuery({ queryKey: ['broadcasts', 'segment-options'], queryFn: () => broadcastsApi.segmentOptions() });
  const segment = useMemo(() => segmentFor(audience), [audience]);
  const ready = audienceReady(audience);
  const preview = useQuery({
    queryKey: ['broadcasts', 'preview', JSON.stringify(segment)],
    queryFn: () => broadcastsApi.preview(segment),
    enabled: ready,
  });

  const recurrence = recurrenceFor(repeat);
  const payloadKey = JSON.stringify([body.trim(), segment, later ? sendAt?.toISOString() : null, recurrence]);
  // A changed message is a new send; a retried identical one reuses the key.
  useEffect(() => {
    keyRef.current = newIdempotencyKey();
  }, [payloadKey]);

  const send = useMutation({
    mutationFn: () =>
      broadcastsApi.create(
        { body: body.trim(), segment, timezone: deviceTimeZone(), send_at: later && sendAt ? sendAt.toISOString() : null, recurrence },
        keyRef.current,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: broadcastsListKey });
      setSent(true);
    },
    onError: (err) => setFormError(broadcastErrorMessage(err, repeat.kind === 'none' && !later ? 'sent' : 'scheduled')),
  });

  const count = preview.data?.recipient_count;
  const who = count === undefined ? 'the selected clients' : count === 1 ? '1 client' : `${count} clients`;

  const onSubmit = () => {
    if (send.isPending) return;
    const problem = composerProblem({ body, audience, later, sendAt, repeat, now: new Date() });
    if (problem) {
      setFormError(problem);
      return;
    }
    if (count === 0) {
      setFormError('No clients match this audience right now. Pick a wider audience.');
      return;
    }
    setFormError(null);
    const title = recurrence
      ? `Repeat this for ${who}?`
      : later && sendAt
        ? `Schedule for ${who}?`
        : `Send to ${who} now?`;
    const detail = recurrence
      ? `${describeRepeat(recurrence)}${later && sendAt ? `, starting ${formatWhen(sendAt.toISOString())}` : ''}. Each client gets it in their own thread.`
      : later && sendAt
        ? `It goes out ${formatWhen(sendAt.toISOString())}. Each client gets it in their own thread.`
        : 'Each client gets it in their own thread now. Clients in their quiet hours get it when those end.';
    Alert.alert(title, detail, [
      { text: 'Not yet', style: 'cancel' },
      { text: recurrence ? 'Start' : later ? 'Schedule' : 'Send', onPress: () => send.mutate() },
    ]);
  };

  const onPick = (_e: DateTimePickerEvent, picked?: Date) => {
    const which = picker;
    setPicker(Platform.OS === 'ios' ? which : null);
    if (!picked) return;
    if (which === 'repeatTime') {
      setRepeat((r) => ({ ...r, localTime: toLocalTime(picked) }));
      return;
    }
    const next = new Date(sendAt ?? Date.now() + 3_600_000);
    if (which === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    setSendAt(next);
  };

  const muted = { color: colors.textMuted };
  const chip = (selected: boolean) => [styles.chip, { borderColor: selected ? colors.textPrimary : colors.border, backgroundColor: selected ? colors.textPrimary : 'transparent' }];
  const chipText = (selected: boolean) => [typography.bodySmall, { color: selected ? colors.background : colors.textPrimary }];

  if (options.isError && broadcastsOff(options.error)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, flex: 1 }]}>
        <Text style={[typography.body, muted]} testID="composer-off">
          Broadcasts are not available on this account yet. One-to-one messages with clients work as usual.
        </Text>
      </View>
    );
  }

  const kinds: AudienceKind[] = ['all', ...(['tag', 'package', 'program'] as const).filter((k) => optionValues(k, options.data).length > 0)];
  const values = optionValues(audience.kind, options.data);
  const [rh, rm] = repeat.localTime.split(':').map(Number);
  const pickerValue = picker === 'repeatTime' ? new Date(2000, 0, 1, rh, rm) : sendAt ?? new Date(Date.now() + 3_600_000);
  // Shown under the control that opened it. Android opens a dialog; iOS shows
  // the picker inline with a Done button.
  const pickerFor = (which: Array<'date' | 'time' | 'repeatTime'>) =>
    picker && which.includes(picker) ? (
      <View>
        <DateTimePicker
          key={picker}
          value={pickerValue}
          mode={picker === 'date' ? 'date' : 'time'}
          display={Platform.OS === 'ios' ? (picker === 'date' ? 'inline' : 'spinner') : 'default'}
          minimumDate={picker === 'date' ? new Date() : undefined}
          onChange={onPick}
          testID="composer-picker"
        />
        {Platform.OS === 'ios' ? (
          <Pressable onPress={() => setPicker(null)} accessibilityRole="button" accessibilityLabel="Done choosing" style={[chip(false), { alignSelf: 'flex-end' }]} testID="composer-picker-done">
            <Text style={chipText(false)}>Done</Text>
          </Pressable>
        ) : null}
      </View>
    ) : null;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" testID="broadcast-composer">
      <Text style={[styles.label, muted]}>Message</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={BODY_MAX}
        placeholder="Gym closed Monday, do the home plan."
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Broadcast message"
        style={[styles.input, styles.body, { color: colors.textPrimary, borderColor: colors.border }]}
        testID="composer-body"
      />
      <Text style={[typography.bodySmall, muted]}>
        {body.length} of {BODY_MAX}. Type {'{first_name}'} to greet each client by first name.
      </Text>

      <Text style={[styles.label, muted]}>Send to</Text>
      <View style={styles.wrap}>
        {kinds.map((k) => (
          <Pressable key={k} onPress={() => setAudience({ kind: k, values: [] })} accessibilityRole="button" accessibilityState={{ selected: audience.kind === k }} accessibilityLabel={`Send to ${AUDIENCE_LABELS[k]}`} style={chip(audience.kind === k)} testID={`composer-audience-${k}`}>
            <Text style={chipText(audience.kind === k)}>{AUDIENCE_LABELS[k]}</Text>
          </Pressable>
        ))}
      </View>
      {options.isLoading ? <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.textMuted} /> : null}
      {options.isError ? (
        <Text style={[typography.bodySmall, muted, { marginTop: spacing.sm }]}>
          {`Tags, packages and programs did not load. ${broadcastErrorMessage(options.error, 'loaded')}`}
        </Text>
      ) : null}
      {audience.kind !== 'all' ? (
        <View style={styles.wrap}>
          {values.map((v) => {
            const on = audience.values.includes(v.value);
            return (
              <Pressable
                key={v.value}
                onPress={() => setAudience((a) => ({ ...a, values: on ? a.values.filter((x) => x !== v.value) : [...a.values, v.value] }))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={v.label}
                style={chip(on)}
                testID={`composer-value-${v.value}`}
              >
                <Text style={chipText(on)}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Text style={[typography.bodySmall, { color: colors.textPrimary, marginTop: spacing.sm }]} accessibilityLiveRegion="polite" testID="composer-count">
        {!ready
          ? 'Pick who gets it.'
          : preview.isLoading
            ? 'Counting clients.'
            : preview.isError
              ? `The client count did not load. ${broadcastErrorMessage(preview.error, 'counted')}`
              : `Goes to ${count ?? 0} of ${preview.data?.roster_size ?? 0} ${preview.data?.roster_size === 1 ? 'client' : 'clients'}.${preview.data?.excluded_blocked_count ? ` ${preview.data.excluded_blocked_count} who blocked messages are left out.` : ''}`}
      </Text>

      <Text style={[styles.label, muted]}>When</Text>
      <View style={styles.wrap}>
        <Pressable onPress={() => setLater(false)} accessibilityRole="button" accessibilityState={{ selected: !later }} accessibilityLabel={repeat.kind === 'none' ? 'Send now' : 'Start now'} style={chip(!later)} testID="composer-now">
          <Text style={chipText(!later)}>{repeat.kind === 'none' ? 'Send now' : 'Start now'}</Text>
        </Pressable>
        <Pressable onPress={() => { setLater(true); if (!sendAt) setSendAt(new Date(Date.now() + 3_600_000)); }} accessibilityRole="button" accessibilityState={{ selected: later }} accessibilityLabel={repeat.kind === 'none' ? 'Schedule for later' : 'Start later'} style={chip(later)} testID="composer-later">
          <Text style={chipText(later)}>{repeat.kind === 'none' ? 'Schedule' : 'Start later'}</Text>
        </Pressable>
      </View>
      {later && sendAt ? (
        <View style={styles.wrap}>
          <Pressable onPress={() => setPicker('date')} accessibilityRole="button" accessibilityLabel={`Date, ${formatWhen(sendAt.toISOString())}`} style={chip(false)} testID="composer-date">
            <Text style={chipText(false)}>{sendAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
          </Pressable>
          <Pressable onPress={() => setPicker('time')} accessibilityRole="button" accessibilityLabel="Time" style={chip(false)} testID="composer-time">
            <Text style={chipText(false)}>{formatLocalTime(toLocalTime(sendAt))}</Text>
          </Pressable>
        </View>
      ) : null}
      {later ? pickerFor(['date', 'time']) : null}

      <Text style={[styles.label, muted]}>Repeat</Text>
      <View style={styles.wrap}>
        {(Object.keys(REPEAT_LABELS) as RepeatKind[]).map((k) => (
          <Pressable key={k} onPress={() => setRepeat((r) => ({ ...r, kind: k }))} accessibilityRole="button" accessibilityState={{ selected: repeat.kind === k }} accessibilityLabel={REPEAT_LABELS[k]} style={chip(repeat.kind === k)} testID={`composer-repeat-${k}`}>
            <Text style={chipText(repeat.kind === k)}>{REPEAT_LABELS[k]}</Text>
          </Pressable>
        ))}
      </View>
      {repeat.kind === 'weekly' ? (
        <View style={styles.wrap}>
          {WEEKDAYS_SHORT.map((d, i) => {
            const on = repeat.weekdays.includes(i);
            return (
              <Pressable key={d} onPress={() => setRepeat((r) => ({ ...r, weekdays: on ? r.weekdays.filter((x) => x !== i) : [...r.weekdays, i] }))} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={d} style={chip(on)} testID={`composer-weekday-${i}`}>
                <Text style={chipText(on)}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {repeat.kind === 'monthly' ? (
        <TextInput
          value={String(repeat.monthDay || '')}
          onChangeText={(t) => setRepeat((r) => ({ ...r, monthDay: Number(t.replace(/\D/g, '')) || 0 }))}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Day of the month"
          style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]}
          testID="composer-month-day"
        />
      ) : null}
      {repeat.kind !== 'none' ? (
        <View>
          <Pressable onPress={() => setPicker('repeatTime')} accessibilityRole="button" accessibilityLabel={`Time of day, ${formatLocalTime(repeat.localTime)}`} style={[chip(false), { alignSelf: 'flex-start', marginTop: spacing.sm }]} testID="composer-repeat-time">
            <Text style={chipText(false)}>{`At ${formatLocalTime(repeat.localTime)}`}</Text>
          </Pressable>
          {pickerFor(['repeatTime'])}
          <Text style={[typography.bodySmall, muted, { marginTop: spacing.xs }]}>
            {recurrence ? `${describeRepeat(recurrence)}, this phone's time zone. Months without that day use their last day.` : null}
          </Text>
        </View>
      ) : null}

      {formError ? (
        <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.lg }]} accessibilityLiveRegion="polite" testID="composer-error">
          {formError}
        </Text>
      ) : null}
      <Pressable
        onPress={onSubmit}
        disabled={send.isPending}
        accessibilityRole="button"
        accessibilityLabel="Review and send broadcast"
        accessibilityState={{ disabled: send.isPending, busy: send.isPending }}
        style={[styles.primary, { backgroundColor: colors.textPrimary, opacity: send.isPending ? 0.6 : 1 }]}
        testID="composer-send"
      >
        <Text style={[typography.bodyMd, { color: colors.background }]}>
          {send.isPending ? 'Sending' : repeat.kind !== 'none' ? 'Start repeating' : later ? 'Schedule' : 'Send now'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  label: { ...typography.caption, marginTop: spacing.xl, marginBottom: spacing.xs },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, padding: spacing.md, marginTop: spacing.sm, ...typography.body },
  body: { minHeight: 120, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
});
