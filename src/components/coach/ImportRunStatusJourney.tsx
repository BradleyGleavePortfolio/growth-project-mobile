/**
 * ImportRunStatusJourney — R1 (Roman status binding), rewritten per
 * R1_REVIEW.md (NO-GO), closed further per R300-A (REQUEST CHANGES,
 * B1-B4), and closed again per R300-A2 (REQUEST CHANGES, B2, B4). Mounts
 * the Roman P2 presentation where `ImportRunVerdictCard` mounted today,
 * over the SAME `useImportRunStatus` read (S12-B3), reusing the card's own
 * pure content (`verdictLines`, `staleNote`, `LEGACY_NOTE`, `UNKNOWN_VERDICT`
 * from `./importVerdictContent`, the ONE shared source also used by
 * `ImportRunVerdictCard.tsx`). No content is re-derived; only the
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
 * be an invalid nested-scroll layout"). This component composes
 * `ImportInlineStatusFrame` (non-scrolling, no Back/Return — the host screen
 * already owns navigation) for every branch. `ImportStatusFrame` and
 * `ImportProgressView`/`ImportResultView` themselves are UNCHANGED (beyond
 * the R300-A2-B4 internal refactor into reusable bodies below) and still
 * available for standalone/full-screen use elsewhere.
 *
 * B4 (R300-A2): the R1 grant requires MOUNTING the actual Roman P2
 * progress/result views, not a parallel reimplementation of their facts.
 * `ImportProgressView`/`ImportResultView` are now thin frame wrappers around
 * a reusable, frame-free body (`ImportProgressBody`/`ImportResultBody`) plus
 * a pure presentation adapter (`importProgressPresentation`/
 * `importResultPresentation`) — this journey imports and mounts those SAME
 * bodies inside `ImportInlineStatusFrame`, instead of hand-deriving
 * phase/current/stale logic or copying one completion sentence:
 *   - Running branch: mounts `ImportProgressBody`, fed by the same
 *     `importProgressPresentation` adapter `ImportProgressView` uses.
 *   - Terminal branch: mounts `ImportResultBody`. The strict
 *     proof-gated outcomes (`complete`/`verifiedSubset`/`provenZero`/
 *     `transferOnly`) require native-record proof this hook never receives
 *     (S12-B3 has no native counts) — inventing one would violate "never
 *     derive complete/success on the client" (R1_REVIEW). Every terminal
 *     reading instead uses `ImportResultBody`'s `verdict` outcome, which
 *     renders EXACTLY the already-decoded, already-verified facts this
 *     component reads straight off `verdictLines()` — the server's own
 *     title/body/reason/legacy/finishedAt — with no proof claimed or
 *     invented, because none is being asserted. This is the same reusable
 *     component the standalone view mounts; only the *outcome shape* it
 *     is fed differs, precisely because the facts available here differ.
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
 * honest stale/unavailable presentation) — now the SAME adapter/body, not a
 * parallel copy (R300-A2-B4).
 *   - B1 (R300-A): the manual "Check current result" action is available for
 *     EVERY running reading, INCLUDING a current recognised phase — a coach
 *     watching a seemingly stationary import must still be able to ask the
 *     server directly. `ImportProgressBody` already renders this
 *     unconditionally.
 *
 * B2 (R300-A2): the announcement text is ALWAYS a human-readable sentence —
 * never the raw internal token "stale" (previously pushed verbatim into the
 * iOS announcement array; VoiceOver said the word "stale" instead of an
 * explanation). Freshness now contributes `stale.text` — the same
 * "Couldn't refresh. Showing what the server said…" sentence rendered
 * visibly — not a bare state name. Android no longer nests a whole-card
 * `polite` region (redundant with `ExtensionPairingPanel`'s own ancestor
 * region) or re-announces merely because `readAt`'s timestamp changed on an
 * unchanged verdict: `ImportInlineStatusFrame` now carries exactly ONE
 * change-sensitive `ImportLiveAnnouncement` node, outside the changing
 * checked-at text and the roster subtree, that only updates when the
 * composed `announcement` string itself changes (title, body, genuine
 * stale-kind transition, or reason) — not on every successful poll.
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
import { featureFlags } from '../../config/featureFlags';
import { useImportRunStatus } from '../../hooks/useImportRunStatus';
import { isTerminal, type RunPhase } from '../../types/importRunStatus';
import { LEGACY_NOTE, NOT_KNOWN_YET, UNKNOWN_VERDICT, staleNote, verdictLines } from './importVerdictContent';
import { ImportedRosterSection } from './ImportRunVerdictCard';
import { importJourneyCopy as t } from '../../screens/coach/import-journey/importJourneyCopy';
import { ImportInlineStatusFrame, ImportStatusText } from '../../screens/coach/import-journey/ImportStatusFrame';
import { ImportProgressBody, type ImportProgressPhase } from '../../screens/coach/import-journey/ImportProgressView';
import { ImportResultBody } from '../../screens/coach/import-journey/ImportResultView';

/** Only these three server phases have established P2 copy; an unrecognised phase renders as "not known", never a guess. */
const PHASE_MAP: Record<RunPhase, ImportProgressPhase> = {
  discovering: 'finding', transferring: 'transferring', reconciling: 'checking',
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
    const rawPhase = run.reading.phase && run.reading.phase !== 'unknown' ? run.reading.phase : null;
    const phase = rawPhase ? PHASE_MAP[rawPhase] : undefined;
    // R300-A2-B4: the SAME adapter `ImportProgressView` uses — no duplicated
    // phase/current/stale derivation. `run.stale` (not the hook's raw phase
    // presence) decides freshness, exactly as the standalone view expects.
    const observation = run.stale || !phase
      ? { freshness: 'stale' as const, lastObservedPhase: phase }
      : { freshness: 'current' as const, phase };
    return (
      <ImportInlineStatusFrame
        title={t(observation.freshness === 'current' ? 'progress.title' : 'progress.statusUnknown')}
        announcement={progressAnnouncement(observation)}
        romanEnabled={romanEnabled}
      >
        <ImportProgressBody
          observation={observation}
          stop="notRequested"
          sourceCoverage="unknown"
          checkResultAction={refreshAction}
          // R300-A2-B2: this inline host supplies the ONE Android live-region
          // target (`ImportInlineStatusFrame`'s `ImportLiveAnnouncement`,
          // fed by `announcement` below) — the body's own per-text markers
          // would otherwise nest a second `polite` region under it.
          ownLiveRegion={false}
        />
      </ImportInlineStatusFrame>
    );
  }

  let title: string;
  let body: string | undefined;
  let legacyNote: string | undefined;
  let reasonText: string | undefined;
  let finishedAt: string | undefined;
  let romanVoice: string | null = null;
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
    reasonText = lines.reason?.text;
    finishedAt = lines.finishedAt;
    legacyNote = lines.legacyNote ? LEGACY_NOTE : undefined;
    // B4 (R300-A): a server-verified `complete` additionally carries the
    // established P2 result catalog's distinct Roman-on/off completion
    // voice — the exact same two strings ImportResultView shows for its own
    // `complete` outcome — alongside (never instead of) the server's own
    // title/body.
    romanVoice = lines.success ? t(romanEnabled ? 'result.complete.roman' : 'result.complete.neutral') : null;
  }

  // R300-A2-B4: mount the ACTUAL P2 result body — the `verdict` outcome
  // carries exactly the already-decoded facts above (title/body/reason/
  // legacy/finishedAt), no proof claimed, no native count invented. The
  // server's own body and the Roman/neutral completion voice stay two
  // DISTINCT text nodes (never merged into one string) so a coach can tell
  // "what the server said" apart from "Roman's own completion sentence".
  // R300-A2-B2: `stale.text` is included ONLY for `kind === 'stale'` (the
  // human "Couldn't refresh…" sentence, never the raw "stale" token) — the
  // `checkedAt` variant is a bare "Last checked HH:MM" timestamp that
  // changes on every successful poll without being a new fact, and must
  // never re-trigger the single live-region announcement.
  const announcement = [title, romanVoice, stale?.kind === 'stale' ? stale.text : null, reasonText]
    .filter(Boolean).join('\n');

  return (
    <ImportInlineStatusFrame title={title} announcement={announcement} romanEnabled={romanEnabled}>
      <ImportResultBody
        outcome="verdict"
        verdictTitle={title}
        verdictBody={body ?? ''}
        secondaryVoice={romanVoice ?? undefined}
        legacyNote={legacyNote}
        reasonText={reasonText}
        finishedAt={finishedAt}
        romanEnabled={romanEnabled}
        checkResultAction={refreshAction}
      />
      {stale ? <StaleFooter text={stale.text} /> : null}
      {roster}
    </ImportInlineStatusFrame>
  );
}

