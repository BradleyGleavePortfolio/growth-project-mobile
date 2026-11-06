/**
 * BulkInviteScreen: the coach's one way to invite clients by email
 * (INVITE-ONE-M; the old paste screen CoachBulkInvite is retired into it).
 *
 * Two input modes:
 *   - Paste: one invite per line, the email then an optional name and note
 *     after a comma or tab (parseInviteLines); a line of emails alone is a list.
 *   - CSV upload: pick a `.csv` via expo-document-picker, parse the first
 *     column (or an "email" header column if present).
 *
 * Every row is previewed (email, name, note, valid or invalid) before
 * sending. Submits to `POST /coach/invite-codes/bulk` with each row's name
 * and note (see `src/api/invites.ts`), then lists each email's result with
 * a copy of the failed list and a retry that puts the failed rows back,
 * names and notes included. Style C (C7 C_create, the nearest drawing).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import {
  invitesApi,
  isValidEmail,
  MAX_BULK_EMAILS,
  normaliseEmail,
  parseCsvEmails,
  parseInviteLines,
  type PastedInvite,
} from '../../api/invites';
import type {
  BulkInviteResult,
  BulkInviteResultStatus,
} from '../../types/invites';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import { Screen } from '../../ui/layout/Screen';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { Chips, Masthead, Notice } from './meals/mealUi';
import { errorMessage } from '../../types/common';

type InputMode = 'paste' | 'csv';

const MESSAGE_MAX = 500;
const CONFIRM_THRESHOLD = 50;
/** The server's limits on one row (BulkInviteRowDto). */
const NAME_MAX = 120;
const NOTE_MAX = 500;
/** Rows drawn in the preview; the rest are counted. */
const PREVIEW_MAX = MAX_BULK_EMAILS;

interface PreviewRow extends PastedInvite {
  valid: boolean;
}

interface ParsedInput {
  rows: PreviewRow[];
  valid: PastedInvite[];
  invalidCount: number;
}

/**
 * Sanitize a row for display: strip control chars and shorten to a hard
 * cap. React Native `Text` is not HTML, but we still don't want to surface
 * raw control characters or 10kB pasted blobs in the preview list.
 */
function sanitizeForDisplay(raw: string, max = 120): string {
  let out = '';
  for (let i = 0; i < raw.length && out.length < max; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) continue;
    out += raw[i];
  }
  return out;
}

/** Validate and dedupe (first email wins), keeping every row for the preview. */
function splitValid(invites: PastedInvite[]): ParsedInput {
  const rows: PreviewRow[] = [];
  const valid: PastedInvite[] = [];
  const seen = new Set<string>();
  for (const invite of invites) {
    const ok =
      isValidEmail(invite.email) &&
      (invite.name?.length ?? 0) <= NAME_MAX &&
      (invite.note?.length ?? 0) <= NOTE_MAX;
    if (ok) {
      const email = normaliseEmail(invite.email);
      if (seen.has(email)) continue;
      seen.add(email);
      const row = { ...invite, email };
      valid.push(row);
      rows.push({ ...row, valid: true });
    } else {
      rows.push({
        email: sanitizeForDisplay(invite.email),
        name: invite.name && sanitizeForDisplay(invite.name),
        note: invite.note && sanitizeForDisplay(invite.note),
        valid: false,
      });
    }
  }
  return { rows, valid, invalidCount: rows.length - valid.length };
}

function parsePaste(raw: string): ParsedInput {
  return splitValid(parseInviteLines(raw));
}

/** A row back as a pasted line, so a retry keeps its name and note. */
function toLine({ email, name, note }: PastedInvite): string {
  if (note) return `${email}, ${name ?? ''}, ${note}`;
  return name ? `${email}, ${name}` : email;
}

