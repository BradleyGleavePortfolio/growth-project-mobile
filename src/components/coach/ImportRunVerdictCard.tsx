/**
 * ImportRunVerdictCard — S12-B3 (M-bind). Shows the coach the SERVER's answer
 * for the paired import: run status, the open phase while it is in progress,
 * and the reason code once it has ended — every line mapped from a server
 * field of GET /api/scout/import/status (see VERDICT_COPY / PHASE_COPY /
 * REASON_COPY below; the full table is in the S12-B3 build report).
 *
 * Honesty rules (mission invariant 6, S12 L141, readiness-panel audit B1):
 *   - Null / absent / unrecognised → "Not known yet". Never 0, never "no".
 *   - The success mark appears ONLY for a server-mode `complete` (written by
 *     the server's reconciliation verdict). Every other terminal — including a
 *     legacy `success`, which is the extension's own report reflected verbatim
 *     — gets the neutral icon.
 *   - `claimed_status` is never shown: it is input to the server's verdict,
 *     not the verdict.
 *   - Phase is shown only while the run is open; the reason only once ended.
 *   - A reading kept after a failed refresh is labelled with the time it was
 *     read, never presented as current.
 *
 * The imported-people list (ImportedRosterSection) mounts only when
 * featureFlags.importReview (EXPO_PUBLIC_FF_IMPORT_REVIEW, default OFF) is on,
 * and only once the run has a recognised terminal.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import type { ThemeColors } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { useImportRunStatus, useImportedRoster } from '../../hooks/useImportRunStatus';
import { isTerminal, type RosterPersonState } from '../../types/importRunStatus';
import {
  LEGACY_NOTE,
  NOT_KNOWN_YET,
  NOT_RECOGNISED,
  PHASE_COPY,
  REASON_COPY,
  UNKNOWN_VERDICT,
  VERDICT_COPY,
  formatTime,
  verdictLines,
} from './importVerdictContent';

// Re-exported unchanged so this file's own test suite (and any other existing
// importer) keeps working with no edits — the content itself now lives in
// importVerdictContent.ts, the one shared source both this card and the
// Roman P2 presentation (R1) read from. See that file for the honesty rules.
export { LEGACY_NOTE, NOT_KNOWN_YET, NOT_RECOGNISED, PHASE_COPY, REASON_COPY, UNKNOWN_VERDICT, VERDICT_COPY, verdictLines };

/** Server person state → row copy. Each recognised state keeps its own wording; only an unrecognised one is "not known". */
const ROSTER_STATE_TEXT: Record<RosterPersonState, string> = {
  InvitePending: 'Imported, not yet joined',
  Invited: 'Imported — marked invited, not yet joined',
  Claimed: 'Imported — marked as joined',
  Suspended: 'Imported — marked suspended',
  Deleted: 'Imported — marked removed',
};
export const ROSTER_STATE_COPY = (state: RosterPersonState | 'unknown'): string =>
  state === 'unknown' ? 'Imported — joining status not known yet' : ROSTER_STATE_TEXT[state];

