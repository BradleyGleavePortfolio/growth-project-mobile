/**
 * AIBudgetMount — focus-gated polling test (Round-2 fix NEW-P2-1).
 *
 * The component composes the `enabled` prop with `useIsFocused()` and
 * passes the AND through to `useAIBudget`. The Round-1 audit confirmed
 * the wiring by code-review + the hook-level `enabled:false` test, but
 * flagged the missing dedicated behavioural test as NEW-P2-1: a refactor
 * that drops the `useIsFocused()` call would not be caught by anything
 * else in the suite.
 *
 * What this test asserts:
 *   1. When `useIsFocused()` returns false, `useAIBudget` is called
 *      with `{ enabled: false }` regardless of the `enabled` prop.
 *   2. When `useIsFocused()` returns true AND `enabled` prop is true,
 *      `useAIBudget` is called with `{ enabled: true }`.
 *   3. When `useIsFocused()` returns true BUT `enabled` prop is false,
 *      `useAIBudget` is called with `{ enabled: false }` (defence in
 *      depth — both gates must agree).
 *
 * Test strategy: mock `@react-navigation/native` so `useIsFocused` is a
 * controllable jest.fn(); mock `useAIBudget` to a spy that records its
 * call args and returns a stable empty-loading shape so the component
 * short-circuits on the first render (no `budget` → returns null/slot).
 * Then render the component twice (once focused, once unfocused) and
 * assert on the spy.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the import of the component under test so jest
// hoisting wires them up before the component module is evaluated.
// ---------------------------------------------------------------------------

const mockUseIsFocused = jest.fn<boolean, []>();
const mockNavigate = jest.fn();

// @sentry/react-native starts a module-load setInterval (its AsyncExpiringMap
// cleanup loop, pulled in transitively via ErrorBoundary -> services/sentry).
// That interval is the open handle behind the "Jest did not exit" warning for
// this suite -- it is unrelated to anything under test here. Stub the module to
// a set of inert no-ops so no background timer is ever scheduled.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: <T,>(c: T): T => c,
  withScope: (fn: (scope: { setExtra: jest.Mock }) => void) =>
    fn({ setExtra: jest.fn() }),
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockUseIsFocused(),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

// Spy that captures the options arg `useAIBudget(...)` is called with.
// Returns a stable "loading, no data" shape so the component renders
// nothing (return path at the `if (!budget || surface === 'hidden')`
// branch) and we avoid having to mock the sub-surfaces.
const mockUseAIBudget = jest.fn<{ data: undefined }, [unknown]>(() => ({
  data: undefined,
}));

jest.mock('../../../../hooks/useAIBudget', () => ({
  useAIBudget: (opts: unknown) => mockUseAIBudget(opts),
}));

// expo-haptics is touched transitively via tutorial/hardpause/banner sub-
// components — even though we never render them in this test (budget is
// undefined → early-return), some of those modules import expo-haptics at
// module-load. Match the pattern used by the sibling tests.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

import { AIBudgetMount } from '../AIBudgetMount';

describe('AIBudgetMount — focus-gated polling (NEW-P2-1)', () => {
  beforeEach(() => {
    mockUseIsFocused.mockReset();
    mockUseAIBudget.mockClear();
    mockNavigate.mockClear();
  });

  it('passes { enabled: false } to useAIBudget when the screen is NOT focused', () => {
    mockUseIsFocused.mockReturnValue(false);
    render(<AIBudgetMount enabled />);

    // The hook must have been called at least once during render.
    expect(mockUseAIBudget).toHaveBeenCalled();
    // The most recent call's first arg should carry `enabled: false`.
    // We assert via `expect.objectContaining` so the test does not pin
    // future additional options the hook may accept.
    expect(mockUseAIBudget).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('passes { enabled: true } to useAIBudget when focused AND enabled prop is true', () => {
    mockUseIsFocused.mockReturnValue(true);
    render(<AIBudgetMount enabled />);

    expect(mockUseAIBudget).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('passes { enabled: false } when the `enabled` prop is false even if focused', () => {
    mockUseIsFocused.mockReturnValue(true);
    render(<AIBudgetMount enabled={false} />);

    // Defence-in-depth: an unsubscribed/non-coach user must NOT trigger
    // budget polling regardless of focus state. The AND of (enabled,
    // isFocused) must collapse to false here.
    expect(mockUseAIBudget).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('defaults `enabled` prop to true when omitted (focus still gates)', () => {
    mockUseIsFocused.mockReturnValue(false);
    render(<AIBudgetMount />);

    // Component default is `enabled = true` (line 57 in source). With
    // `useIsFocused()=false`, the composed value is still false.
    expect(mockUseAIBudget).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