export default function BulkInviteScreen() {
  const { semanticColors: sc, colors } = useTheme();
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);

  const [mode, setMode] = useState<InputMode>('paste');
  const [paste, setPaste] = useState('');
  const [csvSummary, setCsvSummary] = useState<string | null>(null);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [pickingCsv, setPickingCsv] = useState(false);
  const [results, setResults] = useState<BulkInviteResult[] | null>(null);
  const [lastSend, setLastSend] = useState<{ rows: PastedInvite[]; message: string } | null>(null);

  const parsed: ParsedInput = useMemo(() => {
    if (mode === 'csv') return splitValid(csvEmails.map((email) => ({ email })));
    return parsePaste(paste);
  }, [mode, paste, csvEmails]);

  const validCount = parsed.valid.length;
  const overCap = validCount > MAX_BULK_EMAILS;
  const messageTooLong = message.length > MESSAGE_MAX;

  const onPickCsv = useCallback(async () => {
    setPickingCsv(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const response = await fetch(asset.uri);
      const text = await response.text();
      const emails = parseCsvEmails(text);
      setCsvEmails(emails);
      setCsvSummary(`${asset.name ?? 'CSV'} — ${emails.length} rows`);
    } catch (err) {
      console.error('BulkInviteScreen: CSV import failed', errorMessage(err));
      Alert.alert(
        'Could not read CSV',
        'That file could not be read. Pick a .csv file and try again.',
      );
    } finally {
      setPickingCsv(false);
    }
  }, []);

  const doSubmit = useCallback(async () => {
    if (parsed.valid.length === 0) return;
    const sent = { rows: parsed.valid, message: message.trim() };
    setSubmitting(true);
    setSendFailed(false);
    try {
      const res = await invitesApi.bulkInvite(sent.rows, sent.message || undefined);
      void HapticService.success();
      setLastSend(sent);
      setResults(res.results);
      // Clear the input on a successful send so the coach can start fresh.
      setPaste('');
      setCsvEmails([]);
      setCsvSummary(null);
      setMessage('');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (err) {
      console.error('BulkInviteScreen: bulk send failed', errorMessage(err));
      void HapticService.error();
      setSendFailed(true);
    } finally {
      setSubmitting(false);
    }
  }, [parsed.valid, message]);

  const onSubmit = useCallback(() => {
    if (validCount === 0) return;
    if (overCap) {
      Alert.alert(
        'Too many emails',
        `Max ${MAX_BULK_EMAILS} per send. Remove ${validCount - MAX_BULK_EMAILS} and try again.`,
      );
      return;
    }
    if (messageTooLong) {
      Alert.alert('Message too long', `Max ${MESSAGE_MAX} characters.`);
      return;
    }
    if (validCount > CONFIRM_THRESHOLD) {
      Alert.alert(
        `Send ${validCount} invites?`,
        'Confirm before queuing the emails. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send', style: 'destructive', onPress: doSubmit },
        ],
      );
      return;
    }
    void doSubmit();
  }, [validCount, overCap, messageTooLong, doSubmit]);

  const failed = useMemo(
    () => (results ?? []).filter((r) => r.status === 'failed'),
    [results],
  );
  const sentRow = useMemo(
    () => new Map((lastSend?.rows ?? []).map((r) => [r.email, r])),
    [lastSend],
  );

  const onCopyFailed = useCallback(async () => {
    if (failed.length === 0) return;
    await Clipboard.setStringAsync(failed.map((r) => r.email).join('\n'));
    Alert.alert('Copied', `${failed.length} failed emails copied.`);
  }, [failed]);

  const onRetryFailed = useCallback(() => {
    if (failed.length === 0) return;
    setMode('paste');
    setPaste(failed.map((r) => toLine(sentRow.get(r.email) ?? { email: r.email })).join('\n'));
    setMessage(lastSend?.message ?? '');
    setResults(null);
  }, [failed, sentRow, lastSend]);

  const onMode = useCallback((next: InputMode) => {
    setMode(next);
    setSendFailed(false);
  }, []);

  const field = [styles.field, { borderColor: sc.border, backgroundColor: sc.bgSurface, color: sc.textPrimary }];
  const card = [styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface }];
  const label = [typography.eyebrow, styles.label, { color: sc.textMuted }];
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  const shown = parsed.rows.slice(0, PREVIEW_MAX);

  return (
    <Screen
      edges={[]}
      scrollRef={scrollRef}
      contentStyle={styles.content}
      footer={
        <PrimaryButton
          label={`Send ${validCount} invite${validCount === 1 ? '' : 's'}`}
          accessibilityLabel={`Send ${validCount} invites`}
          onPress={onSubmit}
          loading={submitting}
          disabled={validCount === 0 || overCap || messageTooLong}
          testID="bulk-submit"
        />
      }
    >
      <Masthead
        title="Invite clients by email"
        sub="Paste a list of emails or upload a CSV. Each invitee gets an email with a unique link that opens this app and links them to you."
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      >
        <Chips<InputMode>
          label="Invite clients by email"
          items={[['paste', 'Paste'], ['csv', 'Upload CSV']]}
          value={mode}
          onChange={onMode}
        />
      </Masthead>

      {results ? (
        <View style={card} testID="bulk-results">
          <Text accessibilityRole="header" style={[typography.h2, { color: sc.textPrimary }]}>Send summary</Text>
          {results.map((r, idx) => {
            const name = sentRow.get(r.email)?.name;
            return (
              <View
                key={`${r.email}-${idx}`}
                style={[styles.row, idx > 0 && styles.rowLine, { borderColor: sc.border }]}
                testID={`bulk-result-${r.status}`}
              >
                <View style={styles.rowMain}>
                  <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{r.email}</Text>
                  {name ? <Text style={muted}>{name}</Text> : null}
                </View>
                <ResultPill status={r.status} />
              </View>
            );
          })}
          {failed.length > 0 && (
            <View style={styles.failedActions}>
              <OutlineButton label="Copy failed list" a11y="Copy failed emails" onPress={onCopyFailed} testID="bulk-copy-failed" />
              <OutlineButton label={`Retry ${failed.length}`} a11y="Retry failed emails" onPress={onRetryFailed} testID="bulk-retry-failed" />
            </View>
          )}
        </View>
      ) : null}

      {mode === 'paste' ? (
        <View>
          <Text style={label}>Emails</Text>
          <TextInput
            accessibilityLabel="Paste emails"
            value={paste}
            onChangeText={(t) => { setPaste(t); setSendFailed(false); }}
            multiline
            numberOfLines={6}
            placeholder={'alice@example.com, Alice\nbob@example.com\n...'}
            placeholderTextColor={sc.textMuted}
            style={[field, styles.paste]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="bulk-paste-input"
          />
          <Text style={[muted, styles.helper]}>
            One per line, or comma / tab separated with optional name and note.
          </Text>
        </View>
      ) : (
        <View>
          <Text style={label}>CSV file</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pick CSV file"
            onPress={onPickCsv}
            disabled={pickingCsv}
            style={({ pressed }) => [field, styles.upload, pressed && styles.pressed]}
            testID="bulk-csv-pick"
          >
            {pickingCsv ? (
              <ActivityIndicator color={sc.accent} />
            ) : (
              <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
                {csvSummary ?? 'Choose .csv file'}
              </Text>
            )}
          </Pressable>
          <Text style={[muted, styles.helper]}>
            First column or the column named "email" is used. Headers are
            detected automatically.
          </Text>
        </View>
      )}

      {parsed.rows.length > 0 && (
        <View style={card} testID="bulk-parsed-summary">
          <Text accessibilityRole="header" style={[typography.h2, { color: sc.textPrimary }]}>
            Parsed rows ({parsed.rows.length})
          </Text>
          <Text style={[typography.bodySmall, { color: overCap || parsed.invalidCount > 0 ? colors.error : sc.textMuted }]}>
            {validCount} valid
            {parsed.invalidCount > 0 ? ` · ${parsed.invalidCount} invalid` : ''}
            {overCap ? ` · over cap (max ${MAX_BULK_EMAILS})` : ''}
          </Text>
          {shown.map((r, idx) => (
            <View
              key={`${r.email}-${idx}`}
              style={[styles.row, idx > 0 && styles.rowLine, { borderColor: sc.border }]}
              testID={r.valid ? 'bulk-row-valid' : 'bulk-row-invalid'}
            >
              <View style={styles.rowMain}>
                <Text style={[typography.bodyMd, { color: r.valid ? sc.textPrimary : colors.error }]}>{r.email}</Text>
                {r.name ? <Text style={muted}>{r.name}</Text> : null}
                {r.note ? <Text style={muted}>{r.note}</Text> : null}
              </View>
              <Text
                style={[
                  typography.caption,
                  styles.badge,
                  r.valid
                    ? { color: sc.textOnAccent, backgroundColor: sc.accent }
                    : { color: colors.error, borderColor: colors.error, borderWidth: 1 },
                ]}
              >
                {r.valid ? 'valid' : 'invalid'}
              </Text>
            </View>
          ))}
          {parsed.rows.length > PREVIEW_MAX && (
            <Text style={muted}>+{parsed.rows.length - PREVIEW_MAX} more</Text>
          )}
        </View>
      )}

      <View>
        <Text style={label}>Message (optional)</Text>
        <TextInput
          accessibilityLabel="Optional message"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={3}
          maxLength={MESSAGE_MAX + 50}
          placeholder="Hey — joining me on TGP Fitness, here's your invite."
          placeholderTextColor={sc.textMuted}
          style={[field, styles.message]}
          testID="bulk-message-input"
        />
        <Text style={[muted, styles.helper, messageTooLong && { color: colors.error }]}>
          {message.length}/{MESSAGE_MAX}
        </Text>
      </View>

      {sendFailed ? (
        <View testID="bulk-send-failed" accessibilityLiveRegion="polite">
          <Notice icon="cloud-offline-outline">
            Could not send invites. Your email list is still here. Check your connection and try sending the invites again.
          </Notice>
        </View>
      ) : null}
    </Screen>
  );
}

