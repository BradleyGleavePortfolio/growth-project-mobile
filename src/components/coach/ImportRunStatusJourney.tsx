/**
 * ImportRunStatusJourney — R1 (Roman status binding), rewritten per
 * R1_REVIEW.md (NO-GO) and closed further per R300-A (REQUEST CHANGES,
 * B1-B4). Mounts the Roman P2 presentation where `ImportRunVerdictCard`
 * mounted today, over the SAME `useImportRunStatus` read (S12-B3), reusing
 * the card's own pure content (`verdictLines`, `staleNote`, `LEGACY_NOTE`,
 * `UNKNOWN_VERDICT` from `./importVerdictContent`, the ONE shared source also
 * used by `ImportRunVerdictCard.tsx`). No content is re-derived; only the
 * presentation differs, and the server's status remains the only authority
 * — this component never derives `complete`/success itself.
 *
 * B3 (R300-A): this call site is INLINE inside `ExtensionPairingPanel`, which
 * itself lives inside `ImportDataScreen`'s own ScrollView. Mounting the
 * full-screen P2 shell (`ImportStatusFrame`'s ScrollView, or `ImportProgressView`
 * wholesale) here nested a same-direction ScrollView with a screen-level
 * Back/Return control inside an inline section — exactly the layout
 * `ImportDataScreen` explicitly rejects for its other P2 donor
 * (`ImportSetupView`: "nesting it inside this screen's own ScrollView would
 * be an invalid nested-scroll layout"). This component now composes
 * `ImportInlineStatusFrame` (non-scrolling, no Back/Return — the host screen
 * already owns navigation) for every branch. `ImportStatusFrame` and
 * `ImportProgressView`/`ImportResultView` themselves are UNCHANGED and still
 * available for standalone/full-screen use elsewhere.
 *
 * Terminal/unavailable states (this component, direct text):
 *   - loading / error / notFound / unreadable: the card's own copy for each,
 *     verbatim.
 *   - reading, terminal or unknown: `verdictLines(reading)` — title, body,
 *     legacy note, reason (all 9 codes, exact text), finishedAt (server
 *     `completedAt`, never hook `readAt`).
 *   - B4 (R300-A): a `complete` server verdict additionally shows the
 *     established P2 result catalog's distinct Roman-on/off completion voice
 *     (`result.complete.roman` / `result.complete.neutral` — the SAME two
 *     strings `ImportResultView` shows for its own `complete` outcome) below
 *     the server's own exact title/body — never replacing them, never
 *     inventing a native-records count the server did not send.
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
 * Running state: the same phase/staleness honesty `ImportProgressView`
 * embodies (current only with a resolved phase and not stale; otherwise the
 * honest stale/unavailable presentation), composed inline rather than
 * mounting that view's own screen chrome (B3).
 *   - B1 (R300-A): the manual "Check current result" action is available for
 *     EVERY running reading, INCLUDING a current recognised phase — a coach
 *     watching a seemingly stationary import must still be able to ask the
 *     server directly. It was previously mounted only for `!current` here.
 *
 * B2 (R300-A): `announcement` is composed from status + freshness + reason
 * (never timestamps or counts), so a screen-reader user is told when a
 * retained terminal verdict goes stale, or when its reason changes, even
 * though the title text stays the same ("Import complete" etc.) — the one
 * shared `ImportInlineStatusFrame`/`ImportStatusFrame` announcement hook only
 * re-announces on iOS when this string actually changes; Android's existing
 * `accessibilityLiveRegion="polite"` on the whole inline card (matching the
 * retired card's own top-level live region) covers the same material change.
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
import { featureFlags } from '../../config/featureFlags';
import { useImportRunStatus } from '../../hooks/useImportRunStatus';
import { isTerminal, type RunPhase } from '../../types/importRunStatus';
import { LEGACY_NOTE, NOT_KNOWN_YET, UNKNOWN_VERDICT, staleNote, verdictLines } from './importVerdictContent';
import { ImportedRosterSection } from './ImportRunVerdictCard';
import { importJourneyCopy as t } from '../../screens/coach/import-journey/importJourneyCopy';
import { ImportJourneyAction, ui } from '../../screens/coach/import-journey/importJourneyUI';
import { ImportInlineStatusFrame, ImportStatusAction, ImportStatusText } from '../../screens/coach/import-journey/ImportStatusFrame';

/** Only these three server phases have established P2 copy; an unrecognised phase renders as "not known", never a guess. */
const PHASE_KEY: Record<RunPhase, 'progress.finding' | 'progress.transferring' | 'progress.checking'> = {
  discovering: 'progress.finding', transferring: 'progress.transferring', reconciling: 'progress.checking',
};