export default function ImportRunVerdictCard({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const run = useImportRunStatus(importIntentId);
  const settled = run.view === 'reading' && !!run.reading && isTerminal(run.reading.status);

  if (run.view === 'disabled') return null;

  const checkedAt = run.readAt ? formatTime(run.readAt) : null;
  const checkAgain = (
    <TouchableOpacity
      style={styles.secondaryBtn}
      onPress={run.refresh}
      disabled={run.isRefreshing}
      accessibilityRole="button"
      accessibilityLabel="Check import status again"
      testID="verdict-refresh"
    >
      <Text style={styles.secondaryBtnText}>{run.isRefreshing ? 'Checking…' : 'Check again'}</Text>
    </TouchableOpacity>
  );

  let content: React.ReactNode;
  if (run.view === 'loading') {
    content = (
      <View style={styles.row} testID="verdict-loading">
        <ActivityIndicator color={colors.primary} accessibilityLabel="Checking import status" />
        <Text style={styles.body}>Checking import status…</Text>
      </View>
    );
  } else if (run.view === 'error') {
    content = (
      <>
        <Text style={styles.title} testID="verdict-error">Import status: {NOT_KNOWN_YET.toLowerCase()}</Text>
        <Text style={styles.body}>The server could not be reached to check this import. Check your connection and try again.</Text>
      </>
    );
  } else if (run.view === 'notFound') {
    content = (
      <>
        <Text style={styles.title} testID="verdict-not-found">Import status: {NOT_KNOWN_YET.toLowerCase()}</Text>
        <Text style={styles.body}>
          The server didn’t return a status for this import. Check again later.
        </Text>
      </>
    );
  } else if (run.view === 'unreadable' || !run.reading) {
    content = (
      <>
        <Text style={styles.title} testID="verdict-unknown">{UNKNOWN_VERDICT.title}</Text>
        <Text style={styles.body}>{UNKNOWN_VERDICT.body}</Text>
      </>
    );
  } else {
    const lines = verdictLines(run.reading);
    content = (
      <>
        <View style={styles.row}>
          <Ionicons
            name={lines.success ? 'checkmark-circle-outline' : 'ellipse-outline'}
            size={20}
            color={lines.success ? colors.primary : colors.textMuted}
            testID={lines.success ? 'verdict-icon-success' : 'verdict-icon-neutral'}
          />
          <Text style={styles.title} testID="verdict-title">{lines.title}</Text>
        </View>
        <Text style={styles.body} testID="verdict-body">{lines.body}</Text>
        {lines.legacyNote ? <Text style={styles.muted} testID="verdict-legacy-note">{LEGACY_NOTE}</Text> : null}
        {lines.step !== undefined ? (
          <Fact styles={styles} label="Current step" value={lines.step} testID="verdict-step" />
        ) : null}
        {lines.reason ? (
          <>
            <Fact styles={styles} label="Reason" value={lines.reason.text} testID="verdict-reason" />
            {lines.reason.code ? (
              <Text style={styles.muted} testID="verdict-reason-code">Reason code: {lines.reason.code}</Text>
            ) : null}
          </>
        ) : null}
        {lines.finishedAt !== undefined ? (
          <Fact styles={styles} label="Ended" value={lines.finishedAt} testID="verdict-finished-at" />
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.card} accessibilityLiveRegion="polite" testID="import-verdict">
      <Text style={styles.label}>Import status</Text>
      {content}
      {run.stale ? (
        <Text style={styles.muted} testID="verdict-stale">
          Couldn’t refresh. Showing what the server said{checkedAt ? ` at ${checkedAt}` : ''}.
        </Text>
      ) : checkedAt ? (
        <Text style={styles.muted} testID="verdict-checked-at">Last checked {checkedAt}</Text>
      ) : null}
      {checkAgain}
      {featureFlags.importReview && settled ? <ImportedRosterSection importIntentId={importIntentId} /> : null}
    </View>
  );
}

// Exported (unchanged) so the Roman P2 presentation (R1) can mount the same
// gated detail section under its single status surface, per R1_REVIEW.md B5
// — not a separate reimplementation, the identical component and gate.
export function ImportedRosterSection({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const roster = useImportedRoster(importIntentId, true);
  if (roster.view === 'disabled') return null;

  let content: React.ReactNode;
  if (roster.view === 'loading') {
    content = <Text style={styles.body} testID="roster-loading">Loading imported people…</Text>;
  } else if (roster.view === 'page') {
    const a = roster.accounting;
    content = (
      <>
        <Text style={styles.body} testID="roster-bridge-note">
          {roster.rosterBridgePending === true
            ? 'These people were imported but haven’t joined TGP yet, so they aren’t in your client list.'
            : `Whether these people have joined TGP: ${NOT_KNOWN_YET.toLowerCase()}.`}
        </Text>
        <Text style={styles.muted} testID="roster-accounting">
          {a
            ? `Client records sorted into your roster: ${a.staged} (${a.reconstructed} imported, ${a.skipped} skipped, ${a.failed} couldn’t be imported). This count covers client records only.`
            : `Totals: ${NOT_KNOWN_YET.toLowerCase()}.`}
        </Text>
        {a ? (
          <Text style={styles.muted} testID="roster-unclassified">
            {a.unclassified === null
              ? `Records that couldn’t be sorted into any kind of data: ${NOT_KNOWN_YET.toLowerCase()}.`
              : `Records that couldn’t be sorted into any kind of data: ${a.unclassified}. They aren’t counted above.`}
          </Text>
        ) : null}
        {roster.persons.length === 0 ? (
          roster.hasMore || roster.incomplete ? (
            // Pages are cut from server ledger rows before removed people are
            // filtered out, so an empty page says nothing about the whole import.
            <Text style={styles.body} testID="roster-empty-page">
              No people on the pages loaded so far.{roster.hasMore ? ' Show more to keep looking.' : ''}
            </Text>
          ) : (
            <Text style={styles.body} testID="roster-empty">The server has no imported people to show for this import.</Text>
          )
        ) : (
          roster.persons.map((p) => (
            <View key={p.id} style={styles.personRow} testID={`roster-person-${p.id}`}>
              <Text style={styles.personName}>{p.displayName ?? 'Name not provided'}</Text>
              <Text style={styles.muted}>{ROSTER_STATE_COPY(p.state)}</Text>
            </View>
          ))
        )}
        {roster.incomplete ? (
          <Text style={styles.muted} testID="roster-incomplete">Couldn’t load everything. The list above may be incomplete.</Text>
        ) : null}
        {roster.hasMore ? (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={roster.fetchMore}
            disabled={roster.isFetchingMore}
            accessibilityRole="button"
            accessibilityLabel="Show more imported people"
            testID="roster-more"
          >
            <Text style={styles.secondaryBtnText}>{roster.isFetchingMore ? 'Loading…' : 'Show more'}</Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  } else {
    // notFound / unreadable / error: the list is not known, never "none".
    content = (
      <Text style={styles.body} testID={`roster-${roster.view}`}>
        Imported people: {NOT_KNOWN_YET.toLowerCase()}.
      </Text>
    );
  }
  return (
    <View style={styles.section} testID="import-roster">
      <Text style={styles.label}>Imported people</Text>
      {content}
    </View>
  );
}

function Fact({
  styles,
  label,
  value,
  testID,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  value: string;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      gap: 8,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    section: {
      gap: 8,
      paddingTop: 12,
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    muted: { fontSize: 13, color: colors.textMuted },
    factLabel: { fontSize: 14, color: colors.textPrimary },
    factValue: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
    personRow: { gap: 2, paddingVertical: 4 },
    personName: { fontSize: 14, color: colors.textPrimary },
    secondaryBtn: { paddingVertical: 12, alignItems: 'center', minHeight: 44 },
    secondaryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  });
}
