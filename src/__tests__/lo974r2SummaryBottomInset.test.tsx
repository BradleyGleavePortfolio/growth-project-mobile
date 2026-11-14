/**
 * LO-974R2 B-TEST (m#974 @ 4ef7cfad): since 90987f0e the client tab bar hides while the summary is open, so nothing
 * under the summary owns the phone's bottom inset any more (the bar did: 64 pt plus insets.bottom). The summary's
 * Screen keeps edges={[]}, so its pinned Send sits layout.gutter (24 pt) from the bottom edge whatever the inset: on an
 * iPhone (inset 34) its lower 10 pt is in the home-indicator area, on Android three-button navigation (inset 48) its
 * lower 24 pt is under the system bar. C2_summary_ios390_100 draws Send above the home indicator, as the shared
 * footer rule (footerBottomPadding) places a pinned button. Fictional coach and client.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: undefined }) }));
jest.mock('../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach-sam', name: 'Sam Rivers' }] }) }));

import WorkoutSummaryC5, { type WorkoutSummaryC5Props } from '../screens/client/active-workout/WorkoutSummaryC5';
import { footerBottomPadding } from '../ui';

const props = (status: WorkoutSummaryC5Props['status']): WorkoutSummaryC5Props => ({
  assignmentId: 'asg-today', today: '2026-11-13', minutes: 52, sets: 16, volume: 9730, lines: [],
  effort: null, note: '', onEffort: () => undefined, onNote: () => undefined,
  status, sentKey: null, onSend: () => undefined, onTryAgain: () => undefined, onBack: () => undefined,
});

describe.each([
  ['iPhone home indicator', 34],
  ['Android three-button navigation', 48],
])('the summary with no tab bar under it (%s, bottom inset %i pt)', (_name, bottom) => {
  it.each(['open', 'notSent'] as const)('the pinned button (%s) clears the bottom inset as the footer rule places it', async (status) => {
    const view = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom, left: 0, right: 0 }}>
        <WorkoutSummaryC5 {...props(status)} />
      </SafeAreaInsetsContext.Provider>,
    );
    const footer = StyleSheet.flatten(view.getByTestId('workout-summary-c5-footer').props.style) as { paddingBottom?: number };
    expect(footer.paddingBottom).toBeGreaterThanOrEqual(bottom);
    expect(footer.paddingBottom).toBe(footerBottomPadding(bottom));
  });
});