export default function ImportRunStatusJourney({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
  const run = useImportRunStatus(importIntentId);
  const romanEnabled = featureFlags.romanChat;

  if (run.view === 'disabled') return null;

  const refreshAction = { enabled: true, onPress: run.refresh };
  const stale = staleNote(run.stale, run.readAt);
  const settled = run.view === 'reading' && !!run.reading && isTerminal(run.reading.status);
  const roster = settled ? <ImportedRosterSection importIntentId={importIntentId} /> : null;

  if (run.view === 'reading' && run.reading && run.reading.status === 'running') {
    const phase = run.reading.phase && run.reading.phase !== 'unknown' ? run.reading.phase : null;
    const phaseKey = phase ? PHASE_KEY[phase] : null;
    const current = !run.stale && phaseKey != null;
    const title = t(current ? 'progress.title' : 'progress.statusUnknown');
    // B2: freshness is a material fact, never a timestamp — included in the
    // announcement even though the title text ("Import in progress") is the
    // same whether the phase is current or merely last-observed.
    const announcement = [title, current && phaseKey ? t(phaseKey) : t('progress.stale')].join('\n');
    return (
      <ImportInlineStatusFrame title={title} announcement={announcement} romanEnabled={romanEnabled}>
        <View style={ui.actions}>
          {!current && <ImportStatusText announce>{t('progress.stale')}</ImportStatusText>}
          {phaseKey && <ImportStatusText announce={current}>{t(phaseKey)}</ImportStatusText>}
        </View>
        <View style={ui.actions}>
          {/* B1: unconditional — available for a current recognised phase too. */}
          <ImportStatusAction primary={!current} action={refreshAction} label={t('result.checkStatus')} />
        </View>
      </ImportInlineStatusFrame>
    );
  }

  let title: string;
  let body: string | undefined;
  let extra: React.ReactNode = null;
  // B2: the reason text/code (when present) is a material fact distinct from
  // the title; it flows into the announcement so a reason CHANGE under an
  // unchanged title (e.g. blocked → a different reason code) is announced.
  let announcementReason: string | null = null;
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
    announcementReason = lines.reason?.text ?? null;
    // B4: a server-verified `complete` additionally carries the established
    // P2 result catalog's distinct Roman-on/off completion voice — the exact
    // same two strings ImportResultView shows for its own `complete`
    // outcome — alongside (never instead of) the server's own title/body.
    const romanVoice = lines.success ? t(romanEnabled ? 'result.complete.roman' : 'result.complete.neutral') : null;
    extra = (
      <>
        {romanVoice ? <ImportStatusText>{romanVoice}</ImportStatusText> : null}
        {lines.legacyNote ? <ImportStatusText secondary>{LEGACY_NOTE}</ImportStatusText> : null}
        {lines.step !== undefined ? <ImportStatusText>Current step: {lines.step}</ImportStatusText> : null}
        {lines.reason ? <ImportStatusText>Reason: {lines.reason.text}</ImportStatusText> : null}
        {lines.finishedAt !== undefined ? <ImportStatusText>Ended: {lines.finishedAt}</ImportStatusText> : null}
      </>
    );
  }

  // B2: material facts only — status text, stale/freshness kind, and reason
  // — never the checked-at/stale TIMESTAMP itself (that changes on every
  // successful poll without being a new fact worth interrupting for).
  const announcement = [title, body, stale?.kind === 'stale' ? 'stale' : null, announcementReason].filter(Boolean).join('\n');

  return (
    <ImportInlineStatusFrame title={title} announcement={announcement} romanEnabled={romanEnabled}>
      <View style={ui.actions}>
        {body ? <ImportStatusText>{body}</ImportStatusText> : null}
        {extra}
        {stale ? <ImportStatusText announce secondary>{stale.text}</ImportStatusText> : null}
      </View>
      <View style={ui.actions}>
        <ImportJourneyAction label={run.isRefreshing ? 'Checking…' : 'Check again'} onPress={run.refresh} disabled={run.isRefreshing} />
      </View>
      {roster}
    </ImportInlineStatusFrame>
  );
}
