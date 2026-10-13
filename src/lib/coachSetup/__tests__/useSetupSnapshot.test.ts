/**
 * The one setup read behind the Home checklist and the UI-2 zero-client Home (#698 LOC B1): only the newest read
 * writes, a read that throws becomes the checklist's error snapshot, and a change of coach never shows, or is
 * overwritten by, the last coach's ticks.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { SetupSnapshot } from '../setupStatus';
import { useSetupSnapshot, type SetupRead } from '../useSetupSnapshot';

jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (cb: () => void) => R.useEffect(() => cb(), [cb]) };
});

const snap = (livePackageTitle: string): SetupSnapshot => ({
  connect: null, livePackageTitle, hasClient: false, paid: false, sharedLink: false, errors: [],
});
function deferred() {
  let resolve: (s: SetupSnapshot) => void = () => undefined;
  const promise = new Promise<SetupSnapshot>((res) => { resolve = res; });
  return { promise, resolve: (s: SetupSnapshot) => resolve(s) };
}
const hook = (read: SetupRead | null) => renderHook(
  ({ r }: { r: SetupRead | null }) => useSetupSnapshot(r),
  { initialProps: { r: read } },
);

it('keeps only the newest read: a late first answer never replaces the reload', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const read: SetupRead = () => (++calls === 1 ? first.promise : second.promise);
  const { result } = await hook(read);
  expect(result.current.loading).toBe(true);
  await act(async () => { result.current.reload(); });
  await act(async () => { second.resolve(snap('Starter')); });
  await act(async () => { first.resolve(snap('Old')); });
  expect(result.current.snap?.livePackageTitle).toBe('Starter');
  expect(result.current.loading).toBe(false);
  expect(calls).toBe(2);
});

it("turns a read that throws into the checklist's error snapshot, every tick unknown", async () => {
  const read: SetupRead = () => Promise.reject(new Error('offline'));
  const { result } = await hook(read);
  await act(async () => undefined);
  expect(result.current.snap).toMatchObject({ connect: null, livePackageTitle: null, hasClient: null, paid: null, sharedLink: false });
  expect(result.current.snap?.errors).toHaveLength(1);
  expect(result.current.loading).toBe(false);
});

it("never shows the last coach's ticks once the coach changes, and drops that coach's late answer", async () => {
  const a = deferred();
  const b = deferred();
  const readA: SetupRead = () => a.promise;
  const readB: SetupRead = () => b.promise;
  const { result, rerender } = await hook(readA);
  await act(async () => { a.resolve(snap('A package')); });
  expect(result.current.snap?.livePackageTitle).toBe('A package');

  // Coach B: nothing of A's shows while B's read is in flight.
  await rerender({ r: readB });
  expect(result.current.snap).toBeNull();
  expect(result.current.loading).toBe(true);
  await act(async () => { b.resolve(snap('B package')); });
  expect(result.current.snap?.livePackageTitle).toBe('B package');

  // A read for A still in flight when the coach changes lands too late to write.
  const lateA = deferred();
  const readA2: SetupRead = () => lateA.promise;
  const c = deferred();
  const readC: SetupRead = () => c.promise;
  await rerender({ r: readA2 });
  await rerender({ r: readC });
  await act(async () => { c.resolve(snap('C package')); });
  await act(async () => { lateA.resolve(snap('A package')); });
  expect(result.current.snap?.livePackageTitle).toBe('C package');
});

it('reads nothing without a coach', async () => {
  const { result } = await hook(null);
  expect(result.current.snap).toBeNull();
  expect(result.current.loading).toBe(false);
});