function OutlineButton({ label, a11y, onPress, testID }: { label: string; a11y: string; onPress: () => void; testID: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.outline, { borderColor: sc.accent }, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={[typography.bodyMd, { color: sc.accentText }]}>{label}</Text>
    </Pressable>
  );
}

function ResultPill({ status }: { status: BulkInviteResultStatus }) {
  const { semanticColors: sc, colors } = useTheme();
  const label =
    status === 'created' ? 'Sent' : status === 'reused' ? 'Reused' : 'Failed';
  const icon = status === 'failed' ? 'alert-circle-outline' : 'checkmark-circle-outline';
  const ink = status === 'failed' ? colors.error : sc.accentText;
  return (
    <View style={styles.pill}>
      <Ionicons name={icon} size={16} color={ink} />
      <Text style={[typography.caption, { color: ink }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  label: { marginBottom: 8 },
  field: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...typography.body,
  },
  paste: { minHeight: 150, textAlignVertical: 'top' },
  message: { minHeight: 90, textAlignVertical: 'top' },
  upload: { minHeight: layout.buttonHeight, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  helper: { marginTop: 6 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: 20, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, gap: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.chip, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  failedActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  outline: {
    flex: 1,
    minHeight: layout.touchMin + 4,
    borderWidth: 1,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pressed: { opacity: 0.6 },
});

// Exported for tests.
export const __test = {
  parsePaste,
  splitValid,
  toLine,
  MESSAGE_MAX,
  CONFIRM_THRESHOLD,
};