function progressAnnouncement(observation: { freshness: 'current'; phase: ImportProgressPhase } | { freshness: 'stale' | 'unavailable'; lastObservedPhase?: ImportProgressPhase }): string {
  const title = t(observation.freshness === 'current' ? 'progress.title' : 'progress.statusUnknown');
  const phaseKey = observation.freshness === 'current' ? PHASE_TEXT_KEY[observation.phase] : null;
  return [title, phaseKey ? t(phaseKey) : t('progress.stale')].join('\n');
}

const PHASE_TEXT_KEY: Record<ImportProgressPhase, 'progress.finding' | 'progress.transferring' | 'progress.checking'> = {
  finding: 'progress.finding', transferring: 'progress.transferring', checking: 'progress.checking',
};

/**
 * The visible stale explanation, kept OUTSIDE `ImportResultBody`'s own
 * action row so it reads as a distinct, secondary fact — exactly as the
 * retired card and prior rounds rendered it. R300-A2-B2: no `announce`
 * (no `accessibilityLiveRegion` of its own) — this text changes its
 * underlying timestamp/verdict on every poll; the ONE change-sensitive
 * announcement is `ImportInlineStatusFrame`'s `ImportLiveAnnouncement`
 * node, driven by the `announcement` string above, not by this node.
 */
function StaleFooter({ text }: { text: string }) {
  return <ImportStatusText secondary>{text}</ImportStatusText>;
}
