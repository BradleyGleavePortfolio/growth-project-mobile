import AsyncStorage from '@react-native-async-storage/async-storage';
import './savedKeyLifetimes.test';

const KEY = 'pending_invite_code';
const REPLACEMENT = 'a-different-account-value-still-on-the-phone';
const removeMany = AsyncStorage.removeMany.bind(AsyncStorage);

// Mutation of the storage double only. Cleanup leaves a different value at
// one ACCOUNT key; the reviewed contract must not call this "gone".
const remove = jest.spyOn(AsyncStorage, 'removeMany').mockImplementation(async (keys) => {
  await removeMany(keys);
  if (keys.includes(KEY)) await AsyncStorage.setItem(KEY, REPLACEMENT);
});

afterAll(() => remove.mockRestore());

it('LS-910 B4 ACCOUNT absence means null rather than a changed sentinel', async () => {
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});
