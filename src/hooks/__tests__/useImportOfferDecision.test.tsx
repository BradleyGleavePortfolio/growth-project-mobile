/**
 * useImportOfferDecision — account-scoped offer-decision state (UX-01 J0/J1).
 *
 * Pins the properties a Home-card host relies on:
 *   - disabled → inert (no storage read, no write, `disabled`),
 *   - identity unknown → `unresolved`, and an answer is REFUSED, never bound to
 *     a guessed owner,
 *   - identity known → `loading` (render nothing) → `ready` with that coach's
 *     own persisted answer or null,
 *   - recording an answer reflects immediately, is written under the owner's
 *     key, and the latest answer is also the last one on disk,
 *   - account switch on a live mount resets before the new coach's read so the
 *     previous coach's card never shows, and a stale read for the previous
 *     coach is discarded,
 *   - a write that lands after sign-out is removed again and reported false,
 *   - a failed write keeps the in-memory answer, reports false, and re-offers
 *     on the next mount (no "saved" claim possible).
 *
 * The storage module runs against the AsyncStorage jest mock so persistence and
 * scoping are exercised end to end, not stubbed. Only identity is mocked.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockCurrentUserId: string | null = 'coach-1';
jest.mock('../useCurrentUser', () => ({
  useCurrentUser: () => (mockCurrentUserId ? { id: mockCurrentUserId, email: 'c@x.io' } : null),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));

import { useImportOfferDecision } from '../useImportOfferDecision';
import {
  IMPORT_OFFER_DECISION_VERSION,
  importOfferDecisionKey,
  readImportOfferDecision,
  type ImportOfferDecision,
} from '../../storage/importOfferDecision';

/** Seed an answer as if a previous process had recorded it for `userId`. */
async function seedDecision(userId: string, decision: ImportOfferDecision) {
  await AsyncStorage.setItem(
    importOfferDecisionKey(userId),
    JSON.stringify({ version: IMPORT_OFFER_DECISION_VERSION, userId, decision }),
  );
}

