/**
 * B-TEST (lens LO-910R3, m#910 review round 3, B3): an ACCOUNT key must stay gone through the whole sign-in
 * sequence, not only at the moment after A's first sign out. The lifetime case (src/__tests__/savedKeyLifetimes.test.ts
 * :201-264) checks ACCOUNT absence once, right after A's first sign out; after A signs back in, signs out again and
 * B signs in it reads only the MARK and QUEUE readers. This models the usual regression: a store keeps A's value in
 * memory and saves it again when the next account signs in (A's notification choices, A's macro targets), so B's
 * phone holds A's data. At d98074df lifetimeFindings() reports nothing for either key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readUserCacheSync } from '../lib/userCache';
import { authEvents } from '../utils/authEvents';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const A = 'acct-a-1111';
const B = 'acct-b-2222';
const KEYS = ['gp_notif_category_prefs', `macro_targets:${A}`];
const A_VALUE = 'seeded-for-the-account'; // what the lifetime case saved for A (its SEED)

it('B-TEST LO-910R3 B3: an ACCOUNT key saved again for A when B signs in is reported', async () => {
  // A's copy in memory, saved again on B's sign-in (the login event the app's listeners hear).
  let fired = 0;
  const writeBack = () => {
    if (readUserCacheSync()?.id !== B) return;
    fired += 1;
    for (const k of KEYS) void AsyncStorage.setItem(k, A_VALUE);
  };
  authEvents.on('login', writeBack);
  try {
    const found = await lifetimeFindings();
    expect(fired).toBeGreaterThan(0);
    const named = (key: string) => found.some((f) => f.includes(`async '${key}' (ACCOUNT) breaks signout:`));
    expect({ notifPrefs: named('gp_notif_category_prefs'), macroTargets: named('macro_targets:{uid}') })
      .toEqual({ notifPrefs: true, macroTargets: true });
  } finally {
    authEvents.off('login', writeBack);
  }
});
