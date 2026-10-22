/**
 * The coach Home's win turn as a cross-fade (owner #167-1, on m#688 OD-2): the old win fades out while the new one
 * fades in, so no frame pops or is empty; one win never turns; Reduce Motion and screen readers keep it still; the
 * fade ends rather than runs while the Home is not in front; a tap mid-fade still reaches the hero.
 */
import React from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { WIN_FADE_MS, WIN_TURN_MS, WinTurn, useWinTurn } from '../screens/coach/home-v11/WinTurn';
import type { HomeWin } from '../screens/coach/home-v11/homeDay';

const w = (id: string): HomeWin => ({ id, kind: 'streak', client: { id: `c-${id}`, name: id }, value: 3, at: '2026-10-22T10:00:00Z' } as unknown as HomeWin);
const onPress = jest.fn();

function Hero({ wins, live = true }: { wins: HomeWin[]; live?: boolean }) {
  const turn = useWinTurn(live ? wins.length : 0);
  const newest = wins.slice(0, 3);
  return (
    <Pressable onPress={onPress} testID="hero">
      <WinTurn wins={newest} shown={newest[turn % newest.length]} live={live} line={(x, id) => <Text testID={id}>{x.id}</Text>} />
    </Pressable>
  );
}

/** The opacity a win's layer draws at (the nearest parent of its line that sets one). */
const opacity = (r: Awaited<ReturnType<typeof render>>, id: string) => {
  for (let n = r.getByTestId(`home-win-${id}`, { includeHiddenElements: true }).parent; n; n = n.parent) {
    const o = StyleSheet.flatten(n.props.style)?.opacity;
    if (o !== undefined) return o;
  }
  return undefined;
};
/** Animated.timing held by hand: a fade runs until the test ends it, so "mid-fade" is exact. */
let fades: { config: Animated.TimingAnimationConfig; end: (finished: boolean) => void; stop: jest.Mock }[] = [];
const endFade = async () => { await act(async () => { fades[fades.length - 1].end(true); }); };
const tick = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const a11y = (rm: boolean, sr: boolean) => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(rm);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(sr);
};

beforeEach(() => {
  jest.useFakeTimers(); onPress.mockClear(); a11y(false, false); fades = [];
  jest.spyOn(Animated, 'timing').mockImplementation((v, config) => {
    const f = { config, end: (_f: boolean) => undefined as void, stop: jest.fn() };
    fades.push(f);
    const start = (cb?: Animated.EndCallback) => { f.end = (finished) => { if (finished) (v as Animated.Value).setValue(config.toValue as number); cb?.({ finished }); }; };
    return { start, stop: f.stop, reset: jest.fn() } as unknown as Animated.CompositeAnimation;
  });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('the win turn cross-fades (#167-1)', () => {
  it('keeps both wins on screen during the fade, the old going out as the new comes in, and ends with only the new one', async () => {
    const r = await render(<Hero wins={[w('w1'), w('w2'), w('w3')]} />);
    await tick(0);
    expect(opacity(r, 'w1')).toBe(1);
    expect(r.queryByTestId('home-win-w2', { includeHiddenElements: true })).toBeNull();
    expect(fades).toHaveLength(0);
    await tick(WIN_TURN_MS);
    // Mid-fade: both are there, the old from full down and the new from nothing up, on one value, so no frame is empty.
    expect(fades).toHaveLength(1);
    expect(fades[0].config).toEqual(expect.objectContaining({ toValue: 1, duration: WIN_FADE_MS, useNativeDriver: true }));
    expect(opacity(r, 'w1')).toBe(1);
    expect(opacity(r, 'w2')).toBe(0);
    await endFade();
    expect(r.queryByTestId('home-win-w1', { includeHiddenElements: true })).toBeNull();
    expect(opacity(r, 'w2')).toBe(1);
  });

  it('turns only the newest three, back to the first after the third', async () => {
    const r = await render(<Hero wins={[w('w1'), w('w2'), w('w3'), w('w4')]} />);
    await tick(0);
    for (const id of ['w2', 'w3', 'w1']) { await tick(WIN_TURN_MS); await endFade(); expect(opacity(r, id)).toBe(1); }
    expect(r.queryByTestId('home-win-w4', { includeHiddenElements: true })).toBeNull();
  });

  it('never turns one win', async () => {
    const r = await render(<Hero wins={[w('w1')]} />);
    await tick(WIN_TURN_MS * 3);
    expect(fades).toHaveLength(0);
    expect(opacity(r, 'w1')).toBe(1);
  });

  it.each([['Reduce Motion', true, false], ['a screen reader', false, true]])('holds still with %s on, as m#688 built it', async (_n, rm, sr) => {
    a11y(rm, sr);
    const r = await render(<Hero wins={[w('w1'), w('w2')]} />);
    await tick(WIN_TURN_MS * 3);
    expect(fades).toHaveLength(0);
    expect(opacity(r, 'w1')).toBe(1);
    expect(r.queryByTestId('home-win-w2', { includeHiddenElements: true })).toBeNull();
  });

  it('with Reduce Motion, a new newest win from a re-read still fades in, never pops', async () => {
    a11y(true, false);
    const r = await render(<Hero wins={[w('w1'), w('w2')]} />);
    await tick(0);
    await act(async () => { await r.rerender(<Hero wins={[w('w0'), w('w1'), w('w2')]} />); });
    expect(opacity(r, 'w0')).toBe(0);
    expect(opacity(r, 'w1')).toBe(1);
    await endFade();
    expect(opacity(r, 'w0')).toBe(1);
    expect(r.queryByTestId('home-win-w1', { includeHiddenElements: true })).toBeNull();
  });

  it('ends a fade under way when the Home leaves the front, and starts no turn off screen', async () => {
    const r = await render(<Hero wins={[w('w1'), w('w2'), w('w3')]} />);
    await tick(WIN_TURN_MS);
    expect(r.getByTestId('home-win-w1', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => { await r.rerender(<Hero wins={[w('w1'), w('w2'), w('w3')]} live={false} />); });
    await tick(0);
    expect(fades[0].stop).toHaveBeenCalled();
    expect(r.queryByTestId('home-win-w1', { includeHiddenElements: true })).toBeNull();
    expect(opacity(r, 'w2')).toBe(1);
    await tick(WIN_TURN_MS * 3);
    expect(fades).toHaveLength(1);
    expect(opacity(r, 'w2')).toBe(1);
  });

  it('a tap mid-fade still reaches the hero', async () => {
    const r = await render(<Hero wins={[w('w1'), w('w2')]} />);
    await tick(WIN_TURN_MS);
    await fireEvent.press(r.getByTestId('home-win-w1', { includeHiddenElements: true }));
    await fireEvent.press(r.getByTestId('home-win-w2', { includeHiddenElements: true }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
