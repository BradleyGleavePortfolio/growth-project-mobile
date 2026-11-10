/**
 * LO-960R1 B1 (lens, agent 203): on an open live set row with last time's set,
 * "Previous" stays on the left of its line (as on main and as styles.ts says:
 * "Previous (when shown) on the left and the remove control on the right"), so
 * the "Use previous" target is not drawn flush against the bin that removes an
 * unticked set at once. HapticPressable puts `style` on its inner Pressable;
 * the flex child of the tools line is its Animated wrapper (containerStyle).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { makeStyles } from '../screens/client/active-workout/styles';

const colors = new Proxy({}, { get: () => '#000000' }) as never;

type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null };
function hostViewsAbove(node: Node, count: number): Node[] {
  const out: Node[] = [];
  let at = node.parent;
  while (at && out.length < count) {
    if (at.type === 'View') out.push(at);
    at = at.parent;
  }
  return out;
}

it('B1: Previous keeps the left of the tools line under an open set; the bin sits right', async () => {
  const view = await render(
    <SetLogger set={{ weight: 155, reps: 6, completed: false }} setIdx={1} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={makeStyles(colors)} nextUp
      previous={{ weight: 150, reps: 6, completed: false }}
      onRemove={() => undefined} exerciseName="Bench press" />,
  );
  expect(view.getByLabelText('Remove set 2 from Bench press')).toBeTruthy();
  const prev = view.getByLabelText('Use previous set 2: 150 pounds, 6 reps') as unknown as Node;
  const [wrapper, line] = hostViewsAbove(prev, 2);
  const grows = (StyleSheet.flatten(wrapper.props.style as never) as { flexGrow?: number }).flexGrow ?? 0;
  const justify = (StyleSheet.flatten(line.props.style as never) as { justifyContent?: string }).justifyContent ?? 'flex-start';
  // Either the Previous wrapper takes the free space, or the line does not push it right.
  expect(grows > 0 || justify === 'space-between' || justify === 'flex-start').toBe(true);
});
