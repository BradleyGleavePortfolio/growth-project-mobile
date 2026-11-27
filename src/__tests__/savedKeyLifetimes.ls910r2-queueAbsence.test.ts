import AsyncStorage from '@react-native-async-storage/async-storage';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const setItem = AsyncStorage.setItem.bind(AsyncStorage);
const KEY = 'tgp.voiceOutbox.v1';
const retained = JSON.stringify([{
  id: 'kt13-voice',
  authorId: 'acct-a-1111',
  workspaceId: 'kt13-ws',
  input: { uri: 'file:///kt13.m4a', durationMs: 1000 },
  peaks: [0.5],
  status: 'sending',
}]);

it('LS-910R2 B3 sign out must reject a changed nonempty unkeyed QUEUE, not only the original sentinel', async () => {
  // The app normally writes [] on logout. Model a regression retaining a send in progress instead.
  const spy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation((key, value) =>
    setItem(key, key === KEY && value === '[]' ? retained : value));
  try {
    const found = await lifetimeFindings();
    expect(await AsyncStorage.getItem(KEY)).toBe(retained);
    expect(found.filter((f) => f.includes("'tgp.voiceOutbox.v1' (QUEUE) breaks keyed:"))).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});
