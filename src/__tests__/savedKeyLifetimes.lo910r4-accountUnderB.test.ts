/**
 * B-TEST (lens LO-910R4, m#910 review round 4, B3): F5, ACCOUNT rows checked again when B signs in. FR-910R3's
 * accountStaysGone (src/__tests__/savedKeyLifetimes.test.ts:188-195) reads a keyed row only at A's key, and an
 * unkeyed row only for the exact text A saved. The usual regression it is there for, a store that keeps A's value in
 * memory and saves it again when the next account signs in, saves under the key the store builds now: a keyed store
 * builds B's key (src/hooks/useMacroTargets.ts:23 `macro_targets:${userId}`), so B's phone holds A's macro targets
 * under B's id; and a store saves in its own format (src/screens/settings/NotificationPreferencesScreen.tsx:261
 * saves JSON.stringify of its state), so A's choices come back wrapped. At d7e6bbb7 lifetimeFindings() reports
 * neither; it does report A's value saved again under A's key (the control).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readUserCacheSync } from '../lib/userCache';
import { authEvents } from '../utils/authEvents';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const A = 'acct-a-1111';
const B = 'acct-b-2222';
const A_VALUE = 'seeded-for-the-account'; // what the lifetime case saved for A (its SEED)

/** The lifetime case, with A's value saved again (`writes`) on each sign in while B is the signed-in account. */
async function findingsWithWriteBack(writes: Record<string, string>): Promise<string[]> {
  let fired = 0;
  const writeBack = () => {
    if (readUserCacheSync()?.id !== B) return;
    fired += 1;
    for (const [k, v] of Object.entries(writes)) void AsyncStorage.setItem(k, v);
  };
  authEvents.on('login', writeBack);
  try {
    const found = await lifetimeFindings();
    expect(fired).toBeGreaterThan(0);
    return found;
  } finally {
    authEvents.off('login', writeBack);
  }
}
const named = (found: string[], key: string) => found.some((f) => f.includes(`async '${key}' (ACCOUNT) breaks `));

it("control: A's value saved again under A's key when B signs in is reported", async () => {
  const found = await findingsWithWriteBack({ [`macro_targets:${A}`]: A_VALUE });
  expect(named(found, 'macro_targets:{uid}')).toBe(true);
});

it("B-TEST LO-910R4 B3: A's value saved again under B's key, or in a wrapper, when B signs in is reported",
  async () => {
    const found = await findingsWithWriteBack({
      [`macro_targets:${B}`]: A_VALUE,
      gp_notif_category_prefs: JSON.stringify({ value: A_VALUE, savedAt: 1 }),
    });
    expect({
      macroTargetsUnderB: named(found, 'macro_targets:{uid}'),
      notifPrefsWrapped: named(found, 'gp_notif_category_prefs'),
    }).toEqual({ macroTargetsUnderB: true, notifPrefsWrapped: true });
  });
