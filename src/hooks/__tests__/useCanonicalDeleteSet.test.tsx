/**
 * useCanonicalDeleteSet.test — D7B canonical delete-set contract (prior audit F1).
 *
 * The canonical delete-set is the single owner of the removed-row bookkeeping
 * the workout builder uses to keep a deleted row deleted across an autosave
 * adoption cycle (D-045). The defect F1 was that the UNDO restore path never
 * cleared these markers, so re-adding a deleted row left it marked deleted and
 * the next adoption silently re-dropped it. This suite pins the mark→unmark
 * cycle that fix depends on.
 *
 * RNTL v14 + React 19: `await renderHook(...)` (NEVER sync). The hook is
 * refs-only (no state → no re-render), and its returned API object is
 * referentially stable (all-stable useCallback deps). We therefore capture the
 * API ONCE after render and drive it directly: re-reading `result.current`
 * across multiple synchronous `act()` calls is unreliable under React 19 (the
 * renderer detaches `current` when no re-render is scheduled), and since these
 * methods mutate refs (not state) no `act()` wrapper is required at all.
 */

import { renderHook } from '@testing-library/react-native';
import { useCanonicalDeleteSet } from '../useCanonicalDeleteSet';

describe('useCanonicalDeleteSet', () => {
  it('starts empty: nothing is marked deleted', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    expect(api.isDeleted('c-1')).toBe(false);
    expect(api.hasSignature('sig-1')).toBe(false);
  });

  it('markDeleted records both the clientId key and the signature entry', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    expect(api.isDeleted('c-1')).toBe(true);
    expect(api.hasSignature('sig-A')).toBe(true);
  });

  // The mark→unmark cycle that F1's fix relies on: after a delete is undone the
  // row must NO LONGER be marked deleted, so a later adoption keeps it.
  it('unmarkDeleted reverses markDeleted (the undo restore path)', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    expect(api.isDeleted('c-1')).toBe(true);

    api.unmarkDeleted('c-1', 'sig-A');
    expect(api.isDeleted('c-1')).toBe(false);
    expect(api.hasSignature('sig-A')).toBe(false);
  });

  it('keeps per-signature FIFO lists one-for-one (two identical rows)', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-dup');
    api.markDeleted('c-2', 'sig-dup');
    expect(api.hasSignature('sig-dup')).toBe(true);
    // Unmark one — the signature is still pending for the second row.
    api.unmarkDeleted('c-1', 'sig-dup');
    expect(api.isDeleted('c-1')).toBe(false);
    expect(api.isDeleted('c-2')).toBe(true);
    expect(api.hasSignature('sig-dup')).toBe(true);
    // Unmark the second — now the signature pool is empty.
    api.unmarkDeleted('c-2', 'sig-dup');
    expect(api.hasSignature('sig-dup')).toBe(false);
  });

  it('unmarkDeleted consumes the oldest entry when the clientId is absent', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    api.markDeleted('c-2', 'sig-A');
    // A fresh clientId (the re-added row's new id) is not in the list; we still
    // consume one pending signature entry so the pool drains correctly.
    api.unmarkDeleted('fresh-id', 'sig-A');
    expect(api.hasSignature('sig-A')).toBe(true); // one left
    api.unmarkDeleted('fresh-id', 'sig-A');
    expect(api.hasSignature('sig-A')).toBe(false);
  });

  it('unmarkDeleted on an unmarked key/signature is a harmless no-op', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    expect(() => api.unmarkDeleted('never', 'nope')).not.toThrow();
    expect(api.isDeleted('never')).toBe(false);
  });

  it('snapshotSignatures returns an independent copy (mutating it does not affect the set)', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    const snap = api.snapshotSignatures();
    snap.get('sig-A')?.pop(); // mutate the copy
    // The canonical set is unchanged.
    expect(api.hasSignature('sig-A')).toBe(true);
  });

  it('unmarkByClientId clears the key only (adoption cleanup path)', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    api.unmarkByClientId('c-1');
    expect(api.isDeleted('c-1')).toBe(false);
  });

  it('reset clears everything', async () => {
    const { result } = await renderHook(() => useCanonicalDeleteSet());
    const api = result.current;
    api.markDeleted('c-1', 'sig-A');
    api.markDeleted('c-2', 'sig-B');
    api.reset();
    expect(api.isDeleted('c-1')).toBe(false);
    expect(api.isDeleted('c-2')).toBe(false);
    expect(api.hasSignature('sig-A')).toBe(false);
    expect(api.hasSignature('sig-B')).toBe(false);
  });
});
