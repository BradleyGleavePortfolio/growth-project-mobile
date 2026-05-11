/**
 * CoachBulkInviteScreen — paste a list of emails (CSV / newline /
 * tab-separated), see a live preview of parsed rows with valid/
 * invalid badges, then submit up to 100 rows in a single batch.
 *
 * Three states:
 *   1. Empty — explainer + paste area.
 *   2. Parsed preview — server-parsed rows with isLikelyEmail badge
 *      per row, a Remove control per invalid row.
 *   3. Submitted — created / rejected summary with a "send again"
 *      affordance for the rejected emails (one tap to re-paste only
 *      the failures into the textarea).
 *
 * Pure paste-then-preview-then-submit flow. The submit endpoint is
 * throttled 5/min on the backend; the screen disables the submit
 * button while the mutation is pending so a double-tap cannot
 * accidentally consume the budget.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  BulkInviteCreated,
  BulkInviteRejected,
  BulkInviteRow,
} from '../../api/bulkInviteApi';
import { isLikelyEmail } from '../../api/bulkInviteApi';
import {
  useBulkInviteParse,
  useBulkInviteSubmit,
} from '../../hooks/useBulkInvite';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function CoachBulkInviteScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const [paste, setPaste] = useState('');
  const [previewRows, setPreviewRows] = useState<BulkInviteRow[]>([]);
  const [lastResult, setLastResult] = useState<{
    created: BulkInviteCreated[];
    rejected: BulkInviteRejected[];
  } | null>(null);

  const parseMut = useBulkInviteParse();
  const submitMut = useBulkInviteSubmit();

  const onPreview = useCallback(() => {
    const text = paste.trim();
    if (!text) {
      setPreviewRows([]);
      return;
    }
    parseMut.mutate(text, {
      onSuccess: (data) => {
        setPreviewRows(data.rows);
      },
      onError: (err) => {
        Alert.alert(
          'Could not parse',
          err instanceof Error ? err.message : 'Unknown error',
        );
      },
    });
  }, [paste, parseMut]);

  const validRows = useMemo(
    () => previewRows.filter((r) => isLikelyEmail(r.email)),
    [previewRows],
  );
  const invalidRows = useMemo(
    () => previewRows.filter((r) => !isLikelyEmail(r.email)),
    [previewRows],
  );

  const onSubmit = useCallback(() => {
    if (validRows.length === 0) return;
    submitMut.mutate(validRows, {
      onSuccess: (data) => {
        setLastResult({ created: data.created, rejected: data.rejected });
        setPreviewRows([]);
        setPaste('');
      },
      onError: (err) => {
        Alert.alert(
          'Could not send invites',
          err instanceof Error ? err.message : 'Unknown error',
        );
      },
    });
  }, [submitMut, validRows]);

  const reuseRejected = useCallback(() => {
    if (!lastResult) return;
    const next = lastResult.rejected.map((r) => r.email).join('\n');
    setPaste(next);
    setLastResult(null);
  }, [lastResult]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.h2, { color: sc.textPrimary }]}>
          Bulk invite
        </Text>
        <Text style={[typography.body, styles.lede, { color: sc.textMuted }]}>
          Paste up to 100 emails below. One per line, or comma / tab separated
          with optional name and note. Preview the parsed rows before sending.
        </Text>

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Paste area
        </Text>
        <TextInput
          accessibilityLabel="Paste emails"
          value={paste}
          onChangeText={setPaste}
          multiline
          numberOfLines={6}
          placeholder={'alice@example.com, Alice\nbob@example.com\n...'}
          placeholderTextColor={sc.textMuted}
          style={styles.paste}
        />

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preview"
            onPress={onPreview}
            disabled={!paste.trim() || parseMut.isPending}
            style={[
              styles.btnSecondary,
              { borderColor: sc.border },
            ]}
          >
            <Text style={[typography.h4, { color: sc.textPrimary }]}>
              {parseMut.isPending ? 'Parsing...' : 'Preview'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send invites"
            onPress={onSubmit}
            disabled={validRows.length === 0 || submitMut.isPending}
            style={[
              styles.btnPrimary,
              {
                backgroundColor:
                  validRows.length === 0 || submitMut.isPending
                    ? sc.border
                    : sc.accent,
              },
            ]}
          >
            <Text style={[typography.h4, { color: sc.bgPrimary }]}>
              {submitMut.isPending
                ? 'Sending...'
                : `Send ${validRows.length} invite${validRows.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>

        {previewRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={[typography.h4, { color: sc.textPrimary }]}>
              Parsed rows ({previewRows.length})
            </Text>
            <Text style={[typography.caption, { color: sc.textMuted }]}>
              {validRows.length} valid, {invalidRows.length} invalid
            </Text>
            <FlatList
              data={previewRows}
              scrollEnabled={false}
              keyExtractor={(r, idx) => `${r.email}-${idx}`}
              renderItem={({ item }) => {
                const valid = isLikelyEmail(item.email);
                return (
                  <View style={[styles.row, { borderColor: sc.border }]}>
                    <View style={styles.rowMain}>
                      <Text style={[typography.body, { color: sc.textPrimary }]}>
                        {item.email}
                      </Text>
                      {item.name ? (
                        <Text style={[typography.caption, { color: sc.textMuted }]}>
                          {item.name}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: valid ? sc.accent : sc.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.caption,
                          { color: valid ? sc.bgPrimary : sc.textMuted },
                        ]}
                      >
                        {valid ? 'valid' : 'invalid'}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        ) : null}

        {lastResult ? (
          <View style={styles.section}>
            <Text style={[typography.h3, { color: sc.textPrimary }]}>
              Send summary
            </Text>
            <Text style={[typography.body, { color: sc.textPrimary }]}>
              Created: {lastResult.created.length}
            </Text>
            <Text style={[typography.body, { color: sc.textPrimary }]}>
              Rejected: {lastResult.rejected.length}
            </Text>
            {lastResult.rejected.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry rejected"
                onPress={reuseRejected}
                style={[styles.retryBtn, { borderColor: sc.border }]}
              >
                <Text style={[typography.h4, { color: sc.textPrimary }]}>
                  Retry {lastResult.rejected.length} rejected
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
    lede: { marginTop: spacing.sm, marginBottom: spacing.lg },
    label: { marginBottom: spacing.xs, marginTop: spacing.sm },
    paste: {
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: 10,
      padding: spacing.md,
      color: sc.textPrimary,
      minHeight: 140,
      textAlignVertical: 'top',
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    btnSecondary: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    btnPrimary: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    section: { marginTop: spacing.xl, gap: spacing.sm },
    row: {
      borderWidth: 1,
      borderRadius: 10,
      padding: spacing.md,
      marginTop: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowMain: { flex: 1 },
    badge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 999,
    },
    retryBtn: {
      borderWidth: 1,
      borderRadius: 10,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      marginTop: spacing.md,
      alignSelf: 'flex-start',
    },
  });
}
