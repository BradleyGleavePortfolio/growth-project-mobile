/**
 * Shared test fixture for mocking `AccessibilityInfo.addEventListener`.
 *
 * `addEventListener` resolves to `EmitterSubscription`. The only behaviour any
 * test exercises is `remove()` (invoked from the listener-cleanup effect); the
 * remaining members of `EmitterSubscription` are internal emitter/vendor
 * bookkeeping that the components under test never read.
 *
 * A `remove`-only stub cannot be widened to the full type with a plain
 * `as EmitterSubscription` (TS rejects the partial overlap), and the Bradley R0
 * LAW forbids the double-cast / wildcard-cast escapes. The blessed escape that
 * R0 explicitly permits is `@ts-expect-error` with a justification — applied
 * once here so all call sites share a single, intentional, self-failing seam:
 * if a future test ever depends on a field beyond `remove`, this stub must grow
 * and the directive keeps the gap visible.
 */
import { type EmitterSubscription } from 'react-native';

export function makeAccessibilitySubscription(): EmitterSubscription {
  // @ts-expect-error — intentional remove-only stub; cleanup only calls remove()
  return { remove: jest.fn() };
}
