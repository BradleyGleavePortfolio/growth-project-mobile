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

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 200));
    expect(result.current).toBe('hello');
  });

  it('lags on rapid updates and only settles after the delay', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(result.current).toBe('abc');
  });

  it('with delayMs <= 0 settles synchronously', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 0 } },
    );
    rerender({ value: 'b', delay: 0 });
    expect(result.current).toBe('b');
  });
});
