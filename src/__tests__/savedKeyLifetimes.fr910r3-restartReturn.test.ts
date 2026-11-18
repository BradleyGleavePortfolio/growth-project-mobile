/**
 * FR-910R3 own test (fix round 3, agent 192), the LO-910R3 B3 class: an ACCOUNT key must stay gone after a restart
 * that follows sign out, not only right after A's first sign out. This models a store that kept A's value in memory
 * from A's second sign-in and saves it again on its way out (the second 'logout'). Before the fix nothing read the
 * ACCOUNT rows after the second sign out, so lifetimeFindings() reported nothing for either key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const A = 'acct-a-1111';
const KEYS = ['gp_notif_category_prefs', `macro_targets:${A}`];
const A_VALUE = 'seeded-for-the-account'; // what the lifetime case saved for A (its SEED)

it("FR-910R3: A's ACCOUNT value saved back at the second sign out is reported after the restart", async () => {
  let logouts = 0;
  const writeBack = () => {
    logouts += 1;
    if (logouts === 2) for (const k of KEYS) void AsyncStorage.setItem(k, A_VALUE);
  };
  authEvents.on('logout', writeBack);
  try {
    const found = await lifetimeFindings();
    expect(logouts).toBeGreaterThanOrEqual(2);
    const named = (key: string) => found.some((f) => f.includes(`async '${key}' (ACCOUNT) breaks signout:`));
    expect({ notifPrefs: named('gp_notif_category_prefs'), macroTargets: named('macro_targets:{uid}') })
      .toEqual({ notifPrefs: true, macroTargets: true });
  } finally {
    authEvents.off('logout', writeBack);
  }
});
