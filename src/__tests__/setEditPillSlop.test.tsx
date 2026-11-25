/**
 * LO-960R2 C2 (FIX-960R2): while the bin's line shows under an open set, the
 * done control ("As planned" pill or the check, one element) has no touch
 * extension below, so a tap just under its lower edge cannot land on the bin
 * and remove an unticked set. Top, left and right keep main's 6 pt; rows
 * without the bin's line keep main's 6 pt on all four sides.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { makeStyles } from '../screens/client/active-workout/styles';

const colors = new Proxy({}, { get: () => '#000000' }) as never;
const last = { weight: 150, reps: 6, completed: false };
const binLine = { top: 6, bottom: 0, left: 6, right: 6 };
const mains = { top: 6, bottom: 6, left: 6, right: 6 };
const pill = 'As planned, mark set 2 done';
const check = 'Mark set 2 done';

type Props = Partial<React.ComponentProps<typeof SetLogger>>;
const cases: { name: string; props: Props; tapOpen?: boolean; form: string; bin: boolean; slop: typeof mains }[] = [
  { name: 'the next set with last time\'s set (the pill)', props: { set: { weight: 155, reps: 6, completed: false }, nextUp: true, previous: last }, form: pill, bin: true, slop: binLine },
  { name: 'an open set with no plan and no last time (the check)', props: { set: { weight: 0, reps: 0, completed: false }, nextUp: true }, form: check, bin: true, slop: binLine },
  { name: 'a ticked set tapped open', props: { set: { weight: 155, reps: 6, completed: true }, previous: last }, tapOpen: true, form: check, bin: true, slop: binLine },
  { name: 'a closed row (main\'s slop)', props: { set: { weight: 155, reps: 6, completed: false }, previous: last }, form: pill, bin: false, slop: mains },
  { name: 'an open row with no remove (main\'s slop)', props: { set: { weight: 155, reps: 6, completed: false }, nextUp: true, previous: last, onRemove: undefined }, form: pill, bin: false, slop: mains },
];

it.each(cases)('C2: the done control\'s touch area under $name', async ({ props, tapOpen, form, bin, slop }) => {
  const view = await render(
    <SetLogger set={{ weight: 0, reps: 0, completed: false }} setIdx={1} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={makeStyles(colors)}
      onRemove={() => undefined} exerciseName="Bench press" {...props} />,
  );
  if (tapOpen) await act(async () => { fireEvent.press(view.getByTestId('set-value-0-1')); });
  expect(view.queryByLabelText('Remove set 2 from Bench press') !== null).toBe(bin);
  const done = view.getByTestId('set-done-0-1');
  expect(done.props.accessibilityLabel).toBe(form);
  expect(done.props.hitSlop).toEqual(slop);
});
