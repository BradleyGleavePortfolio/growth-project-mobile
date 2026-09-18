import './sideEffectGuards.cjs';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { ImportProgressView, ImportProgressViewProps } from '../ImportProgressView';
import { ImportResultView, ImportResultViewProps, ImportNativeSummary } from '../ImportResultView';
import { importQuantityCopy, importObservationCopy } from '../importJourneyCopy';
const guards = require('./sideEffectGuards.cjs');
beforeEach(() => guards.installGuards());
afterEach(async () => { await cleanup(); try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); } });
const observedAt = { epochMs: 1789740000000, locale: 'en-US', timeZone: 'UTC' };
const native: ImportNativeSummary = { scope: 'selectedClientRecords', verifiedClientRecords: 8, relationships: 'verified', readback: 'verified' };
const action = (enabled = true) => ({ enabled, onPress: jest.fn() });
const progress = (): ImportProgressViewProps => ({ romanEnabled: true, observation: { freshness: 'current', phase: 'transferring' }, stop: 'notRequested', sourceCoverage: 'unknown', receiptCount: 12, observedAt, onReturnToCoaching: jest.fn(), stopAction: action(), checkResultAction: action(), detailsAction: action() });
const result = () => ({ outcome: 'unconfirmed', romanEnabled: true, receiptCount: 12, unconfirmedClientRecords: 22, observedAt, onReturnToCoaching: jest.fn(), checkResultAction: action(), recoveryAction: action(), helpAction: action(), detailsAction: action() } satisfies ImportResultViewProps);

it('keeps 12 receipts and 22 unconfirmed client records separate, with both unknowns', async () => {
  const props = result(); const v = await render(<ImportResultView {...props} />);
  expect(v.getByRole('header')).toHaveTextContent('Some records are unconfirmed');
  expect(v.getByText(importQuantityCopy('receipts', 12)!)).toBeTruthy();
  expect(v.getByText(importQuantityCopy('unconfirmedClients', 22)!)).toBeTruthy();
  expect(v.getByText('Source completeness has not been confirmed.')).toBeTruthy();
  expect(v.getByText('Availability in TGP has not been confirmed.')).toBeTruthy();
  expect(v.queryByText(/34|22 failed|Your records are ready|client records verified/)).toBeNull();
  expect(v.queryByRole('button', { name: /Open|Review verified|Retry|Start a new/ })).toBeNull();
  for (const [label, callback] of [['Check current result', props.checkResultAction!.onPress], ['Review recovery steps', props.recoveryAction!.onPress], ['Get help', props.helpAction!.onPress], ['View transfer details', props.detailsAction!.onPress], ['Return to coaching', props.onReturnToCoaching]] as const) {
    await fireEvent.press(v.getByRole('button', { name: label })); expect(callback).toHaveBeenCalledTimes(1);
  }
  await fireEvent.press(v.getByRole('button', { name: 'Back' })); expect(props.onReturnToCoaching).toHaveBeenCalledTimes(2);
  expect(v.getByRole('header')).toHaveTextContent('Some records are unconfirmed');
});

it('only emits Stop intent, then separately supplied pending/stale/offline observations', async () => {
  const props = progress(); const v = await render(<ImportProgressView {...props} />);
  await fireEvent.press(v.getByRole('button', { name: 'Stop import' }));
  expect(props.stopAction!.onPress).toHaveBeenCalledTimes(1);
  expect(v.queryByText('Stop requested. Waiting for confirmation.')).toBeNull();
  await v.rerender(<ImportProgressView {...props} stop="pending" />);
  expect(v.getByText('Stop requested. Waiting for confirmation.')).toBeTruthy();
  await fireEvent.press(v.getByRole('button', { name: 'Stop import' }));
  expect(props.stopAction!.onPress).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportProgressView {...props} stop="pending" observation={{ freshness: 'stale', lastObservedPhase: 'transferring' }} />);
  expect(v.getByRole('header')).toHaveTextContent('Current status unconfirmed');
  expect(v.getByText(importObservationCopy(observedAt)!)).toBeTruthy();
  expect(v.queryByText(/Import stopped|Import was interrupted|time limit/)).toBeNull();
  expect(v.queryByRole('button', { name: 'Stop import' })).toBeNull();
  await fireEvent.press(v.getByRole('button', { name: 'Check current result' })); expect(props.checkResultAction!.onPress).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportProgressView {...props} stop="offline" />);
  expect(v.getByRole('header')).toHaveTextContent('Current status unconfirmed');
  expect(v.getByText('This phone is offline. Stop the import from the extension on your computer.')).toBeTruthy();
  expect(v.queryByRole('button', { name: 'Stop import' })).toBeNull();
  await fireEvent.press(v.getByRole('button', { name: 'Back' }));
  await fireEvent.press(v.getByRole('button', { name: 'Return to coaching' }));
  await fireEvent.press(v.getByRole('button', { name: 'View transfer details' }));
  expect(props.onReturnToCoaching).toHaveBeenCalledTimes(2); expect(props.detailsAction!.onPress).toHaveBeenCalledTimes(1);
});

