/**
 * FIX-974R2 (LS-974R2 B2, the class): the not-sent card is drawn at the top of the summary, so every way the page turns
 * not sent brings the page back to the top and speaks the card: the first Send with no answer (open -> sending ->
 * not sent, after the client scrolled to the note) and a Try again with no answer (not sent -> sending -> not sent).
 * Staying not sent (a re-render, the coach's name arriving) does not scroll again. LS-974R2's render test
 * (scripts/review/ls974r2-B2.cjs) measures the card inside the viewport on the web preview. Fictional coach and client.
 */
import React from 'react';
import { AccessibilityInfo, ScrollView } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: undefined }) }));
jest.mock('../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach-sam', name: 'Sam Rivers' }] }) }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import WorkoutSummaryC5, { type WorkoutSummaryC5Props } from '../screens/client/active-workout/WorkoutSummaryC5';

type Status = WorkoutSummaryC5Props['status'];
const props = (status: Status): WorkoutSummaryC5Props => ({
  assignmentId: 'asg-today', today: '2026-11-13', minutes: 52, sets: 16, volume: 9730, lines: [],
  effort: 8, note: 'Felt good.', onEffort: () => undefined, onNote: () => undefined,
  status, sentKey: null, onSend: () => undefined, onTryAgain: () => undefined, onBack: () => undefined,
});
const CARD = 'Not sent to Sam yet. Your sets are safe on this phone. They go to Sam when the connection is back, or you can try now.';
const scrollTo = (ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;

describe.each<[string, Status[], number]>([
  ['the first Send has no answer', ['open', 'sending', 'notSent'], 1],
  ['a Try again has no answer', ['notSent', 'sending', 'notSent'], 2],
  ['the page stays not sent (a re-render)', ['notSent', 'notSent', 'notSent'], 1],
  ['the page never turns not sent', ['open', 'sending', 'open'], 0],
])('%s', (_case, steps, times) => {
  it(`comes back to the card at the top ${times} time(s) and speaks it as often`, async () => {
    scrollTo.mockClear();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const view = await render(<WorkoutSummaryC5 {...props(steps[0])} />);
    for (const status of steps.slice(1)) await view.rerender(<WorkoutSummaryC5 {...props(status)} />);
    expect(scrollTo).toHaveBeenCalledTimes(times);
    for (const call of scrollTo.mock.calls) expect(call[0]).toEqual({ y: 0, animated: true });
    expect(announce).toHaveBeenCalledTimes(times);
    for (const call of announce.mock.calls) expect(call[0]).toBe(CARD);
    if (steps[steps.length - 1] === 'notSent') expect(view.getByTestId('summary-not-sent')).toBeTruthy();
    announce.mockRestore();
  });
});
