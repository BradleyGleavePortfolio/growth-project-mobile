import React from 'react';
import { View } from 'react-native';
import { importJourneyCopy as t, ImportObservedAt, importObservationCopy, importQuantityCopy, importCheckedScopeCopy, isImportQuantity } from './importJourneyCopy';
import { ImportJourneyAction, ui } from './importJourneyUI';
import { ImportStatusAction, ImportStatusFrame, ImportStatusText, ImportViewAction } from './ImportStatusFrame';

/** Only a display assertion from an accepted future adapter, never proof generated here. */
export type ImportNativeSummary = {
  scope: 'selectedClientRecords'; verifiedClientRecords: number;
  relationships: 'verified'; readback: 'verified';
};
type ResultBase = {
  romanEnabled: boolean; focusOnMount?: boolean; observedAt?: ImportObservedAt; locale?: string;
  receiptCount?: number; unconfirmedClientRecords?: number;
  onReturnToCoaching: () => void;
  checkResultAction?: ImportViewAction; recoveryAction?: ImportViewAction; helpAction?: ImportViewAction; detailsAction?: ImportViewAction;
};
export type ImportResultViewProps = ResultBase & (
  | { outcome: 'unconfirmed' | 'interrupted' | 'failed' | 'timedOut' | 'cancelled' | 'unavailable' }
  | { outcome: 'transferOnly'; receiptCount: number; unconfirmedClientRecords: 0 }
  | { outcome: 'blocked'; reason: 'denied' | 'scopeUnknown' | 'changed' | 'unknown' }
  | { outcome: 'verifiedSubset'; native: ImportNativeSummary; reviewVerifiedAction?: ImportViewAction }
  | { outcome: 'complete'; native: ImportNativeSummary; sourceCoverage: 'complete'; requiredFamilies: 'verified'; unconfirmedClientRecords: 0; openClientsAction?: ImportViewAction }
  | { outcome: 'provenZero'; scope: 'selectedClientRecords'; sourceCoverage: 'complete'; checkedSourceRecords: 0; receiptCount: 0; unconfirmedClientRecords: 0 }
  /**
   * R1 (Roman status binding) closure: a source-of-record server verdict
   * (`GET /api/scout/import/status`) carried with NO native write proof —
   * distinct from `complete`/`verifiedSubset`, which additionally require an
   * `ImportNativeSummary` this authority never supplies. `authority:'server'`
   * marks it as coming from the same S12-B3 arbiter `ImportRunVerdictCard`
   * reads today, never a client guess. Renders the complete/partial headline
   * and body copy WITHOUT any count, scope or native action — this view never
   * invents a number the server reading did not carry. `reason` is only ever
   * meaningful (and only ever rendered) for `status:'partial'`, using the
   * same four approved local reason keys `blocked` uses.
   */
  | { outcome: 'serverVerdict'; authority: 'server'; status: 'complete' | 'partial'; reason?: 'denied' | 'scopeUnknown' | 'changed' | 'unknown' }
);
function validNative(value: unknown): value is ImportNativeSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as ImportNativeSummary;
  return v.scope === 'selectedClientRecords' && isImportQuantity(v.verifiedClientRecords) && v.verifiedClientRecords > 0 && v.relationships === 'verified' && v.readback === 'verified';
}
const ordinaryCopy = {
  unconfirmed: ['result.unconfirmed.title', 'result.unconfirmed.body'],
  interrupted: ['result.interrupted.title', 'result.interrupted.body'],
  failed: ['result.failed.title', 'result.failed.body'],
  timedOut: ['result.timeout.title', 'result.timeout.body'],
  cancelled: ['result.cancelled.title', 'result.cancelled.body'],
  transferOnly: ['result.transferOnly', 'result.nativeUnknown'],
  unavailable: ['result.unavailable', 'result.coverageUnknown'],
} as const;