it.each(['finding', 'transferring', 'checking'] as const)('shows supplied %s phase and preserves observation time on count rerender', async phase => {
  const v = await render(<ImportProgressView {...progress()} observation={{ freshness: 'current', phase }} />);
  const text = { finding: 'Finding records', transferring: 'Transferring records', checking: 'Checking records in TGP' }[phase];
  expect(v.getByText(text).props.accessibilityLiveRegion).toBe('polite');
  await v.rerender(<ImportProgressView {...progress()} observation={{ freshness: 'current', phase }} receiptCount={13} />);
  expect(v.getByText(importObservationCopy(observedAt)!)).toBeTruthy();
  expect(v.getByText(importQuantityCopy('receipts', 13)!).props.accessibilityLiveRegion).toBe('none');
  expect(v.queryByText(/%|seconds remaining|minutes remaining/)).toBeNull();
});

it.each([
  ['interrupted', 'Import was interrupted', 'The current result needs to be checked before another attempt.'],
  ['failed', 'Import did not complete', 'Review the confirmed records and the items that could not be completed.'],
  ['timedOut', 'This import attempt reached its time limit', 'Review the records that were confirmed before deciding what to do next.'],
  ['cancelled', 'Import stopped', 'Records already written may remain in TGP. Review the confirmed result.'],
] as const)('keeps authoritative %s wording distinct and does not imply zero effects', async (outcome, title, body) => {
  const v = await render(<ImportResultView {...result()} outcome={outcome} />);
  expect(v.getByRole('header')).toHaveTextContent(title); expect(v.getByText(body)).toBeTruthy();
  expect(v.queryByText(/No records were found|nothing imported|rolled back/)).toBeNull();
});

it('uses only approved reason keys, never a raw exception', async () => {
  const v = await render(<ImportResultView {...result()} outcome="blocked" reason="denied" />);
  expect(v.getByText('Access was not granted. Allow access to the selected source to continue.')).toBeTruthy();
  await v.rerender(<ImportResultView {...result()} outcome="blocked" reason={'secret-token@example.com' as 'unknown'} />);
  expect(v.getByText('The import needs attention before it can continue.')).toBeTruthy();
  expect(v.queryByText(/secret-token/)).toBeNull();
});

it('does not relabel lost acknowledgments when result retrieval becomes unavailable', async () => {
  const props = result(); const v = await render(<ImportResultView {...props} />);
  await v.rerender(<ImportResultView {...props} outcome="unavailable" />);
  expect(v.getByRole('header')).toHaveTextContent('The import result is unavailable right now. Check again when you are connected.');
  expect(v.queryByText(/12|22|failed|Import stopped/)).toBeNull();
  expect(v.getByText(importObservationCopy(observedAt)!)).toBeTruthy();
});

it('separately presents verified subset, complete scope and proven zero without deriving one from another', async () => {
  const review = action(), open = action(); const props = result();
  const v = await render(<ImportResultView {...props} outcome="verifiedSubset" native={native} reviewVerifiedAction={review} />);
  expect(v.getByRole('header')).toHaveTextContent('Some records are ready');
  expect(v.getByText(importQuantityCopy('nativeClients', 8)!)).toBeTruthy();
  expect(v.getByText(importQuantityCopy('unconfirmedClients', 22)!)).toBeTruthy();
  expect(v.queryByRole('button', { name: 'Open clients in TGP' })).toBeNull();
  await fireEvent.press(v.getByRole('button', { name: 'Review verified records' })); expect(review.onPress).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportResultView {...props} outcome="complete" native={native} sourceCoverage="complete" requiredFamilies="verified" unconfirmedClientRecords={0} openClientsAction={open} />);
  expect(v.getByRole('header')).toHaveTextContent('Your records are ready');
  expect(v.getByText('I have checked the imported records in TGP. They are ready to use.')).toBeTruthy();
  await fireEvent.press(v.getByRole('button', { name: 'Open clients in TGP' })); expect(open.onPress).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportResultView {...props} outcome="provenZero" scope="selectedClientRecords" sourceCoverage="complete" checkedSourceRecords={0} receiptCount={0} unconfirmedClientRecords={0} />);
  expect(v.getByRole('header')).toHaveTextContent('No records were found in the checked scope.');
  expect(v.queryByText('Your records are ready')).toBeNull(); expect(v.queryByRole('button', { name: /Open|Review verified/ })).toBeNull();
  await v.rerender(<ImportResultView {...props} outcome="blocked" reason="scopeUnknown" receiptCount={undefined} unconfirmedClientRecords={undefined} />);
  expect(v.queryByText('No records were found in the checked scope.')).toBeNull();
});

