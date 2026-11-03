/**
 * FR-917R2 (B4): "As planned" belongs to the live workout only. The history
 * edit (WorkoutHistoryEditScreen) draws SetLogger with hideCompletion and keeps
 * main's row: no pill and the same blank space after the reps box.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';

// Each style key resolves to a marker style, so the test can find the spacer.
const styles = new Proxy({}, { get: (_t, key: string) => ({ testKey: key }) }) as never;
const colors = new Proxy({}, { get: () => '#000000' }) as never;
const spacers = (view: { toJSON: () => unknown }) =>
  (JSON.stringify(view.toJSON()).match(/"testKey":"previousSet"/g) ?? []).length;

function row(hideCompletion: boolean) {
  return render(
    <SetLogger set={{ weight: 100, reps: 8, completed: false }} setIdx={0} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={styles} hideCompletion={hideCompletion} />,
  );
}

it('history edit: no "As planned" and the spacer after the reps box stays, as on main', async () => {
  const view = await row(true);
  expect(view.queryByText('As planned')).toBeNull();
  expect(spacers(view)).toBeGreaterThan(0);
});

it('control: the live workout row has "As planned" and no spacer', async () => {
  const view = await row(false);
  expect(view.getByText('As planned')).toBeTruthy();
  expect(spacers(view)).toBe(0);
});