/** A promise the test resolves by hand, to hold a storage call open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (a chained write starting, a late clear) run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const spies: Array<{ mockRestore: () => void }> = [];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCurrentUserId = 'coach-1';
});

afterEach(async () => {
  await cleanup();
  while (spies.length) spies.pop()?.mockRestore();
});

describe('useImportOfferDecision — inert and unresolved states', () => {
  it('is inert when disabled: no storage read, no write, status disabled', async () => {
    const getSpy = jest.spyOn(AsyncStorage, 'getItem');
    spies.push(getSpy);
    const { result } = await renderHook(() => useImportOfferDecision(false));
    expect(result.current.status).toBe('disabled');
    expect(result.current.decision).toBeNull();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.recordDecision('later');
    });
    expect(outcome).toBe(false);
    expect(getSpy).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('is unresolved while the coach identity is unknown and refuses to record blind', async () => {
    mockCurrentUserId = null;
    const { result } = await renderHook(() => useImportOfferDecision(true));
    expect(result.current.status).toBe('unresolved');
    expect(result.current.decision).toBeNull();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.recordDecision('starting_fresh');
    });
    expect(outcome).toBe(false);
    // Nothing was bound to a guessed owner.
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(result.current.status).toBe('unresolved');
  });

  it('defaults to the OFF kill switch (featureFlags.extensionImport is false in test env)', async () => {
    const getSpy = jest.spyOn(AsyncStorage, 'getItem');
    spies.push(getSpy);
    const { result } = await renderHook(() => useImportOfferDecision());
    expect(result.current.status).toBe('disabled');
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('useImportOfferDecision — reading the persisted answer', () => {
  it('is loading (render nothing) until the read settles, then ready with null when unanswered', async () => {
    // Hold the read open: RNTL's async renderHook flushes an unheld in-memory
    // read inside its own act, so the intermediate state is only observable
    // while getItem is still pending.
    const held = deferred<string | null>();
    const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => held.promise);
    spies.push(getSpy);

    const { result } = await renderHook(() => useImportOfferDecision(true));
    expect(result.current.status).toBe('loading');
    expect(result.current.decision).toBeNull();

    await act(async () => {
      held.resolve(null);
      await flush();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBeNull();
  });

  it.each<ImportOfferDecision>(['yes', 'later', 'starting_fresh'])(
    'returns the persisted answer %s for the signed-in coach',
    async (decision) => {
      await seedDecision('coach-1', decision);
      const { result } = await renderHook(() => useImportOfferDecision(true));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.decision).toBe(decision);
    },
  );

  it('never returns another coach\'s answer', async () => {
    await seedDecision('coach-2', 'starting_fresh');
    const { result } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBeNull();
    // The other coach's record is untouched: not ours to read or clear.
    expect(await readImportOfferDecision('coach-2')).toBe('starting_fresh');
  });

  it('resolves once the identity arrives asynchronously (null on first render)', async () => {
    // Production timing: useCurrentUser() is null on first render and resolves
    // after a storage read; the offer must not be asked before the coach's own
    // answer has been consulted.
    await seedDecision('coach-1', 'later');
    mockCurrentUserId = null;
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    expect(result.current.status).toBe('unresolved');

    mockCurrentUserId = 'coach-1';
    await act(async () => {
      await rerender({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBe('later');
  });
});

describe('useImportOfferDecision — recording an answer', () => {
  it('reflects the answer immediately, writes it under the owner key, and reports true', async () => {
    const { result } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Hold the disk write open so "reflected in memory" is observable before
    // "confirmed on disk".
    const originalSetItem = AsyncStorage.setItem;
    const gate = deferred<void>();
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      await gate.promise;
      await originalSetItem(key, value);
    });
    spies.push(setSpy);

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = result.current.recordDecision('later');
      await flush();
    });
    // The tap is a fact for this session before the disk confirms it.
    expect(result.current.status).toBe('ready');
    expect(result.current.decision).toBe('later');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);

    let outcome: boolean | undefined;
    await act(async () => {
      gate.resolve();
      outcome = await pending;
    });
    expect(outcome).toBe(true);
    const raw = await AsyncStorage.getItem(importOfferDecisionKey('coach-1'));
    expect(JSON.parse(raw as string)).toEqual({
      version: IMPORT_OFFER_DECISION_VERSION,
      userId: 'coach-1',
      decision: 'later',
    });
    expect(await AsyncStorage.getAllKeys()).toEqual([importOfferDecisionKey('coach-1')]);
  });

  it('a recorded answer supersedes a read still in flight (the tap is newer than the disk)', async () => {
    const staleRecord = JSON.stringify({
      version: IMPORT_OFFER_DECISION_VERSION,
      userId: 'coach-1',
      decision: 'later',
    });
    const held = deferred<string | null>();
    const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => held.promise);
    spies.push(getSpy);

    const { result } = await renderHook(() => useImportOfferDecision(true));
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await result.current.recordDecision('yes');
    });
    expect(result.current.decision).toBe('yes');
    expect(await readImportOfferDecision('coach-1')).toBe('yes');

    // The old read now settles with the stale 'later' record it saw on disk.
    await act(async () => {
      held.resolve(staleRecord);
      await flush();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.decision).toBe('yes');
  });

  it('the latest answer is also the last one on disk when writes overlap (later, then yes)', async () => {
    const { result } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Hold the FIRST write open; if writes were not serialized the second
    // would land first and the slow first write would then overwrite it.
    const originalSetItem = AsyncStorage.setItem;
    const firstGate = deferred<void>();
    let calls = 0;
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      calls += 1;
      if (calls === 1) await firstGate.promise;
      await originalSetItem(key, value);
    });
    spies.push(setSpy);

    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    await act(async () => {
      first = result.current.recordDecision('later');
      second = result.current.recordDecision('yes');
      await flush();
    });
    expect(result.current.decision).toBe('yes');
    // Only the first write has started; the second waits its turn.
    expect(calls).toBe(1);

    let outcomes: boolean[] = [];
    await act(async () => {
      firstGate.resolve();
      outcomes = await Promise.all([first as Promise<boolean>, second as Promise<boolean>]);
    });
    expect(outcomes).toEqual([true, true]);
    expect(calls).toBe(2);
    expect(await readImportOfferDecision('coach-1')).toBe('yes');
    expect(result.current.decision).toBe('yes');
  });

  it('a failed write keeps the answer in memory, reports false, and re-offers on the next mount', async () => {
    const { result } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const setSpy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    spies.push(setSpy);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.recordDecision('later');
    });
    expect(outcome).toBe(false);
    // This session honours the tap: the card does not linger as unanswered.
    expect(result.current.status).toBe('ready');
    expect(result.current.decision).toBe('later');
    // Nothing is on disk, so no caller can truthfully say "saved".
    expect(await AsyncStorage.getAllKeys()).toEqual([]);

    // Next entry: the answer is unknown again and the offer may be asked.
    await cleanup();
    const next = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(next.result.current.status).toBe('ready'));
    expect(next.result.current.decision).toBeNull();
  });
});

describe('useImportOfferDecision — identity change on a live mount', () => {
  it('sign-out (A→null) drops the in-memory answer and returns to unresolved', async () => {
    await seedDecision('coach-1', 'starting_fresh');
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.decision).toBe('starting_fresh'));

    mockCurrentUserId = null;
    await act(async () => {
      await rerender({});
    });
    expect(result.current.status).toBe('unresolved');
    expect(result.current.decision).toBeNull();
    // The record on disk is the signing-out coach's; signOut() removes it, not
    // this hook (which must not write during sign-out).
    expect(await readImportOfferDecision('coach-1')).toBe('starting_fresh');
  });

  it('account switch (A→B) resets BEFORE reading B and never shows A\'s answer', async () => {
    await seedDecision('coach-1', 'starting_fresh');
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.decision).toBe('starting_fresh'));

    // Hold B's read open so the state between "switched" and "read settled"
    // is observable: it must already be empty, not still showing A's answer.
    const heldB = deferred<string | null>();
    const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => heldB.promise);
    spies.push(getSpy);

    mockCurrentUserId = 'coach-2';
    await act(async () => {
      await rerender({});
    });
    expect(result.current.status).toBe('loading');
    expect(result.current.decision).toBeNull();

    await act(async () => {
      heldB.resolve(null);
      await flush();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.decision).toBeNull();
  });

  it('account switch shows B\'s own answer, not A\'s', async () => {
    await seedDecision('coach-1', 'starting_fresh');
    await seedDecision('coach-2', 'later');
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.decision).toBe('starting_fresh'));

    mockCurrentUserId = 'coach-2';
    await act(async () => {
      await rerender({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBe('later');
  });

  it('discards a stale read for the previous coach that settles after the switch', async () => {
    await seedDecision('coach-1', 'starting_fresh');
    const heldA = deferred<string | null>();
    const original = AsyncStorage.getItem;
    const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => heldA.promise);
    spies.push(getSpy);

    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    expect(result.current.status).toBe('loading');

    // B signs in before A's read has settled; B's read goes straight through.
    mockCurrentUserId = 'coach-2';
    await act(async () => {
      await rerender({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBeNull();

    // A's read finally settles with A's answer: it must be discarded.
    await act(async () => {
      heldA.resolve(await original(importOfferDecisionKey('coach-1')));
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.decision).toBeNull();
  });

  it('a write that lands after sign-out is removed again and reported false', async () => {
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const originalSetItem = AsyncStorage.setItem;
    const gate = deferred<void>();
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      await gate.promise;
      await originalSetItem(key, value);
    });
    spies.push(setSpy);

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = result.current.recordDecision('later');
      await flush();
    });
    expect(result.current.decision).toBe('later');

    // Coach signs out while the write is still in flight. (signOut() would
    // also have removed `import_offer_decision:coach-1` at this point.)
    mockCurrentUserId = null;
    await act(async () => {
      await rerender({});
    });
    expect(result.current.status).toBe('unresolved');

    let outcome: boolean | undefined;
    await act(async () => {
      gate.resolve();
      outcome = await pending;
    });
    expect(outcome).toBe(false);
    // The late write is cleaned up: sign-out stays a completed local boundary.
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
    });
    expect(result.current.status).toBe('unresolved');
    expect(result.current.decision).toBeNull();
  });

  it('a write that lands after an account switch is removed and never attributed to the new coach', async () => {
    const { result, rerender } = await renderHook(() => useImportOfferDecision(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const originalSetItem = AsyncStorage.setItem;
    const gate = deferred<void>();
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      await gate.promise;
      await originalSetItem(key, value);
    });
    spies.push(setSpy);

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = result.current.recordDecision('starting_fresh');
      await flush();
    });
    expect(result.current.decision).toBe('starting_fresh');

    mockCurrentUserId = 'coach-2';
    await act(async () => {
      await rerender({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.decision).toBeNull();

    let outcome: boolean | undefined;
    await act(async () => {
      gate.resolve();
      outcome = await pending;
    });
    expect(outcome).toBe(false);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
    });
    // B's view is untouched and B has no record.
    expect(result.current.decision).toBeNull();
    expect(await readImportOfferDecision('coach-2')).toBeNull();
  });
});
