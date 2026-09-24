import './sideEffectGuards.cjs';
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { ImportProgressView, ImportProgressViewProps } from '../ImportProgressView';
import { ImportResultView } from '../ImportResultView';

const guards = require('./sideEffectGuards.cjs');
const observedAt = { epochMs: 1789740000000, locale: 'en-US', timeZone: 'UTC' };
const progress = (): ImportProgressViewProps => ({
  romanEnabled: false, observation: { freshness: 'current', phase: 'finding' },
  stop: 'notRequested', sourceCoverage: 'unknown', receiptCount: 12, observedAt,
  onReturnToCoaching: jest.fn(),
});
beforeEach(() => {
  // The RN preset already supplies jest.fn APIs; restoring spies alone does not
  // clear those original mocks' call histories between cases.
  jest.clearAllMocks();
  guards.installGuards();
});
afterEach(async () => {
  await cleanup();
  try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); }
});

// Request policy only. These spies do not establish VoiceOver delivery or ordering.
it.each([false, true])('queues iOS phase changes once, with no initial/focus duplication (entry=%s)', async focusOnMount => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  const plain = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
  const props = { ...progress(), focusOnMount };
  const v = await render(<ImportProgressView {...props} />);
  expect(announce).not.toHaveBeenCalled();
  const initialFocusCalls = focus.mock.calls.length;
  await v.rerender(<ImportProgressView {...props} observation={{ freshness: 'current', phase: 'transferring' }} />);
  expect(announce.mock.calls).toEqual([['Import in progress\nTransferring records', { queue: true }]]);
  await v.rerender(<ImportProgressView {...props} observation={{ freshness: 'current', phase: 'transferring' }} receiptCount={99} observedAt={{ ...observedAt, epochMs: observedAt.epochMs + 60000 }} />);
  expect(announce).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportProgressView {...props} observation={{ freshness: 'current', phase: 'checking' }} />);
  expect(announce.mock.calls).toEqual([
    ['Import in progress\nTransferring records', { queue: true }],
    ['Import in progress\nChecking records in TGP', { queue: true }],
  ]);
  await v.rerender(<ImportProgressView {...props} observation={{ freshness: 'current', phase: 'checking' }} focusOnMount={!focusOnMount} romanEnabled />);
  expect(announce).toHaveBeenCalledTimes(2);
  expect(focus).toHaveBeenCalledTimes(initialFocusCalls);
  expect(plain).not.toHaveBeenCalled();
});

it('announces iOS freshness and stop changes once per meaningful message, not retained phases', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
  const props = progress();
  const v = await render(<ImportProgressView {...props} />);
  await v.rerender(<ImportProgressView {...props} stop="pending" />);
  const pending = 'Import in progress\nFinding records\nStop requested. Waiting for confirmation.';
  expect(announce.mock.calls).toEqual([[pending, { queue: true }]]);
  await v.rerender(<ImportProgressView {...props} stop="pending" observation={{ freshness: 'stale', lastObservedPhase: 'finding' }} />);
  const stale = "Current status unconfirmed\nUpdates are unavailable. The import's current status has not been confirmed.";
  expect(announce).toHaveBeenLastCalledWith(`${stale}\nStop requested. Waiting for confirmation.`, { queue: true });
  await v.rerender(<ImportProgressView {...props} stop="pending" observation={{ freshness: 'unavailable', lastObservedPhase: 'checking' }} receiptCount={55} />);
  expect(announce).toHaveBeenCalledTimes(2);
  await v.rerender(<ImportProgressView {...props} stop="offline" />);
  expect(announce).toHaveBeenLastCalledWith(`${stale}\nThis phone is offline. Stop the import from the extension on your computer.`, { queue: true });
  expect(announce).toHaveBeenCalledTimes(3);
  await v.rerender(<ImportProgressView {...props} />);
  expect(announce).toHaveBeenLastCalledWith('Import in progress\nFinding records', { queue: true });
  expect(announce).toHaveBeenCalledTimes(4);
  expect(focus).not.toHaveBeenCalled();
});

it('announces iOS result heading transitions, but not quantities, time, or unchanged headings', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
  const props = { romanEnabled: false, onReturnToCoaching: jest.fn(), receiptCount: 12, unconfirmedClientRecords: 22, observedAt };
  const v = await render(<ImportResultView {...props} outcome="unconfirmed" />);
  expect(announce).not.toHaveBeenCalled();
  await v.rerender(<ImportResultView {...props} outcome="unconfirmed" receiptCount={13} unconfirmedClientRecords={21} observedAt={{ ...observedAt, epochMs: observedAt.epochMs + 60000 }} />);
  expect(announce).not.toHaveBeenCalled();
  await v.rerender(<ImportResultView {...props} outcome="unavailable" />);
  expect(announce.mock.calls).toEqual([['The import result is unavailable right now. Check the current result again.', { queue: true }]]);
  await v.rerender(<ImportResultView {...props} outcome="unavailable" />);
  expect(announce).toHaveBeenCalledTimes(1);
  await v.rerender(<ImportResultView {...props} outcome="cancelled" />);
  expect(announce).toHaveBeenLastCalledWith('Import stopped', { queue: true });
  expect(announce).toHaveBeenCalledTimes(2);
  expect(focus).not.toHaveBeenCalled();
});

it.each(['android', 'web'] as const)('does not add imperative announcements on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  const plain = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const props = progress();
  const v = await render(<ImportProgressView {...props} />);
  await v.rerender(<ImportProgressView {...props} observation={{ freshness: 'current', phase: 'transferring' }} stop="pending" />);
  expect(v.getByRole('header').props.accessibilityLiveRegion).toBe('polite');
  expect(v.getByText('Transferring records').props.accessibilityLiveRegion).toBe('polite');
  expect(v.getByText('Stop requested. Waiting for confirmation.').props.accessibilityLiveRegion).toBe('polite');
  expect(announce).not.toHaveBeenCalled();
  expect(plain).not.toHaveBeenCalled();
});
