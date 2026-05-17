/**
 * BulkInviteScreen — Email Pipeline v1.
 *
 * Coach-only. Two input modes:
 *   - Paste: multiline text input parsed against any whitespace / comma /
 *     semicolon separator, with invalid entries surfaced inline.
 *   - CSV upload: pick a `.csv` via expo-document-picker, parse the first
 *     column (or an "email" header column if present).
 *
 * Submits to `POST /coach/invite-codes/bulk` (see `src/api/invites.ts`).
 * Renders a per-email status list after the response with affordances to
 * copy the failed list or retry just the failures.
 *
 * Companion to the v1 backend contract — coexists with the legacy
 * CoachBulkInviteScreen (Sprint B v2). The legacy screen is preserved for
 * now; this screen is the v1 successor and will replace it when the
 * legacy parse/submit pair is retired.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import {
  invitesApi,
  isValidEmail,
  MAX_BULK_EMAILS,
  normaliseEmail,
  parseCsvEmails,
  tokeniseEmails,
} from '../../api/invites';
import { bulkInviteApi } from '../../api/bulkInviteApi';
import type { BulkInviteRow } from '../../api/bulkInviteApi';
import type {
  BulkInviteResult,
  BulkInviteResultStatus,
} from '../../types/invites';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';

type InputMode = 'paste' | 'csv';

const MESSAGE_MAX = 500;
const CONFIRM_THRESHOLD = 50;

interface ParsedInput {
  valid: string[];
  invalid: string[];
}

function parsePaste(raw: string): ParsedInput {
  const tokens = tokeniseEmails(raw);
  return splitValid(tokens);
}

function splitValid(tokens: string[]): ParsedInput {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (isValidEmail(t)) {
      const n = normaliseEmail(t);
      if (seen.has(n)) continue;
      seen.add(n);
      valid.push(n);
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}

export default function BulkInviteScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<InputMode>('paste');
  const [paste, setPaste] = useState('');
  const [csvSummary, setCsvSummary] = useState<string | null>(null);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickingCsv, setPickingCsv] = useState(false);
  const [results, setResults] = useState<BulkInviteResult[] | null>(null);

  const parsed: ParsedInput = useMemo(() => {
    if (mode === 'csv') return splitValid(csvEmails);
    return parsePaste(paste);
  }, [mode, paste, csvEmails]);

  const overCap = parsed.valid.length > MAX_BULK_EMAILS;
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
      Alert.alert('Could not read CSV', errorMessage(err, 'Unknown error'));
    } finally {
      setPickingCsv(false);
    }
  }, []);

  const doSubmit = useCallback(async () => {
    if (parsed.valid.length === 0) return;
    setSubmitting(true);
    try {
      const rows: BulkInviteRow[] = parsed.valid.map((email) => ({ email }));
      const res = await bulkInviteApi.submit(rows);
      const data = res.data;
      // Map created + rejected arrays into the BulkInviteResult[] shape
      // expected by the results renderer.
      const mappedResults: BulkInviteResult[] = [
        ...data.created.map((r) => ({
          email: r.email,
          status: 'created' as BulkInviteResultStatus,
          emailQueued: true,
        })),
        ...data.rejected.map((r) => ({
          email: r.email,
          status: 'failed' as BulkInviteResultStatus,
          emailQueued: false,
          error: r.reason,
        })),
      ];
      setResults(mappedResults);
      // Clear the input on a successful send so the coach can start fresh.
      setPaste('');
      setCsvEmails([]);
      setCsvSummary(null);
      setMessage('');
    } catch (err) {
      Alert.alert(
        'Could not send invites',
        errorMessage(err, 'Unknown error'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [parsed.valid, message]);

  const onSubmit = useCallback(() => {
    if (parsed.valid.length === 0) return;
    if (overCap) {
      Alert.alert(
        'Too many emails',
        `Max ${MAX_BULK_EMAILS} per send. Remove ${parsed.valid.length - MAX_BULK_EMAILS} and try again.`,
      );
      return;
    }
    if (messageTooLong) {
      Alert.alert('Message too long', `Max ${MESSAGE_MAX} characters.`);
      return;
    }
    if (parsed.valid.length > CONFIRM_THRESHOLD) {
      Alert.alert(
        `Send ${parsed.valid.length} invites?`,
        'Confirm before queuing the emails. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send', style: 'destructive', onPress: doSubmit },
        ],
      );
      return;
    }
    void doSubmit();
  }, [parsed.valid.length, overCap, messageTooLong, doSubmit]);

  const failed = useMemo(
    () => (results ?? []).filter((r) => r.status === 'failed'),
    [results],
  );

  const onCopyFailed = useCallback(async () => {
    if (failed.length === 0) return;
    await Clipboard.setStringAsync(failed.map((r) => r.email).join('\n'));
    Alert.alert('Copied', `${failed.length} failed emails copied.`);
  }, [failed]);

  const onRetryFailed = useCallback(() => {
    if (failed.length === 0) return;
    setMode('paste');
    setPaste(failed.map((r) => r.email).join('\n'));
    setResults(null);
  }, [failed]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Invite clients by email</Text>
        <Text style={styles.lede}>
          Paste a list of emails or upload a CSV. We email each invitee a
          unique link that opens this app and links them to you.
        </Text>

        {/* Mode picker */}
        <View style={styles.modeRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Paste emails"
            onPress={() => setMode('paste')}
            style={[
              styles.modeBtn,
              mode === 'paste' && styles.modeBtnActive,
            ]}
            testID="bulk-mode-paste"
          >
            <Text
              style={[
                styles.modeBtnText,
                mode === 'paste' && styles.modeBtnTextActive,
              ]}
            >
              Paste
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Upload CSV"
            onPress={() => setMode('csv')}
            style={[
              styles.modeBtn,
              mode === 'csv' && styles.modeBtnActive,
            ]}
            testID="bulk-mode-csv"
          >
            <Text
              style={[
                styles.modeBtnText,
                mode === 'csv' && styles.modeBtnTextActive,
              ]}
            >
              Upload CSV
            </Text>
          </Pressable>
        </View>

        {mode === 'paste' ? (
          <>
            <Text style={styles.label}>Emails</Text>
            <TextInput
              accessibilityLabel="Paste emails"
              value={paste}
              onChangeText={setPaste}
              multiline
              numberOfLines={6}
              placeholder={'alice@example.com\nbob@example.com\n...'}
              placeholderTextColor={colors.textMuted}
              style={styles.paste}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              testID="bulk-paste-input"
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>CSV file</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pick CSV file"
              onPress={onPickCsv}
              disabled={pickingCsv}
              style={styles.uploadBtn}
              testID="bulk-csv-pick"
            >
              {pickingCsv ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.uploadBtnText}>
                  {csvSummary ?? 'Choose .csv file'}
                </Text>
              )}
            </Pressable>
            <Text style={styles.helper}>
              First column or the column named "email" is used. Headers are
              detected automatically.
            </Text>
          </>
        )}

        {/* Parsed summary */}
        {(parsed.valid.length > 0 || parsed.invalid.length > 0) && (
          <View style={styles.summary} testID="bulk-parsed-summary">
            <Text style={styles.summaryHead}>
              {parsed.valid.length} valid
              {parsed.invalid.length > 0
                ? ` · ${parsed.invalid.length} invalid`
                : ''}
              {overCap ? ` · over cap (max ${MAX_BULK_EMAILS})` : ''}
            </Text>
            {parsed.invalid.length > 0 && (
              <View style={styles.invalidList}>
                {parsed.invalid.slice(0, 5).map((e, i) => (
                  <Text key={`${e}-${i}`} style={styles.invalidItem}>
                    {e}
                  </Text>
                ))}
                {parsed.invalid.length > 5 && (
                  <Text style={styles.invalidItem}>
                    +{parsed.invalid.length - 5} more
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Optional message */}
        <Text style={styles.label}>Message (optional)</Text>
        <TextInput
          accessibilityLabel="Optional message"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={3}
          maxLength={MESSAGE_MAX + 50}
          placeholder="Hey — joining me on The Growth Project, here's your invite."
          placeholderTextColor={colors.textMuted}
          style={styles.messageInput}
          testID="bulk-message-input"
        />
        <Text
          style={[
            styles.helper,
            messageTooLong && { color: colors.error },
          ]}
        >
          {message.length}/{MESSAGE_MAX}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send ${parsed.valid.length} invites`}
          onPress={onSubmit}
          disabled={
            submitting || parsed.valid.length === 0 || overCap || messageTooLong
          }
          style={[
            styles.submitBtn,
            (submitting || parsed.valid.length === 0 || overCap) &&
              styles.submitBtnDisabled,
          ]}
          testID="bulk-submit"
        >
          {submitting ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.submitBtnText}>
              Send {parsed.valid.length} invite
              {parsed.valid.length === 1 ? '' : 's'}
            </Text>
          )}
        </Pressable>

        {/* Results */}
        {results && (
          <View style={styles.results} testID="bulk-results">
            <Text style={styles.resultsHead}>Send summary</Text>
            {results.map((r, idx) => (
              <View
                key={`${r.email}-${idx}`}
                style={styles.resultRow}
                testID={`bulk-result-${r.status}`}
              >
                <Text style={styles.resultEmail}>{r.email}</Text>
                <ResultPill status={r.status} />
              </View>
            ))}
            {failed.length > 0 && (
              <View style={styles.failedActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy failed emails"
                  onPress={onCopyFailed}
                  style={styles.secondaryBtn}
                  testID="bulk-copy-failed"
                >
                  <Text style={styles.secondaryBtnText}>Copy failed list</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry failed emails"
                  onPress={onRetryFailed}
                  style={styles.secondaryBtn}
                  testID="bulk-retry-failed"
                >
                  <Text style={styles.secondaryBtnText}>
                    Retry {failed.length}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ResultPill({ status }: { status: BulkInviteResultStatus }) {
  const { colors } = useTheme();
  const label =
    status === 'created' ? 'Sent' : status === 'reused' ? 'Reused' : 'Failed';
  const bg =
    status === 'created'
      ? colors.success
      : status === 'reused'
        ? colors.primary
        : colors.error;
  return (
    <View style={[pillStyles.pill, { backgroundColor: `${bg}22` }]}>
      <Text style={[pillStyles.text, { color: bg }]}>{label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingBottom: 64 },
    title: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
    lede: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 6,
      marginBottom: 16,
      lineHeight: 20,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    modeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    modeBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    modeBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    modeBtnTextActive: { color: colors.textOnPrimary },
    label: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginTop: 12,
      marginBottom: 6,
    },
    paste: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      color: colors.textPrimary,
      minHeight: 140,
      textAlignVertical: 'top',
      backgroundColor: colors.surface,
    },
    uploadBtn: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: 8,
      padding: 16,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    uploadBtnText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    helper: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
    },
    summary: {
      marginTop: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceElevated,
    },
    summaryHead: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    invalidList: { marginTop: 6, gap: 2 },
    invalidItem: { fontSize: 12, color: colors.error },
    messageInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      color: colors.textPrimary,
      minHeight: 70,
      textAlignVertical: 'top',
      backgroundColor: colors.surface,
    },
    submitBtn: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
    },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    results: { marginTop: 24, gap: 8 },
    resultsHead: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    resultEmail: { fontSize: 13, color: colors.textPrimary, flex: 1 },
    failedActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    secondaryBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
  });
}

// Exported for tests.
export const __test = {
  parsePaste,
  splitValid,
  MESSAGE_MAX,
  CONFIRM_THRESHOLD,
};