it.each([undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('omits invalid quantity %s, never coerces it to zero or successful proof', async quantity => {
  const props = result(); const v = await render(<ImportResultView {...props} receiptCount={quantity} unconfirmedClientRecords={quantity} />);
  expect(v.queryByText(/record receipt|unconfirmed client record/)).toBeNull();
  expect(v.getByText('Availability in TGP has not been confirmed.')).toBeTruthy();
  const malformed = { ...props, outcome: 'complete', sourceCoverage: 'complete', requiredFamilies: 'verified', unconfirmedClientRecords: 0, native: { ...native, verifiedClientRecords: quantity }, openClientsAction: action() } as unknown as ImportResultViewProps;
  await v.rerender(<ImportResultView {...malformed} />);
  expect(v.getByRole('header')).toHaveTextContent('The import result is unavailable right now. Check again when you are connected.');
  expect(v.queryByRole('button', { name: 'Open clients in TGP' })).toBeNull();
});

it.each([
  { outcome: 'complete', native, sourceCoverage: 'unknown', requiredFamilies: 'verified', unconfirmedClientRecords: 0 },
  { outcome: 'complete', native, sourceCoverage: 'complete', requiredFamilies: 'verified', unconfirmedClientRecords: 22 },
  { outcome: 'verifiedSubset', native: { ...native, verifiedClientRecords: 0 } },
  { outcome: 'provenZero', scope: 'selectedClientRecords', sourceCoverage: 'complete', checkedSourceRecords: 0, receiptCount: 12, unconfirmedClientRecords: 0 },
  { outcome: 'transferOnly', receiptCount: undefined },
])('fails safely on contradictory proof %#', async patch => {
  const malformed = { ...result(), ...patch } as unknown as ImportResultViewProps;
  const v = await render(<ImportResultView {...malformed} />);
  expect(v.getByRole('header')).toHaveTextContent('The import result is unavailable right now. Check again when you are connected.');
  expect(v.queryByText(/Your records are ready|Some records are ready|No records were found/)).toBeNull();
});

it('requires both supported native action and callback; disabled/unavailable intent does not fire', async () => {
  const disabled = action(false); const props = result();
  const v = await render(<ImportResultView {...props} checkResultAction={disabled} recoveryAction={undefined} />);
  expect(v.queryByRole('button', { name: 'Check current result' })).toBeNull(); expect(disabled.onPress).not.toHaveBeenCalled();
  expect(v.queryByRole('button', { name: 'Review recovery steps' })).toBeNull();
  await v.rerender(<ImportResultView {...props} outcome="verifiedSubset" native={native} reviewVerifiedAction={undefined} />);
  expect(v.queryByRole('button', { name: 'Review verified records' })).toBeNull();
});

it('removes Roman face and first-person completion speech when off', async () => {
  const v = await render(<ImportResultView {...result()} romanEnabled={false} outcome="complete" native={native} sourceCoverage="complete" requiredFamilies="verified" unconfirmedClientRecords={0} />);
  expect(v.queryByRole('image', { name: 'Roman' })).toBeNull();
  expect(v.getByText('The imported records have been checked in TGP and are ready to use.')).toBeTruthy();
  expect(v.queryByText(/^I have/)).toBeNull();
});

it('separates transfer confirmation from native availability and rejects unresolved transfer combinations', async () => {
  const props = result();
  const v = await render(<ImportResultView {...props} outcome="transferOnly" unconfirmedClientRecords={0} />);
  expect(v.getByRole('header')).toHaveTextContent('Transfer confirmed. Availability in TGP has not been confirmed.');
  expect(v.queryByRole('button', { name: /Open|Review verified/ })).toBeNull();
  const malformed = { ...props, outcome: 'transferOnly', unconfirmedClientRecords: 22 } as unknown as ImportResultViewProps;
  await v.rerender(<ImportResultView {...malformed} />);
  expect(v.getByRole('header')).toHaveTextContent('The import result is unavailable right now. Check again when you are connected.');
});
