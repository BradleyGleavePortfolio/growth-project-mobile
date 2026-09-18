import './sideEffectGuards.cjs';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { ImportProgressView } from '../ImportProgressView';
import { ImportResultView } from '../ImportResultView';
const guards = require('./sideEffectGuards.cjs');
beforeEach(() => guards.installGuards());
afterEach(async () => { await cleanup(); try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); } });

// Test-only observation supplier, not a client lifecycle engine. Actions never settle it.
function SuppliedObservationHost({ intent }: { intent: () => void }) {
  const [fixture, setFixture] = useState('running');
  const base = { romanEnabled: false, onReturnToCoaching: intent };
  return <View>
    <Text>Synthetic supplied observations — not a connected import</Text>
    {['running', 'stale', 'pending', 'unconfirmed', 'unavailable', 'subset', 'zero', 'unreadable'].map(name => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`Supply ${name}`} onPress={() => setFixture(name)}><Text>{name}</Text></Pressable>)}
    {['running', 'stale', 'pending'].includes(fixture) ? <ImportProgressView {...base} observation={fixture === 'stale' ? { freshness: 'stale', lastObservedPhase: 'transferring' } : { freshness: 'current', phase: 'transferring' }} stop={fixture === 'pending' ? 'pending' : 'notRequested'} receiptCount={12} sourceCoverage="unknown" stopAction={{ enabled: true, onPress: intent }} />
      : fixture === 'subset' ? <ImportResultView {...base} outcome="verifiedSubset" receiptCount={12} unconfirmedClientRecords={22} native={{ scope: 'selectedClientRecords', verifiedClientRecords: 8, relationships: 'verified', readback: 'verified' }} />
      : fixture === 'zero' ? <ImportResultView {...base} outcome="provenZero" scope="selectedClientRecords" sourceCoverage="complete" checkedSourceRecords={0} receiptCount={0} unconfirmedClientRecords={0} />
      : fixture === 'unreadable' ? <ImportResultView {...base} outcome="blocked" reason="scopeUnknown" />
      : <ImportResultView {...base} outcome={fixture === 'unconfirmed' ? 'unconfirmed' : 'unavailable'} receiptCount={12} unconfirmedClientRecords={22} />}
  </View>;
}

it('changes only when a synthetic observation is explicitly supplied, never because an intent fired', async () => {
  guards.exerciseGuards();
  const intent = jest.fn(); const v = await render(<SuppliedObservationHost intent={intent} />);
  await fireEvent.press(v.getByRole('button', { name: 'Stop import' })); expect(intent).toHaveBeenCalledTimes(1);
  expect(v.queryByText('Stop requested. Waiting for confirmation.')).toBeNull();
  const expected = [
    ['stale', 'Current status unconfirmed'], ['pending', 'Import in progress'],
    ['unconfirmed', 'Some records are unconfirmed'], ['unavailable', 'The import result is unavailable right now. Check again when you are connected.'],
    ['subset', 'Some records are ready'], ['zero', 'No records were found in the checked scope.'], ['unreadable', 'Import needs attention'],
  ];
  for (const [fixture, title] of expected) {
    await fireEvent.press(v.getByRole('button', { name: `Supply ${fixture}` }));
    expect(v.getByRole('header')).toHaveTextContent(title);
    if (fixture === 'pending') { expect(v.getByText('Stop requested. Waiting for confirmation.')).toBeTruthy(); expect(v.queryByText('Import stopped')).toBeNull(); }
  }
  expect(intent).toHaveBeenCalledTimes(1);
});
