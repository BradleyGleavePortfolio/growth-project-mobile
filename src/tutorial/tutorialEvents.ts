/**
 * tutorialEvents — a dependency-free signal bus for the client tutorial.
 *
 * Real product code emits a signal at the moment a real action succeeds
 * (a food entry saved or accepted by the offline queue, a message to the
 * coach returned 2xx, a wearable permission granted, an explanation card
 * opened). The tutorial store subscribes and advances its step machine only
 * on these signals, so every gated step is completed by the genuine action,
 * never by a simulated tap.
 *
 * Emitting with no subscriber is a no-op, so call sites stay unconditional
 * and the feature flag only needs to gate the tutorial itself. This module
 * imports nothing, so `services/api.ts` can depend on it without a cycle.
 */
import type { TutorialSignal } from './types';

type Listener = (signal: TutorialSignal) => void;

const listeners = new Set<Listener>();

export function emitTutorialSignal(signal: TutorialSignal): void {
  for (const l of Array.from(listeners)) {
    try {
      l(signal);
    } catch {
      // A tutorial listener must never break the real action that emitted.
    }
  }
}

export function subscribeTutorialSignals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Pass a promise through unchanged and emit `signal` when it resolves. A
 * rejection propagates untouched and emits nothing.
 */
export function withTutorialSignal<T>(p: Promise<T>, signal: TutorialSignal): Promise<T> {
  return Promise.resolve(p).then((value) => {
    emitTutorialSignal(signal);
    return value;
  });
}
