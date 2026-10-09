/**
 * Single-choice steps (K3, K4, K5) move on by themselves a moment after a
 * tap, so the coach sees the choice land (the client consultation's STEP_MS).
 * Another tap restarts the wait; leaving the step cancels it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { STEP_MS } from '../../../consultation/components';

export function useAutoAdvance(onNext: () => void, delayMs: number = STEP_MS): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => next.current(), delayMs);
  }, [delayMs]);
}
