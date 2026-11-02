/**
 * Independent LS-910R3 controls: every QUEUE probe must read a valid app payload and then read nothing
 * after the device stores are cleared. The second read must not be satisfied by the first read's memory.
 * The production readers, not a JSON-key enumeration, decide whether saved work comes back.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { clearUserCache, setUserCache } from '../lib/userCache';
import { REGISTRY } from '../../test/savedKeyLifetimes/savedKeyRegistry';
import { READERS } from '../../test/savedKeyLifetimes/savedKeyReaders';

jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => null }));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const queues = REGISTRY.filter((row) => row[2] === 'QUEUE')
  .map(([store, key], index) => ({ name: `${store} ${key}`, uid: `ls910r3-reader-${index}` }));

async function signIn(uid: string) {
  await setUserCache({ id: uid, role: 'coach', name: 'Reader control' } as Parameters<typeof setUserCache>[0]);
}

describe('LS-910R3 all real QUEUE readers distinguish restored work from absent disk data', () => {
  beforeEach(async () => {
    await clearUserCache();
    await AsyncStorage.clear();
    secure.clear();
  });
  afterAll(async () => {
    await clearUserCache();
  });

  it.each(queues)('$name', async ({ name, uid }) => {
    const probe = READERS[name];
    expect(probe).toBeDefined();
    expect(probe.via).toBe('reader');
    await signIn(uid);
    await probe.write(uid);
    expect(await probe.read(uid)).toBe(true);
    // Leave module memory intact deliberately. The production restart-aware probe must drop it.
    await AsyncStorage.clear();
    secure.clear();
    await signIn(uid);
    expect(await probe.read(uid)).toBe(false);
  });
});
