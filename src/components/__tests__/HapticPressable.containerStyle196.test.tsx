/**
 * PEEK-K1-M: `containerStyle` lays out HapticPressable's animated wrapper, so a button can fill one half of a row
 * of equal halves (the peek's Message {first} and Send nudge grow together when a long name wraps).
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import HapticPressable from '../HapticPressable';

jest.mock('../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn().mockResolvedValue(undefined), ImpactFeedbackStyle: { Light: 'light' } }));

type Node = { parent: Node | null; props: { style?: unknown } } | null;
// The animated wrapper: the nearest host ancestor carrying the press transform.
function wrapper(n: Node): Record<string, unknown> {
  for (let p = n?.parent ?? null; p; p = p.parent) {
    const f = StyleSheet.flatten(p.props.style as never) as Record<string, unknown> | undefined;
    if (f && 'transform' in f) return f;
  }
  throw new Error('no animated wrapper');
}

describe('HapticPressable containerStyle', () => {
  it('puts containerStyle on the wrapper and keeps style on the pressable', async () => {
    const view = await render(
      <HapticPressable onPress={jest.fn()} containerStyle={{ flex: 1 }} style={{ minHeight: 54 }} testID="btn"><Text>Send nudge</Text></HapticPressable>,
    );
    const btn = view.getByTestId('btn');
    expect(StyleSheet.flatten(btn.props.style).minHeight).toBe(54);
    expect(wrapper(btn as unknown as Node).flex).toBe(1);
  });

  it('without containerStyle the wrapper has no layout of its own (every other caller unchanged)', async () => {
    const view = await render(<HapticPressable onPress={jest.fn()} testID="btn"><Text>Save</Text></HapticPressable>);
    expect(wrapper(view.getByTestId('btn') as unknown as Node).flex).toBeUndefined();
  });
});
