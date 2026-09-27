/**
 * ImportRunStatusJourney — R1 (Roman status binding), rewritten per
 * R1_REVIEW.md (NO-GO). Mounts the Roman P2 progress/result presentation
 * where `ImportRunVerdictCard` mounted today, over the SAME
 * `useImportRunStatus` read (S12-B3), but instead of re-deriving or
 * remapping the card's copy into the P2 result-view props (which lost facts:
 * A1 stale terminals, A2 reason causes, B3 rendered parity, B4 legacy
 * framing, B5 the roster section), this component reuses the card's own
 * pure content (`verdictLines`, `staleNote`, `LEGACY_NOTE`, `UNKNOWN_VERDICT`
 * from `./importVerdictContent`, the ONE shared source also used by
 * `ImportRunVerdictCard.tsx`) and renders it through the Roman shell
 * (`ImportStatusFrame`, Roman on/off portrait) instead of the card's own
 * `View`. No content is re-derived; only the presentation differs.
 *
 * Terminal/unavailable states (this component, direct text):
 *   - loading / error / notFound / unreadable: the card's own copy for each,
 *     verbatim.
 *   - reading, terminal or unknown: `verdictLines(reading)` — title, body,
 *     legacy note, reason (all 9 codes, exact text), finishedAt (server
 *     `completedAt`, never hook `readAt`).
 *   - EVERY branch above additionally shows `staleNote(run.stale, run.readAt)`
 *     — "Couldn't refresh. Showing what the server said…" for ANY stale
 *     reading, terminal or not (R1_REVIEW A1), or "Last checked …" when
 *     fresh, exactly as the card does.
 *   - The existing manual refresh (`run.refresh` / `run.isRefreshing`) is
 *     preserved as a "Check again" action — the same capability the card
 *     already had, not new wiring.
 *   - `ImportedRosterSection` (unchanged, from `./ImportRunVerdictCard`)
 *     mounts under the same `featureFlags.importReview` gate once the run is
 *     terminal — the identical gated detail section, not a reimplementation
 *     (R1_REVIEW B5).
 *
 * Running state: still `ImportProgressView` (P2) — per review, it already
 * shows phase and staleness honestly (current only with a resolved phase and
 * not stale; otherwise the honest stale/unavailable presentation). The same
 * manual refresh is now wired there too as `checkResultAction`.
 *
 * Roman on/off: both render the identical facts above; only the portrait and,
 * for a server `complete`, the first-person vs neutral completion voice
 * differ — matching every other Roman surface's convention
 * (`featureFlags.romanChat`).
 *
 * No Start/retry/stop wiring beyond what already existed (refresh is the
 * hook's pre-existing capability), no new polling or timers beyond the
 * hook's own (20s foreground refresh, unchanged), no P1 copy changes.
 */
import React from 'react';
import { View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../../config/featureFlags';
import { useImportRunStatus } from '../../hooks/useImportRunStatus';
import { isTerminal, type RunPhase } from '../../types/importRunStatus';
import { LEGACY_NOTE, NOT_KNOWN_YET, UNKNOWN_VERDICT, staleNote, verdictLines } from './importVerdictContent';
import { ImportedRosterSection } from './ImportRunVerdictCard';
import { ImportProgressView, type ImportProgressPhase } from '../../screens/coach/import-journey/ImportProgressView';
import { ImportJourneyAction, ui } from '../../screens/coach/import-journey/importJourneyUI';
import { ImportStatusFrame, ImportStatusText } from '../../screens/coach/import-journey/ImportStatusFrame';

/** `ImportProgressView` only recognises these three; an unrecognised server phase renders as "not known", never a guess. */
const PHASE_MAP: Record<RunPhase, ImportProgressPhase> = { discovering: 'finding', transferring: 'transferring', reconciling: 'checking' };

export default function ImportRunStatusJourney({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const run = useImportRunStatus(importIntentId);
  const onReturnToCoaching = () => navigation.goBack();
  const romanEnabled = featureFlags.romanChat;

  if (run.view === 'disabled') return null;

  const refreshAction = { enabled: true, onPress: run.refresh };
  const stale = staleNote(run.stale, run.readAt);
  const settled = run.view === 'reading' && !!run.reading && isTerminal(run.reading.status);
  const roster = settled ? <ImportedRosterSection importIntentId={importIntentId} /> : null;

  if (run.view === 'reading' && run.reading && run.reading.status === 'running') {
    const phase = run.reading.phase && run.reading.phase !== 'unknown' ? PHASE_MAP[run.reading.phase] : undefined;
    const observation: React.ComponentProps<typeof ImportProgressView>['observation'] =
      !run.stale && phase ? { freshness: 'current', phase } : { freshness: 'stale', ...(phase ? { lastObservedPhase: phase } : {}) };
    return (
      <ImportProgressView
        romanEnabled={romanEnabled}
        observation={observation}
        stop="notRequested"
        sourceCoverage="unknown"
        onReturnToCoaching={onReturnToCoaching}
        checkResultAction={refreshAction}
      />
    );
  }

  let title: string;
  let body: string | undefined;
  let extra: React.ReactNode = null;
  if (run.view === 'loading') {
    title = 'Checking import status…';
  } else if (run.view === 'error') {
    title = `Import status: ${NOT_KNOWN_YET.toLowerCase()}`;
    body = 'We couldn’t reach the server to check this import. Check your connection and try again.';
  } else if (run.view === 'notFound') {
    title = `Import status: ${NOT_KNOWN_YET.toLowerCase()}`;
    body = 'The server didn’t return a status for this import. Check again later.';
  } else if (run.view === 'unreadable' || !run.reading) {
    title = UNKNOWN_VERDICT.title;
    body = UNKNOWN_VERDICT.body;
  } else {
    const lines = verdictLines(run.reading);
    title = lines.title;
    body = lines.body;
    extra = (
      <>
        {lines.legacyNote ? <ImportStatusText secondary>{LEGACY_NOTE}</ImportStatusText> : null}
        {lines.step !== undefined ? <ImportStatusText>Current step: {lines.step}</ImportStatusText> : null}
        {lines.reason ? <ImportStatusText>Reason: {lines.reason.text}</ImportStatusText> : null}
        {lines.finishedAt !== undefined ? <ImportStatusText>Ended: {lines.finishedAt}</ImportStatusText> : null}
      </>
    );
  }

  return (
    <ImportStatusFrame title={title} navigationTitle="Import status" romanEnabled={romanEnabled} onReturnToCoaching={onReturnToCoaching}>
      <View style={ui.actions}>
        {body ? <ImportStatusText>{body}</ImportStatusText> : null}
        {extra}
        {stale ? <ImportStatusText secondary>{stale.text}</ImportStatusText> : null}
      </View>
      <View style={ui.actions}>
        <ImportJourneyAction label={run.isRefreshing ? 'Checking…' : 'Check again'} onPress={run.refresh} disabled={run.isRefreshing} />
        <ImportJourneyAction label="Return to coaching" onPress={onReturnToCoaching} />
      </View>
      {roster}
    </ImportStatusFrame>
  );
}
