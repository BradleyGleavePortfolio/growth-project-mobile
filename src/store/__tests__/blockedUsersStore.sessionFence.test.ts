import { useBlockedUsersStore } from '../blockedUsersStore';
import { prefsStorage } from '../../storage/mmkv';

jest.mock('../../storage/mmkv', () => ({
  prefsStorage: {
    getString: jest.fn(() => undefined),
    getStringAsync: jest.fn(),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  },
}));

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}

const previous = {
  id: 'previous-block',
  displayName: 'Earlier blocked person',
  role: 'other',
  blockedAt: '2026-10-29T09:00:00.000Z',
};
const current = {
  blockedId: 'current-block',
  displayName: 'Current blocked person',
  blockedAt: '2026-10-30T09:00:00.000Z',
};

beforeEach(async () => {
  await useBlockedUsersStore.getState().reset();
  jest.clearAllMocks();
  jest.mocked(prefsStorage.getStringAsync).mockResolvedValue(undefined);
});

describe('LS-914 B1: blocked-list async ownership', () => {
  it.each([false, true])(
    'a late previous-account hydrate cannot expose names in the next account (reset=%s)',
    async (reset) => {
      const storageRead = held<string | undefined>();
      jest.mocked(prefsStorage.getStringAsync)
        .mockImplementationOnce(() => storageRead.promise)
        .mockResolvedValueOnce(undefined);

      const oldHydrate = useBlockedUsersStore.getState().hydrate('previous-account');
      if (reset) await useBlockedUsersStore.getState().reset();
      await useBlockedUsersStore.getState().hydrate('current-account');
      await useBlockedUsersStore.getState().addFromServer([current], { replace: true });
      const nextAccount = useBlockedUsersStore.getState().blocked;

      storageRead.release(JSON.stringify([previous]));
      await oldHydrate;

      expect(useBlockedUsersStore.getState().userId).toBe('current-account');
      expect(useBlockedUsersStore.getState().blocked).toEqual(nextAccount);
    },
  );
});
