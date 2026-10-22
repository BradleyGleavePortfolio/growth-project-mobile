/**
 * The coach Home's win turn as a cross-fade (owner #167-1, on m#688 OD-2): the old win fades out while the new one
 * fades in, so no frame pops or is empty, on a turn, on a re-read that drops the win on screen (LO/LS B1), and for the
 * first win over the empty line (LO C1); one win never turns; Reduce Motion and screen readers keep it still, the row
 * then fitting the one win (LO C2); the fade ends rather than runs while the Home is not in front; a tap mid-fade still
 * reaches the hero.
 */
import React from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { WIN_FADE_MS, WIN_TURN_MS, WinTurn, useWinTurn } from '../screens/coach/home-v11/WinTurn';
import type { HomeWin } from '../screens/coach/home-v11/homeDay';

const w = (id: string): HomeWin => ({ id, kind: 'streak', client: { id: `c-${id}`, name: id }, value: 3, at: '2026-10-22T10:00:00Z' } as unknown as HomeWin);
const onPress = jest.fn();

const line = (x: HomeWin, id?: string) => <Text testID={id}>{x.id}</Text>;
const empty = <Text testID="home-win-none">none</Text>;

/** The screen's wiring (CoachHomeV11.tsx), on its own. */
function Hero({ wins, live = true }: { wins: HomeWin[]; live?: boolean }) {
  const { turn, still } = useWinTurn(live ? wins.length : 0);
  const newest = wins.slice(0, 3);
  const shown = newest.length > 0 ? newest[turn % newest.length] : null;
  return (
    <Pressable onPress={onPress} testID="hero">
      <WinTurn wins={still && shown ? [shown] : newest} shown={shown} live={live} line={line} empty={empty} />
    </Pressable>
  );
}

type R = Awaited<ReturnType<typeof render>>;
/** The opacity a win's layer draws at (the nearest parent of its line that sets one). */
const opacity = (r: R, id: string | ReturnType<R['getByText']>) => {
  for (let n = (typeof id === 'string' ? r.getByTestId(`home-win-${id}`, { includeHiddenElements: true }) : id).parent; n; n = n.parent) {
    const o = StyleSheet.flatten(n.props.style)?.opacity;
    if (o !== undefined) return o;
  }
  return undefined;
};
/** The style of a win's layer (the full-width view it sits in). */
const layer = (r: R, id: string) => {
  for (let n = r.getByTestId(`home-win-${id}`, { includeHiddenElements: true }).parent; n; n = n.parent) {
    const st = StyleSheet.flatten(n.props.style);
    if (st?.width === '100%') return st;
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
    for (const id of ['w2', 'w3', 'w1']) { await tick(WIN_TURN_MS); expect(opacity(r, id)).toBe(0); await endFade(); expect(opacity(r, id)).toBe(1); }
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

  it('a re-read that drops the win on screen from the newest three keeps it drawn, over the row, until its fade ends (LO B1)', async () => {
    const r = await render(<Hero wins={[w('w1'), w('w2'), w('w3')]} />);
    await tick(0);
    for (let k = 0; k < 2; k += 1) { await tick(WIN_TURN_MS); await endFade(); }
    expect(opacity(r, 'w3')).toBe(1);
    // A new win comes in while w3 shows: the newest three are now w0, w1, w2 and the turn lands on w2.
    await act(async () => { await r.rerender(<Hero wins={[w('w0'), w('w1'), w('w2'), w('w3')]} />); });
    expect(opacity(r, 'w3')).toBe(1);
    expect(opacity(r, 'w2')).toBe(0);
    expect(layer(r, 'w3')).toEqual(expect.objectContaining({ position: 'absolute' })); // out of the flow: the row keeps its height
    expect(layer(r, 'w2')?.position).toBeUndefined();
    await endFade();
    expect(r.queryByTestId('home-win-w3', { includeHiddenElements: true })).toBeNull();
    expect(opacity(r, 'w2')).toBe(1);
  });

  it('a refresh that pushes the settled third win out never leaves the line empty (LS B1)', async () => {
    const oldWins = [w('w1'), w('w2'), w('w3')];
    const nextWins = [w('w0'), oldWins[0], oldWins[1]];
    const r = await render(<WinTurn wins={oldWins} shown={oldWins[2]} live line={line} empty={empty} />);
    await act(async () => { await r.rerender(<WinTurn wins={nextWins} shown={nextWins[2]} live line={line} empty={empty} />); });
    const drawn = r.getAllByText(/^w\d$/, { includeHiddenElements: true }).map((n) => `${String(n.props.children)}:${String(opacity(r, n))}`);
    expect(drawn.filter((d) => !d.endsWith(':0'))).toEqual(['w3:1']); // the leaving win, at full on the first frame
    expect(opacity(r, 'w2')).toBe(0);
  });

  it('the first win of the week fades in over the empty line, and the empty line fades back in when the wins go (LO C1)', async () => {
    const r = await render(<Hero wins={[]} />);
    await tick(0);
    expect(r.getByTestId('home-win-none')).toBeTruthy();
    await act(async () => { await r.rerender(<Hero wins={[w('w1')]} />); });
    expect(opacity(r, 'none')).toBe(1);
    expect(opacity(r, 'w1')).toBe(0);
    expect(layer(r, 'none')).toEqual(expect.objectContaining({ position: 'absolute' }));
    await endFade();
    expect(r.queryByTestId('home-win-none', { includeHiddenElements: true })).toBeNull();
    expect(opacity(r, 'w1')).toBe(1);
    await act(async () => { await r.rerender(<Hero wins={[]} />); });
    expect([opacity(r, 'w1'), opacity(r, 'none')]).toEqual([1, 0]);
    await endFade();
    expect(r.queryByTestId('home-win-w1', { includeHiddenElements: true })).toBeNull();
    expect(r.getByTestId('home-win-none')).toBeTruthy();
  });

  it('sizes the row to the one win shown when nothing turns, and to the newest three when they do (LO C2)', async () => {
    const turning = await render(<Hero wins={[w('w1'), w('w2'), w('w3')]} />);
    await tick(0);
    expect(['w1', 'w2', 'w3'].map((id) => turning.queryAllByText(id, { includeHiddenElements: true }).length)).toEqual([1, 1, 1]);
    await act(async () => { await turning.unmount(); });
    a11y(true, false);
    const still = await render(<Hero wins={[w('w1'), w('w2'), w('w3')]} />);
    await tick(0);
    expect(['w1', 'w2', 'w3'].map((id) => still.queryAllByText(id, { includeHiddenElements: true }).length)).toEqual([1, 0, 0]);
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
