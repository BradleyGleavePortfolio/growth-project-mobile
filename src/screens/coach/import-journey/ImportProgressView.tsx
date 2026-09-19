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
const phases = { finding: 'progress.finding', transferring: 'progress.transferring', checking: 'progress.checking' } as const;

/** No clock, polling, optimistic stop, backend enum or lifecycle inference. */
export function ImportProgressView(props: ImportProgressViewProps) {
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
  return <ImportStatusFrame title={title} announcement={announcement} navigationTitle={t('progress.navigationTitle')} romanEnabled={props.romanEnabled} onReturnToCoaching={props.onReturnToCoaching} focusOnMount={props.focusOnMount}>
    <View style={ui.actions}>
      {!current && <ImportStatusText announce>{t('progress.stale')}</ImportStatusText>}
      {phaseKey && <ImportStatusText announce={current}>{t(phaseKey)}</ImportStatusText>}
      {receipts && <ImportStatusText>{receipts}</ImportStatusText>}
      {props.sourceCoverage !== 'confirmed' && <ImportStatusText>{t('progress.unknownTotal')}</ImportStatusText>}
      {time && <ImportStatusText secondary>{time}</ImportStatusText>}
      {props.stop === 'pending' && <ImportStatusText announce>{t('progress.stopping')}</ImportStatusText>}
      {props.stop === 'offline' && <ImportStatusText announce>{t('progress.offlineStop')}</ImportStatusText>}
    </View>
    <View style={ui.actions}>
      {!current && <ImportStatusAction primary action={props.checkResultAction} label={t('result.checkStatus')} />}
      <ImportJourneyAction label={t('progress.return')} onPress={props.onReturnToCoaching} />
      {current && <ImportStatusAction action={props.stopAction} disabled={props.stop !== 'notRequested'} label={t('progress.stop')} />}
      <ImportStatusAction action={props.detailsAction} label={t('progress.details')} />
    </View>
  </ImportStatusFrame>;
}
