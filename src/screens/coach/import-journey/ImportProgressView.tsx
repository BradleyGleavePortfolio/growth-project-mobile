import React from 'react';
import { View } from 'react-native';
import { importJourneyCopy as t, ImportObservedAt, importObservationCopy, importQuantityCopy } from './importJourneyCopy';
import { ImportJourneyAction, ui } from './importJourneyUI';
import { ImportStatusAction, ImportStatusFrame, ImportStatusText, ImportViewAction } from './ImportStatusFrame';

export type ImportProgressPhase = 'finding' | 'transferring' | 'checking';
export type ImportProgressViewProps = {
  romanEnabled: boolean;
  /** Current is supplied accepted/nonterminal authority, not inferred from pairing. */
  observation: { freshness: 'current'; phase: ImportProgressPhase } | { freshness: 'stale' | 'unavailable'; lastObservedPhase?: ImportProgressPhase };
  stop: 'notRequested' | 'pending' | 'offline';
  receiptCount?: number;
  sourceCoverage: 'unknown' | 'confirmed';
  observedAt?: ImportObservedAt;
  locale?: string;
  focusOnMount?: boolean;
  onReturnToCoaching: () => void;
  stopAction?: ImportViewAction;
  checkResultAction?: ImportViewAction;
  detailsAction?: ImportViewAction;
};
/**
 * Body-only props: everything ImportProgressView needs minus the screen chrome
 * (`focusOnMount`/`romanEnabled` are frame-only concerns). `onReturnToCoaching`
 * is OPTIONAL here — the standalone frame always supplies it (its own "Return
 * to coaching" action), but the inline host (R300-A2-B3/B4) mounts this body
 * with no such control: the host screen already owns navigation, so no
 * screen-level Return action is rendered when the callback is absent.
 */
export type ImportProgressBodyProps = Omit<ImportProgressViewProps, 'focusOnMount' | 'romanEnabled' | 'onReturnToCoaching'> & {
  onReturnToCoaching?: () => void;
  /**
   * R300-A2-B2: this body's own per-text `accessibilityLiveRegion="polite"`
   * markers are correct for the STANDALONE frame (no ancestor is already
   * polite there). A host that supplies its own single change-sensitive
   * announcement target (`ImportRunStatusJourney`, via
   * `ImportInlineStatusFrame`'s `ImportLiveAnnouncement`) sets this to
   * `false` so Android does not speak the same material change twice from
   * two nested live regions. Defaults to `true` (existing behavior).
   */
  ownLiveRegion?: boolean;
};
const phases = { finding: 'progress.finding', transferring: 'progress.transferring', checking: 'progress.checking' } as const;

/** Pure derivation shared by the standalone frame-wrapped view and the reusable body (R300-A2-B4: one truthful adapter, not duplicated phase/current/stale logic). */
export function importProgressPresentation(props: ImportProgressBodyProps) {
  const phase = props.observation.freshness === 'current' ? props.observation.phase : props.observation.lastObservedPhase;
  const phaseKey = phase && Object.prototype.hasOwnProperty.call(phases, phase) ? phases[phase] : null;
  const current = props.observation.freshness === 'current' && phaseKey != null && props.stop !== 'offline';
  const time = importObservationCopy(props.observedAt);
  const receipts = importQuantityCopy('receipts', props.receiptCount, props.locale);
  const title = t(current ? 'progress.title' : 'progress.statusUnknown');
  // One meaningful iOS message per change; stale phases, counts and times are
  // intentionally excluded. Android retains the existing polite live regions.
  const announcement = [
    title,
    current && phaseKey ? t(phaseKey) : t('progress.stale'),
    props.stop === 'pending' ? t('progress.stopping') : props.stop === 'offline' ? t('progress.offlineStop') : null,
  ].filter(Boolean).join('\n');
  return { phaseKey, current, time, receipts, title, announcement };
}

/**
 * R300-A2-B4: the reusable body content, with NO frame/ScrollView/Back of its
 * own — mounted by BOTH the standalone `ImportProgressView` (below, inside
 * `ImportStatusFrame`) and `ImportRunStatusJourney`'s inline running branch
 * (inside `ImportInlineStatusFrame`). One presentation, one source of the
 * phase/current/stale logic; the inline host is no longer a parallel
 * reimplementation of this component's facts.
 */
export function ImportProgressBody(props: ImportProgressBodyProps) {
  const { phaseKey, current, time, receipts } = importProgressPresentation(props);
  const ownLiveRegion = props.ownLiveRegion ?? true;
  return <>
    <View style={ui.actions}>
      {!current && <ImportStatusText announce={ownLiveRegion}>{t('progress.stale')}</ImportStatusText>}
      {phaseKey && <ImportStatusText announce={ownLiveRegion && current}>{t(phaseKey)}</ImportStatusText>}
      {receipts && <ImportStatusText>{receipts}</ImportStatusText>}
      {props.sourceCoverage !== 'confirmed' && <ImportStatusText>{t('progress.unknownTotal')}</ImportStatusText>}
      {time && <ImportStatusText secondary>{time}</ImportStatusText>}
      {props.stop === 'pending' && <ImportStatusText announce={ownLiveRegion}>{t('progress.stopping')}</ImportStatusText>}
      {props.stop === 'offline' && <ImportStatusText announce={ownLiveRegion}>{t('progress.offlineStop')}</ImportStatusText>}
    </View>
    <View style={ui.actions}>
      {/* B1 (R300-A): the manual "check result" refresh is available for EVERY
          reading, including a current recognised phase — a coach watching a
          seemingly stationary import must still be able to ask the server
          directly, exactly as the retired card's unconditional action did.
          Only its emphasis (primary) shifts to the stale case. */}
      <ImportStatusAction primary={!current} action={props.checkResultAction} label={t('result.checkStatus')} />
      {props.onReturnToCoaching ? <ImportJourneyAction label={t('progress.return')} onPress={props.onReturnToCoaching} /> : null}
      {current && <ImportStatusAction action={props.stopAction} disabled={props.stop !== 'notRequested'} label={t('progress.stop')} />}
      <ImportStatusAction action={props.detailsAction} label={t('progress.details')} />
    </View>
  </>;
}

/** No clock, polling, optimistic stop, backend enum or lifecycle inference. */
export function ImportProgressView(props: ImportProgressViewProps) {
  const { title, announcement } = importProgressPresentation(props);
  return <ImportStatusFrame title={title} announcement={announcement} navigationTitle={t('progress.navigationTitle')} romanEnabled={props.romanEnabled} onReturnToCoaching={props.onReturnToCoaching} focusOnMount={props.focusOnMount}>
    <ImportProgressBody {...props} />
  </ImportStatusFrame>;
}
