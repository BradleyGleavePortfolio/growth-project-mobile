// Stage 3 — debounce hook (powers UniversalClientSearch).

import { act, renderHook } from '@testing-library/react-native';
import { useDebouncedValue } from '../useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the initial value immediately', async () => {
    const { result } = await renderHook(() => useDebouncedValue('hello', 200));
    expect(result.current).toBe('hello');
  });

  it('lags on rapid updates and only settles after the delay', async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    );
    await rerender({ value: 'ab' });
    await rerender({ value: 'abc' });
    expect(result.current).toBe('a');

    await act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(result.current).toBe('a');

    await act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(result.current).toBe('abc');
  });

  it('with delayMs <= 0 settles synchronously', async () => {
    const { result, rerender } = await renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 0 } },
    );
    await rerender({ value: 'b', delay: 0 });
    expect(result.current).toBe('b');
  });
});
