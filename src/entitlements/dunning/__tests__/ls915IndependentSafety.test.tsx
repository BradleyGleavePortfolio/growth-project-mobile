import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

let mockUser = { id: 'review-a', role: 'student', coach_id: 'coach-a' };
const mockRead = jest.fn();
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('../../../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock('../../PaywallSheet', () => ({ PaywallSheet: () => null }));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    tokens: {
      typography: {
        h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 },
        bodyMd: { fontSize: 16 }, bodySmall: { fontSize: 14 },
      },
    },
  }),
}));

import { EntitlementProvider, useEntitlement } from '../../EntitlementProvider';
import { ProtectedScreen } from '../../ProtectedScreen';
import { dunningLockoutStore } from '../dunningLockoutStore';

type Answer =
  | { ok: true; data: { active: boolean } }
  | { ok: false; reason: 'error'; message: string };
const answer = (active: boolean): Answer => ({ ok: true, data: { active } });
function deferred() {
  let resolve!: (value: Answer) => void;
  const promise = new Promise<Answer>((done) => { resolve = done; });
  return { promise, resolve };
}

let refresh: () => Promise<boolean>;
function Probe() {
  const entitlement = useEntitlement();
  refresh = entitlement.refreshEntitlement;
  return (
    <>
      <Text testID="state">{entitlement.status}</Text>
      <ProtectedScreen><Text testID="paid">paid</Text></ProtectedScreen>
    </>
  );
}
const tree = () => <EntitlementProvider><Probe /></EntitlementProvider>;
const lock = () => act(async () => {
  dunningLockoutStore.reportLocked({ requestId: 'review-lock', generation: dunningLockoutStore.currentGeneration() });
});
const clear = () => act(async () => {
  dunningLockoutStore.clear(dunningLockoutStore.currentGeneration());
});
async function initiallyInactive() {
  mockRead.mockResolvedValue(answer(false));
  const view = await render(tree());
  await waitFor(() => expect(view.getByTestId('state').props.children).toBe('inactive'));
  await lock();
  mockRead.mockClear();
  return view;
}

beforeEach(() => {
  mockUser = { id: 'review-a', role: 'student', coach_id: 'coach-a' };
  dunningLockoutStore.__resetForTests();
  mockRead.mockReset();
});

describe('LS-915 independent canonical recovery controls', () => {
  it('does not optimistically open paid content while a lock-clear read is pending or inactive', async () => {
    const view = await initiallyInactive();
    const pending = deferred();
    mockRead.mockReturnValueOnce(pending.promise);
    await clear();
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('state').props.children).toBe('checking');
    expect(view.queryByTestId('paid')).toBeNull();
    await act(async () => pending.resolve(answer(false)));
    expect(view.getByTestId('state').props.children).toBe('inactive');
    expect(view.queryByTestId('paid')).toBeNull();
  });

  it('keeps a failed canonical read closed and can retry with a real active answer', async () => {
    const view = await initiallyInactive();
    mockRead.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'review transport failure' });
    await clear();
    await waitFor(() => expect(view.getByTestId('state').props.children).toBe('unavailable'));
    expect(view.queryByTestId('paid')).toBeNull();
    mockRead.mockResolvedValueOnce(answer(true));
    await act(async () => { await refresh(); });
    expect(view.getByTestId('state').props.children).toBe('active');
    expect(view.queryByTestId('paid')).not.toBeNull();
  });

  it('drops an older active recovery answer when a newer canonical read says inactive', async () => {
    const view = await initiallyInactive();
    const old = deferred();
    const latest = deferred();
    mockRead.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await clear();
    await lock();
    await clear();
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => latest.resolve(answer(false)));
    await act(async () => old.resolve(answer(true)));
    expect(view.getByTestId('state').props.children).toBe('inactive');
    expect(view.queryByTestId('paid')).toBeNull();
  });

  it('drops an older inactive answer rather than re-locking a newly active entitlement', async () => {
    const view = await initiallyInactive();
    const old = deferred();
    const latest = deferred();
    mockRead.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await clear();
    await lock();
    await clear();
    await act(async () => latest.resolve(answer(true)));
    await act(async () => old.resolve(answer(false)));
    expect(view.getByTestId('state').props.children).toBe('active');
    expect(view.queryByTestId('paid')).not.toBeNull();
  });

  it('does not let a previous account recovery answer land after a new identity read', async () => {
    const view = await initiallyInactive();
    const oldAccount = deferred();
    mockRead.mockReturnValueOnce(oldAccount.promise);
    await clear();
    await act(async () => { dunningLockoutStore.retire(); });
    mockUser = { id: 'review-b', role: 'student', coach_id: 'coach-b' };
    mockRead.mockResolvedValue(answer(false));
    await view.rerender(tree());
    await waitFor(() => expect(view.getByTestId('state').props.children).toBe('inactive'));
    await act(async () => oldAccount.resolve(answer(true)));
    expect(view.getByTestId('state').props.children).toBe('inactive');
    expect(view.queryByTestId('paid')).toBeNull();
  });

  it('does not read on retire, redundant clear, or same locked signal', async () => {
    await initiallyInactive();
    await lock();
    expect(mockRead).not.toHaveBeenCalled();
    await act(async () => { dunningLockoutStore.retire(); });
    expect(mockRead).not.toHaveBeenCalled();
    await clear();
    expect(mockRead).not.toHaveBeenCalled();
    await lock();
    mockRead.mockResolvedValue(answer(false));
    await clear();
    await clear();
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('seeds a lock already present before mount and reads again when it clears', async () => {
    await lock();
    mockRead.mockResolvedValueOnce(answer(false));
    const view = await render(tree());
    await waitFor(() => expect(view.getByTestId('state').props.children).toBe('inactive'));
    mockRead.mockResolvedValueOnce(answer(true));
    await clear();
    await waitFor(() => expect(view.queryByTestId('paid')).not.toBeNull());
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('reads canonical access on cold restore rather than inheriting an old inactive value', async () => {
    const previous = await initiallyInactive();
    await previous.unmount();
    await act(async () => { dunningLockoutStore.retire(); });
    mockRead.mockResolvedValue(answer(true));
    const restored = await render(tree());
    await waitFor(() => expect(restored.getByTestId('state').props.children).toBe('active'));
    expect(restored.queryByTestId('paid')).not.toBeNull();
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
});
