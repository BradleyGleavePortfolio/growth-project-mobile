/**
 * importVerdictContent — the ONE source of truthful verdict text, shared by
 * `ImportRunVerdictCard` (S12-B3) and the Roman P2 presentation (R1). Moved
 * out of `ImportRunVerdictCard.tsx` verbatim (re-exported there unchanged, so
 * its own test file keeps importing from `'../ImportRunVerdictCard'` with no
 * edits) so a second surface can reuse the exact reviewed copy instead of
 * re-deriving or remapping it — R1_REVIEW.md A2/B3/B4: no new reason copy,
 * no lossy remapping, no independently-invented stale/legacy framing.
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
 *     read, never presented as current — for EVERY status, not only `running`.
 */
import { isTerminal, type DecodedRunStatus, type RunPhase, type RunReadStatus, type RunReasonCode } from '../../types/importRunStatus';

export const NOT_KNOWN_YET = 'Not known yet';
/** The server sent a value this app version does not recognise (distinct from "not sent"). */
export const NOT_RECOGNISED = 'Not recognised by this app version';

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

export function formatTime(isoOrMs: string | number): string | null {
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Pure mapping of a decoded reading → the lines a verdict surface renders. */
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
    out.step = phase === null ? NOT_KNOWN_YET : phase === 'unknown' ? NOT_RECOGNISED : PHASE_COPY[phase];
    return out;
  }
  // Legacy rows never carry a reason code (the server did not arbitrate them).
  // A `complete` verdict with no reason code has no reason to show.
  if (!legacy && !(reading.status === 'complete' && reading.reasonCode === null)) {
    const code = reading.reasonCode;
    out.reason =
      code === null
        ? { text: NOT_KNOWN_YET, code: null }
        : code === 'unknown'
          ? { text: NOT_RECOGNISED, code: null }
          : { text: REASON_COPY[code], code };
  }
  out.finishedAt = (reading.completedAt && formatTime(reading.completedAt)) || NOT_KNOWN_YET;
  return out;
}

/**
 * Pure mapping of (stale, readAt) → the exact stale/checked-at line the card
 * shows today, for ANY reading (not only `running`) — R1_REVIEW A1: a
 * terminal kept after a failed refresh is never presented as current.
 * `null` means neither line applies (no reading has ever been read).
 */
export function staleNote(stale: boolean, readAt: number | null): { kind: 'stale' | 'checkedAt'; text: string } | null {
  const checkedAt = readAt ? formatTime(readAt) : null;
  if (stale) return { kind: 'stale', text: `Couldn’t refresh. Showing what the server said${checkedAt ? ` at ${checkedAt}` : ''}.` };
  if (checkedAt) return { kind: 'checkedAt', text: `Last checked ${checkedAt}` };
  return null;
}
