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
type ResultActions = {
  checkResultAction?: ImportViewAction; recoveryAction?: ImportViewAction; helpAction?: ImportViewAction; detailsAction?: ImportViewAction;
};
type ResultFacts = { romanEnabled: boolean; observedAt?: ImportObservedAt; locale?: string; receiptCount?: number; unconfirmedClientRecords?: number };
/**
 * The outcome union, declared ONCE without frame-only fields
 * (`romanEnabled`/`focusOnMount`/`onReturnToCoaching`) so both the
 * standalone-view props and the reusable body props share exactly the same
 * discriminated shape (a shared base intersected with `Omit` over a union
 * does not narrow reliably under `outcome`; declaring the union directly
 * does).
 */
type ResultOutcome = ResultActions & ResultFacts & (
  | { outcome: 'unconfirmed' | 'interrupted' | 'failed' | 'timedOut' | 'cancelled' | 'unavailable' }
  | { outcome: 'transferOnly'; receiptCount: number; unconfirmedClientRecords: 0 }
  | { outcome: 'blocked'; reason: 'denied' | 'scopeUnknown' | 'changed' | 'unknown' }
  | { outcome: 'verifiedSubset'; native: ImportNativeSummary; reviewVerifiedAction?: ImportViewAction }
  | { outcome: 'complete'; native: ImportNativeSummary; sourceCoverage: 'complete'; requiredFamilies: 'verified'; unconfirmedClientRecords: 0; openClientsAction?: ImportViewAction }
  | { outcome: 'provenZero'; scope: 'selectedClientRecords'; sourceCoverage: 'complete'; checkedSourceRecords: 0; receiptCount: 0; unconfirmedClientRecords: 0 }
  /**
   * R300-A2-B4: an already-decoded, already-verified verdict — the honest
   * per-status/per-reason-code/legacy/stale vocabulary `verdictLines()`
   * produces (9 reason codes, 6 server terminals, 3 legacy terminals, plus
   * `unknown`) does not fit the proof-gated outcomes above without either
   * collapsing distinct causes (R1_REVIEW A2) or inventing native-record
   * proof the server never sent. This outcome renders EXACTLY the caller's
   * own title/body/reason/legacy text — no proof is verified or derived
   * here, because none is claimed: the caller already read it straight off
   * `useImportRunStatus`/`verdictLines`, the server's own decoded facts.
   */
  | { outcome: 'verdict'; verdictTitle: string; verdictBody: string; secondaryVoice?: string; legacyNote?: string; reasonText?: string; finishedAt?: string; success?: boolean }
);
export type ImportResultViewProps = ResultOutcome & { focusOnMount?: boolean; onReturnToCoaching: () => void };
/** Body-only props: the frame's `onReturnToCoaching` is optional here (see ImportProgressBodyProps for why). */
export type ImportResultBodyProps = ResultOutcome & { onReturnToCoaching?: () => void };
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

/** Pure derivation shared by the standalone frame-wrapped view and the reusable body (R300-A2-B4). */
export function importResultPresentation(props: ImportResultBodyProps) {
  if (props.outcome === 'verdict') {
    return {
      unavailable: false, complete: false, subset: false, zero: false, native: null,
      title: props.verdictTitle, body: props.verdictBody, receipts: null, unconfirmed: null, nativeCount: null,
      scope: null, time: null, suppressFacts: true,
    };
  }
  const safeOptionalCounts = [props.receiptCount, props.unconfirmedClientRecords].every(v => v === undefined || isImportQuantity(v));
  const subset = props.outcome === 'verifiedSubset' && validNative(props.native) && safeOptionalCounts;
  const complete = props.outcome === 'complete' && validNative(props.native) && props.sourceCoverage === 'complete' && props.requiredFamilies === 'verified' && props.unconfirmedClientRecords === 0 && safeOptionalCounts;
  const zero = props.outcome === 'provenZero' && props.scope === 'selectedClientRecords' && props.sourceCoverage === 'complete' && props.checkedSourceRecords === 0 && props.receiptCount === 0 && props.unconfirmedClientRecords === 0 && !('native' in props);
  const validTransfer = props.outcome === 'transferOnly' && isImportQuantity(props.receiptCount) && props.receiptCount > 0 && props.unconfirmedClientRecords === 0 && safeOptionalCounts;
  const invalidProof = (props.outcome === 'complete' && !complete) || (props.outcome === 'verifiedSubset' && !subset) || (props.outcome === 'provenZero' && !zero) || (props.outcome === 'transferOnly' && !validTransfer);
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
  else if (props.outcome === 'blocked') {
    title = t('result.blocked.title');
    body = props.reason === 'denied' || props.reason === 'scopeUnknown' || props.reason === 'changed' ? t(`result.reasons.${props.reason}`) : t('result.reasonUnknown');
  } else if (Object.prototype.hasOwnProperty.call(ordinaryCopy, props.outcome)) {
    const keys = ordinaryCopy[props.outcome as keyof typeof ordinaryCopy];
    title = t(keys[0]); body = props.outcome === 'transferOnly' ? null : t(keys[1]);
  } else title = t('result.unavailable');
  const knownOutcome = Object.prototype.hasOwnProperty.call(ordinaryCopy, props.outcome) || props.outcome === 'blocked' || complete || subset || zero;
  const suppressFacts = unavailable || !knownOutcome;
  const receipts = !suppressFacts && !zero ? importQuantityCopy('receipts', props.receiptCount, props.locale) : null;
  const unconfirmed = !suppressFacts && !zero ? importQuantityCopy('unconfirmedClients', props.unconfirmedClientRecords, props.locale) : null;
  const nativeCount = native ? importQuantityCopy('nativeClients', native.verifiedClientRecords, props.locale) : null;
  const scope = native ? importCheckedScopeCopy(native.scope) : zero && props.outcome === 'provenZero' ? importCheckedScopeCopy(props.scope) : null;
  const time = importObservationCopy(props.observedAt);
  return { unavailable, complete, subset, zero, native, title, body, receipts, unconfirmed, nativeCount, scope, time, suppressFacts };
}

