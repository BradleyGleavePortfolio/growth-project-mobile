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
import {
  isTerminal,
  type DecodedRunStatus,
  type RosterPersonState,
  type RunPhase,
  type RunReadStatus,
  type RunReasonCode,
} from '../../types/importRunStatus';

export const NOT_KNOWN_YET = 'Not known yet';

/** status (+ mode) → headline + body. Legacy terminals are the extension's report, not a server check. */
export const VERDICT_COPY: Record<RunReadStatus, { title: string; body: string }> = {
  running: { title: 'Import in progress', body: 'The server has not reached a result for this import yet.' },
  complete: { title: 'Import complete', body: 'The server checked this import and marked it complete.' },
  partial: { title: 'Import partly finished', body: 'Some of your data came across, but not all of it.' },
  blocked: { title: 'Import stopped — needs attention', body: 'The server stopped this import before it could finish.' },
  failed: { title: 'Import didn’t finish', body: 'This import ended without bringing your data across.' },
  cancelled: { title: 'Import cancelled', body: 'This import was cancelled before it finished.' },
  timed_out: { title: 'Import stopped — took too long', body: 'This import went past its time limit and was stopped.' },
  success: { title: 'Import finished', body: 'The browser extension reported it finished.' },
};

export const LEGACY_NOTE = 'Reported by the browser extension. The server did not check this result.';

export const UNKNOWN_VERDICT = {
  title: 'Import status not recognised',
  body: 'This version of the app can’t read the status the server sent. Check again later or update the app.',
};

export const PHASE_COPY: Record<RunPhase, string> = {
  discovering: 'Finding your data',
  transferring: 'Copying your data',
  reconciling: 'Checking what was copied',
};

export const REASON_COPY: Record<RunReasonCode, string> = {
  reconciliation_not_performed: 'The copied data hasn’t been checked yet.',
  cancelled_by_coach: 'You cancelled this import.',
  deadline_exceeded: 'The import went past its time limit.',
  transfer_failed: 'Copying data from your previous platform failed.',
  unresolved_family: 'Some kinds of data couldn’t be matched to TGP.',
  revoked: 'Access for this import was withdrawn.',
  unresolved_identities: 'Some people couldn’t be matched to TGP accounts yet.',
  relationship_unverified: 'Links between records couldn’t be checked.',
  coverage_basis_unknown: 'We can’t tell yet whether everything was found.',
};

export const ROSTER_STATE_COPY = (state: RosterPersonState | 'unknown'): string =>
  state === 'InvitePending' ? 'Imported, not yet joined' : 'Imported — joining status not known yet';

function formatTime(isoOrMs: string | number): string | null {
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Pure mapping of a decoded reading → the lines the card renders. Exported for tests. */
export function verdictLines(reading: DecodedRunStatus): {
  title: string;
  body: string;
  success: boolean;
  legacyNote: boolean;
  step?: string;
  reason?: { text: string; code: RunReasonCode | null };
  finishedAt?: string;
} {
  if (reading.status === 'unknown') {
    return { ...UNKNOWN_VERDICT, success: false, legacyNote: false };
  }
  const copy = VERDICT_COPY[reading.status];
  const legacy = reading.mode === 'legacy';
  const out: ReturnType<typeof verdictLines> = {
    title: copy.title,
    body: copy.body,
    success: reading.status === 'complete' && reading.mode === 'server',
    legacyNote: legacy && isTerminal(reading.status),
  };
  if (reading.status === 'running') {
    const phase = reading.phase;
    out.step = phase === null || phase === 'unknown' ? NOT_KNOWN_YET : PHASE_COPY[phase];
    return out;
  }
  // Legacy rows never carry a reason code (the server did not arbitrate them).
  // A `complete` verdict with no reason code has no reason to show.
  if (!legacy && !(reading.status === 'complete' && reading.reasonCode === null)) {
    const code = reading.reasonCode;
    out.reason =
      code === null || code === 'unknown'
        ? { text: NOT_KNOWN_YET, code: null }
        : { text: REASON_COPY[code], code };
  }
  out.finishedAt = (reading.completedAt && formatTime(reading.completedAt)) || NOT_KNOWN_YET;
  return out;
}

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
        <Text style={styles.body}>We couldn’t reach the server to check this import. Check your connection and try again.</Text>
      </>
    );
  } else if (run.view === 'notFound') {
    content = (
      <>
        <Text style={styles.title} testID="verdict-not-found">Import status: {NOT_KNOWN_YET.toLowerCase()}</Text>
        <Text style={styles.body}>
          The server has nothing to show for this import yet. Once the import starts on your computer, its status appears here.
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

function ImportedRosterSection({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
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
            ? `Found ${a.staged}: ${a.reconstructed} imported, ${a.skipped} skipped, ${a.failed} couldn’t be imported.`
            : `Totals: ${NOT_KNOWN_YET.toLowerCase()}.`}
        </Text>
        {roster.persons.length === 0 ? (
          <Text style={styles.body} testID="roster-empty">The server has no imported people to show for this import.</Text>
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