/** Pure result presentation: no cached authority, identifiers, routes, retry or Start. */
export function ImportResultView(props: ImportResultViewProps) {
  const safeOptionalCounts = [props.receiptCount, props.unconfirmedClientRecords].every(v => v === undefined || isImportQuantity(v));
  const subset = props.outcome === 'verifiedSubset' && validNative(props.native) && safeOptionalCounts;
  const complete = props.outcome === 'complete' && validNative(props.native) && props.sourceCoverage === 'complete' && props.requiredFamilies === 'verified' && props.unconfirmedClientRecords === 0 && safeOptionalCounts;
  const zero = props.outcome === 'provenZero' && props.scope === 'selectedClientRecords' && props.sourceCoverage === 'complete' && props.checkedSourceRecords === 0 && props.receiptCount === 0 && props.unconfirmedClientRecords === 0 && !('native' in props);
  const validTransfer = props.outcome === 'transferOnly' && isImportQuantity(props.receiptCount) && props.receiptCount > 0 && props.unconfirmedClientRecords === 0 && safeOptionalCounts;
  const invalidProof = (props.outcome === 'complete' && !complete) || (props.outcome === 'verifiedSubset' && !subset) || (props.outcome === 'provenZero' && !zero) || (props.outcome === 'transferOnly' && !validTransfer);
  const serverComplete = props.outcome === 'serverVerdict' && props.authority === 'server' && props.status === 'complete';
  const serverPartial = props.outcome === 'serverVerdict' && props.authority === 'server' && props.status === 'partial';
  // An explicit zero contradicts this branch's positive-unconfirmed claim.
  // Do not turn it into transfer, native-readiness or proven-zero authority.
  const unavailable = props.outcome === 'unavailable' || invalidProof || (props.outcome === 'unconfirmed' && props.unconfirmedClientRecords === 0);
  const native = (complete || subset) && 'native' in props ? props.native : null;
  let title: string;
  let body: string | null = null;
  if (unavailable) title = t('result.unavailable');
  else if (complete) { title = t('result.complete.title'); body = t(props.romanEnabled ? 'result.complete.roman' : 'result.complete.neutral'); }
  else if (subset) { title = t('result.partial.title'); body = t('result.partial.body'); }
  else if (zero) title = t('result.zero');
  else if (serverComplete) { title = t('result.complete.title'); body = t(props.romanEnabled ? 'result.complete.roman' : 'result.complete.neutral'); }
  else if (serverPartial) {
    title = t('result.partial.title');
    const reason = props.outcome === 'serverVerdict' ? props.reason : undefined;
    body = reason === 'denied' || reason === 'scopeUnknown' || reason === 'changed' ? t(`result.reasons.${reason}`) : t('result.partial.body');
  } else if (props.outcome === 'blocked') {
    title = t('result.blocked.title');
    body = props.reason === 'denied' || props.reason === 'scopeUnknown' || props.reason === 'changed' ? t(`result.reasons.${props.reason}`) : t('result.reasonUnknown');
  } else if (Object.prototype.hasOwnProperty.call(ordinaryCopy, props.outcome)) {
    const keys = ordinaryCopy[props.outcome as keyof typeof ordinaryCopy];
    title = t(keys[0]); body = props.outcome === 'transferOnly' ? null : t(keys[1]);
  } else title = t('result.unavailable');
  const knownOutcome = Object.prototype.hasOwnProperty.call(ordinaryCopy, props.outcome) || props.outcome === 'blocked' || complete || subset || zero || serverComplete || serverPartial;
  const suppressFacts = unavailable || !knownOutcome;
  const receipts = !suppressFacts && !zero && !serverComplete && !serverPartial ? importQuantityCopy('receipts', props.receiptCount, props.locale) : null;
  const unconfirmed = !suppressFacts && !zero && !serverComplete && !serverPartial ? importQuantityCopy('unconfirmedClients', props.unconfirmedClientRecords, props.locale) : null;
  const nativeCount = native ? importQuantityCopy('nativeClients', native.verifiedClientRecords, props.locale) : null;
  const scope = native ? importCheckedScopeCopy(native.scope) : zero && props.outcome === 'provenZero' ? importCheckedScopeCopy(props.scope) : null;
  const time = importObservationCopy(props.observedAt);
  return <ImportStatusFrame title={title} navigationTitle={t('result.navigationTitle')} romanEnabled={props.romanEnabled} onReturnToCoaching={props.onReturnToCoaching} focusOnMount={props.focusOnMount}>
    <View style={ui.actions}>
      {body && <ImportStatusText>{body}</ImportStatusText>}
      {scope && <ImportStatusText>{scope}</ImportStatusText>}
      {receipts && <ImportStatusText>{receipts}</ImportStatusText>}
      {unconfirmed && <ImportStatusText>{unconfirmed}</ImportStatusText>}
      {nativeCount && <ImportStatusText>{nativeCount}</ImportStatusText>}
      {!complete && !zero && !serverComplete && !serverPartial && <ImportStatusText>{t('result.coverageUnknown')}</ImportStatusText>}
      {!native && !zero && !serverComplete && !serverPartial && (props.outcome !== 'transferOnly' || suppressFacts) && <ImportStatusText>{t('result.nativeUnknown')}</ImportStatusText>}
      {time && <ImportStatusText secondary>{time}</ImportStatusText>}
    </View>
    <View style={ui.actions}>
      {complete && props.outcome === 'complete' && <ImportStatusAction primary action={props.openClientsAction} label={t('result.openClients')} />}
      {subset && props.outcome === 'verifiedSubset' && <ImportStatusAction primary action={props.reviewVerifiedAction} label={t('result.reviewVerified')} />}
      {!complete && !zero && !serverComplete && !serverPartial && <ImportStatusAction primary={!subset} action={props.checkResultAction} label={t('result.checkStatus')} />}
      <ImportStatusAction action={props.recoveryAction} label={t('result.recovery')} />
      <ImportStatusAction action={props.helpAction} label={t('result.support')} />
      <ImportStatusAction action={props.detailsAction} label={t('progress.details')} />
      <ImportJourneyAction label={t('result.close')} onPress={props.onReturnToCoaching} />
    </View>
  </ImportStatusFrame>;
}