/**
 * R300-A2-B4: the reusable body content, with NO frame/ScrollView/Back of its
 * own — mounted by BOTH the standalone `ImportResultView` (below, inside
 * `ImportStatusFrame`) and (for the `complete`/`unavailable` shapes it can
 * truthfully compute today) `ImportRunStatusJourney`'s inline terminal
 * branch, inside `ImportInlineStatusFrame`.
 */
export function ImportResultBody(props: ImportResultBodyProps) {
  const { complete, subset, zero, native, body, receipts, unconfirmed, nativeCount, scope, time, suppressFacts } = importResultPresentation(props);
  if (props.outcome === 'verdict') {
    return <>
      <View style={ui.actions}>
        <ImportStatusText>{body}</ImportStatusText>
        {props.secondaryVoice ? <ImportStatusText>{props.secondaryVoice}</ImportStatusText> : null}
        {props.legacyNote ? <ImportStatusText secondary>{props.legacyNote}</ImportStatusText> : null}
        {props.reasonText ? <ImportStatusText>Reason: {props.reasonText}</ImportStatusText> : null}
        {props.finishedAt ? <ImportStatusText>Ended: {props.finishedAt}</ImportStatusText> : null}
      </View>
      <View style={ui.actions}>
        <ImportStatusAction primary action={props.checkResultAction} label={t('result.checkStatus')} />
        {props.onReturnToCoaching ? <ImportJourneyAction label={t('result.close')} onPress={props.onReturnToCoaching} /> : null}
      </View>
    </>;
  }
  return <>
    <View style={ui.actions}>
      {body && <ImportStatusText>{body}</ImportStatusText>}
      {scope && <ImportStatusText>{scope}</ImportStatusText>}
      {receipts && <ImportStatusText>{receipts}</ImportStatusText>}
      {unconfirmed && <ImportStatusText>{unconfirmed}</ImportStatusText>}
      {nativeCount && <ImportStatusText>{nativeCount}</ImportStatusText>}
      {!complete && !zero && <ImportStatusText>{t('result.coverageUnknown')}</ImportStatusText>}
      {!native && !zero && (props.outcome !== 'transferOnly' || suppressFacts) && <ImportStatusText>{t('result.nativeUnknown')}</ImportStatusText>}
      {time && <ImportStatusText secondary>{time}</ImportStatusText>}
    </View>
    <View style={ui.actions}>
      {complete && props.outcome === 'complete' && <ImportStatusAction primary action={props.openClientsAction} label={t('result.openClients')} />}
      {subset && props.outcome === 'verifiedSubset' && <ImportStatusAction primary action={props.reviewVerifiedAction} label={t('result.reviewVerified')} />}
      {!complete && !zero && <ImportStatusAction primary={!subset} action={props.checkResultAction} label={t('result.checkStatus')} />}
      <ImportStatusAction action={props.recoveryAction} label={t('result.recovery')} />
      <ImportStatusAction action={props.helpAction} label={t('result.support')} />
      <ImportStatusAction action={props.detailsAction} label={t('progress.details')} />
      {props.onReturnToCoaching ? <ImportJourneyAction label={t('result.close')} onPress={props.onReturnToCoaching} /> : null}
    </View>
  </>;
}

/** Pure result presentation: no cached authority, identifiers, routes, retry or Start. */
export function ImportResultView(props: ImportResultViewProps) {
  const { title } = importResultPresentation(props);
  return <ImportStatusFrame title={title} navigationTitle={t('result.navigationTitle')} romanEnabled={props.romanEnabled} onReturnToCoaching={props.onReturnToCoaching} focusOnMount={props.focusOnMount}>
    <ImportResultBody {...props} />
  </ImportStatusFrame>;
}
