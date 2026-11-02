/**
 * KT-13 (KNOWN_TRAPS.md): every key the app saves on the phone has a stated lifetime, and sign out, a
 * second account on the same phone and account deletion keep it. The registry is
 * test/savedKeyLifetimes/savedKeyRegistry.ts; the scan of src/ is test/savedKeyLifetimes/scanSavedKeys.ts.
 *
 * When this goes red, the message names the file and line or the key. What a builder does:
 *   - "is not in the registry": you added a saved key. Register it: add a row with its lifetime
 *     (DEVICE, ACCOUNT, MARK or QUEUE, see the registry header) and make the code keep that lifetime
 *     (the sign-out sweeps in src/services/authActions.ts, the account id in the key, a deletion cleanup).
 *   - "breaks <rule>": a key does not keep its lifetime. Apply the rule in the code. If that is not your
 *     PR's concern, ask the operator for a KNOWN GAP row; never add one yourself.
 *   - "matches no saved key" or "KNOWN GAP closed": a key went away or a gap was fixed: delete that row.
 *
 * The behavior half (lifetimeFindings) runs the real sign out (signOut, clearAllStorage, every sweep) and
 * the real deletion screen on the repo's storage mocks: AsyncStorage's jest mock (the storage/mmkv shim
 * writes `<namespace>:<key>` into it) and the expo-secure-store mock in jest.setup.js. Each key keeping
 * past a restart or a sign out is written and read back with the app's own writer and reader, from
 * test/savedKeyLifetimes/savedKeyReaders.ts (a QUEUE row needs an entry there). In order: a restart (each
 * key alone, read back from storage), A signs out (ACCOUNT keys absent, not just changed; a MARK keeps its
 * value; an unkeyed QUEUE holds none of A's work), A signs back in (each mark still reads as set), B signs
 * in (B's readers get none of A's marks or work), and A's real account deletion (no MARK left).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { render, waitFor } from '@testing-library/react-native';
import DeleteAccountScreen from '../screens/settings/DeleteAccountScreen';
import { signOut } from '../services/authActions';
import { clearUserCache, readUserCacheSync, setUserCache } from '../lib/userCache';
import { releaseOutbox } from '../services/messageOutbox';
import { cacheStorage, prefsStorage, secureStorage } from '../storage/mmkv';
import { authEvents } from '../utils/authEvents';
import { scanSavedKeys, type KeySite, type Store } from '../../test/savedKeyLifetimes/scanSavedKeys';
import { KNOWN_GAPS, REGISTRY, RULES, type Row, type Rule } from '../../test/savedKeyLifetimes/savedKeyRegistry';
import { READERS, type Probe } from '../../test/savedKeyLifetimes/savedKeyReaders';
// Loaded as the app loads them at start: their sign-out listeners are part of the real sign out.
import '../hooks/useVoiceOutbox';
import '../components/community/voiceReportedStore';
import '../lib/chatDrafts';

jest.mock('../services/api', () => ({
  deletionApi: { getDeletionStatus: jest.fn(async () => ({ data: { state: 'deleted' } })) },
  isAccountDeletedError: () => false,
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'acct-a-1111', role: 'coach', name: 'A' }),
}));
jest.mock('../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../offline/sync/sync-engine', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock('../utils/googleReauth', () => ({ reauthenticateWithGoogle: jest.fn() }));
jest.mock('../utils/authProviders', () => ({ getSignInProviders: jest.fn(async () => ['email']) }));
jest.mock('../utils/appleAuth', () => ({
  isAppleAuthAvailable: jest.fn(async () => false),
  reauthenticateWithApple: jest.fn(),
}));
jest.mock('../utils/haptics', () => ({ warningTap: jest.fn(), successTap: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../theme/tokens').lightTokens, colors: {} }),
}));

const A = 'acct-a-1111';
const B = 'acct-b-2222';
const ASYNC_READS = new Set(['getItem', 'getItemAsync', 'getStringAsync', 'multiGet', 'getMany']);
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const glob = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\{uid\}|\*/g, '.*')}$`);
const exact = (key: string) => key.replace(/\{uid\}/g, '*');
const globRows = (site: KeySite) => REGISTRY.filter(([store, key]) => store === site.store && glob(key).test(site.key));
/** The row for a site: its exact pattern first, else the one wider pattern that matches it. */
const rowOf = (site: KeySite) =>
  REGISTRY.find(([store, key]) => store === site.store && exact(key) === site.key) ?? globRows(site)[0];
const where = (store: Store, key: string) => `${store} '${key}'`;
const kt13 = 'KT-13 in KNOWN_TRAPS.md; see the header of src/__tests__/savedKeyLifetimes.test.ts';

/** The key for one account, without the storage namespace. */
function bare([, key, , , , sample]: Row, uid: string): string {
  return key.replace(/\{uid\}/g, uid).replace(/\*/g, sample ?? 'x');
}
/** The key as it sits in storage for one account. */
function physical(row: Row, uid: string): string {
  return row[0] === 'async' || row[0] === 'secure-store' ? bare(row, uid) : `${row[0]}:${bare(row, uid)}`;
}
/** What is on the phone at the key, as the storage double holds it (null: no key). */
async function onDisk(row: Row, uid: string): Promise<string | null> {
  return row[0] === 'secure-store' ? secure.get(physical(row, uid)) ?? null : AsyncStorage.getItem(physical(row, uid));
}
const SHIMS = { prefs: prefsStorage, cache: cacheStorage, secure: secureStorage } as const;
/** A MARK or DEVICE row without a reader entry: written and read back through its store's async calls. */
function layerProbe(row: Row): Probe {
  const store = row[0];
  return {
    via: 'layer',
    write: async (uid) => {
      if (store === 'async') await AsyncStorage.setItem(bare(row, uid), '1');
      else if (store === 'secure-store') await SecureStore.setItemAsync(bare(row, uid), '1');
      else await SHIMS[store].set(bare(row, uid), '1');
    },
    read: async (uid) => {
      if (store === 'async') return (await AsyncStorage.getItem(bare(row, uid))) !== null;
      if (store === 'secure-store') return (await SecureStore.getItemAsync(bare(row, uid))) !== null;
      return (await SHIMS[store].getStringAsync(bare(row, uid))) !== undefined;
    },
  };
}
const probeOf = (row: Row): Probe | undefined =>
  READERS[`${row[0]} ${row[1]}`] ?? (row[2] === 'MARK' || row[2] === 'DEVICE' ? layerProbe(row) : undefined);

type User = Parameters<typeof setUserCache>[0];
const signIn = (uid: string) => setUserCache({ id: uid, role: 'coach', name: uid } as User);
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
/** The app signs `uid` in on this phone: the user cache, then the login event its listeners hear. */
async function logIn(uid: string): Promise<void> {
  await signIn(uid);
  authEvents.emit('login');
  await settle();
}

const scan = scanSavedKeys();
type Found = Map<string, string>; // `${store} ${key}|${rule}` -> message

function fail(found: Found, row: Row, rule: Rule, detail: string): void {
  const id = `${row[0]} ${row[1]}|${rule}`;
  if (found.has(id)) return; // the first finding of a rule names it
  const site = scan.sites.find((s) => rowOf(s) === row);
  const at = site ? `${site.file}:${site.line}` : `src/${row[3]}`;
  found.set(id, `${at} ${where(row[0], row[1])} (${row[2]}) breaks ${rule}: ${RULES[rule]}. ${detail}`);
}

/** The probe's reader for signed-in `uid`; the user cache is put back after it. A throw reads as false. */
async function readsBack(probe: Probe, uid: string): Promise<boolean> {
  const before = readUserCacheSync();
  try {
    await signIn(uid);
    return await probe.read(uid);
  } catch {
    return false;
  } finally {
    if (before) await setUserCache(before);
    else await clearUserCache();
  }
}
async function freshPhone(): Promise<void> {
  releaseOutbox();
  await clearUserCache();
  await AsyncStorage.clear();
  secure.clear();
}
const SEED = 'seeded-for-the-account';
/** Account A signed in with every key saved: ACCOUNT keys seeded, every other key through its probe. */
async function saveAll(uid: string): Promise<void> {
  for (const row of REGISTRY.filter((r) => r[2] === 'ACCOUNT')) {
    if (row[0] === 'secure-store') secure.set(physical(row, uid), SEED);
    else await AsyncStorage.setItem(physical(row, uid), SEED);
  }
  await signIn(uid);
  for (const row of REGISTRY) await probeOf(row)?.write(uid).catch(() => undefined);
}
const unkeyedQueue = (row: Row) => row[2] === 'QUEUE' && !row[1].includes('{uid}');

/**
 * The lifetime half of KT-13: every finding not in KNOWN_GAPS, and every KNOWN GAP that no longer holds.
 * Exported for the tests that prove it reports a broken lifetime (savedKeyLifetimes.fr910.test.ts).
 */
export async function lifetimeFindings(): Promise<string[]> {
  const found: Found = new Map();
  for (const row of REGISTRY) {
    const [, key, life] = row;
    const reads = scan.sites.filter((s) => rowOf(s) === row && ASYNC_READS.has(s.method));
    if (life !== 'ACCOUNT' && reads.length === 0) fail(found, row, 'restart', 'Every read is synchronous.');
    if (life === 'MARK' && !key.includes('{uid}')) fail(found, row, 'keyed', 'The key has no account id.');
    if (life === 'QUEUE' && !READERS[`${row[0]} ${key}`]) {
      fail(found, row, 'restart', 'No reader for it: add its writer and reader in test/savedKeyLifetimes/savedKeyReaders.ts.');
    }
  }

  // Restart: each key alone on a fresh phone, saved for A, read back by the app's reader from storage
  // (the readers read the store; the outbox drops its memory first).
  for (const row of REGISTRY) {
    const probe = row[2] === 'ACCOUNT' ? undefined : probeOf(row);
    if (!probe) continue;
    await freshPhone();
    await signIn(A);
    let wrote = true;
    await probe.write(A).catch(() => { wrote = false; });
    if (!wrote) fail(found, row, 'restart', 'Writing a valid value for it threw.');
    else if (!(await readsBack(probe, A))) {
      fail(found, row, 'restart', `After a restart the app's ${probe.via === 'reader' ? 'reader' : 'store read'} does not bring it back.`);
    }
  }

  // A signs out with the app's own call. Gone means no key at all (null), not a changed value.
  await freshPhone();
  await saveAll(A);
  const before = new Map<Row, string | null>();
  for (const row of REGISTRY) before.set(row, await onDisk(row, A));
  await signOut();
  await settle();
  for (const row of REGISTRY) {
    const [, , life] = row;
    const now = await onDisk(row, A);
    if (life === 'ACCOUNT' && now !== null) fail(found, row, 'signout', "A's key is still on the phone after sign out.");
    if (life === 'MARK' && now === null) fail(found, row, 'signout', 'Sign out removed it.');
    else if (life === 'MARK' && now !== before.get(row)) fail(found, row, 'signout', 'Sign out changed its value.');
    if (life === 'DEVICE' && now === null) fail(found, row, 'signout', 'Sign out removed it.');
    if (unkeyedQueue(row)) {
      // Gone, or the app's own empty queue: any other value may hold A's work, whatever the reader filters.
      const probe = probeOf(row);
      if ((now !== null && !(probe?.empty ?? []).includes(now)) || (probe && (await readsBack(probe, A)))) {
        fail(found, row, 'keyed', "A's unsent work is still there for the next account.");
      }
    }
  }

  // A signs back in: each mark still reads as set.
  await logIn(A);
  for (const row of REGISTRY.filter((r) => r[2] === 'MARK')) {
    const probe = probeOf(row);
    if (probe && !(await readsBack(probe, A))) fail(found, row, 'signout', 'After A signs back in it reads as not set: it shows again.');
  }

  // A signs out again and B signs in on the same phone: B's readers get none of A's marks or work.
  await signOut();
  await settle();
  await logIn(B);
  for (const row of REGISTRY.filter((r) => r[2] === 'MARK' || r[2] === 'QUEUE')) {
    const probe = probeOf(row);
    if (probe && (await readsBack(probe, B))) {
      fail(found, row, 'keyed', `B's ${probe.via === 'reader' ? 'reader' : 'store read'} gets A's ${row[2] === 'MARK' ? 'mark' : 'unsent work'}.`);
    }
  }

  // A fresh phone: account A finishes the real deletion path (the deletion screen sees "deleted").
  await freshPhone();
  await saveAll(A);
  const loggedOut = jest.fn();
  authEvents.on('logout', loggedOut);
  try {
    const screen = await render(React.createElement(DeleteAccountScreen, {
      navigation: { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) },
    } as unknown as React.ComponentProps<typeof DeleteAccountScreen>));
    await waitFor(() => expect(screen.getByTestId('deletion-complete')).toBeTruthy());
    await waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
    await settle();
    screen.unmount();
  } finally {
    authEvents.off('logout', loggedOut);
  }
  for (const row of REGISTRY) {
    if (row[2] === 'MARK' && (await onDisk(row, A)) !== null) fail(found, row, 'deletion', "A's mark is still on the phone.");
  }

  const known = new Set(KNOWN_GAPS.map(([store, key, rule]) => `${store} ${key}|${rule}`));
  const fresh = [...found].filter(([id]) => !known.has(id)).map(([, msg]) => `${msg} (${kt13})`);
  const closed = [...known].filter((id) => !found.has(id))
    .map((id) => `KNOWN GAP closed: ${id} now keeps its lifetime: delete its row in KNOWN_GAPS`);
  return [...fresh, ...closed];
}

describe('KT-13 saved key lifetimes', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    secure.clear();
  });

  it('every saved key in src/ is in the registry', () => {
    const missing = scan.sites
      .filter((s) => !rowOf(s))
      .map((s) => s.key !== '*'
        ? `${s.file}:${s.line} ${where(s.store, s.key)} is not in the registry: register it with its lifetime (${kt13})`
        : `${s.file}:${s.line} ${s.store}: the scan cannot read this saved key (${s.method.replace(/^unsupported: /, '')}): ` +
          `name the key where the store is called (a literal, a const or a key function) (${kt13})`);
    expect(missing).toEqual([]);
    expect(scan.sites.length).toBeGreaterThan(200);
  });

  it('every registry row still matches a saved key, and each key has one row', () => {
    const stale = REGISTRY.filter((row) => !scan.sites.some((s) => rowOf(s) === row))
      .map(([store, key]) => `${where(store, key)} matches no saved key in src/: delete the row`);
    const twice = scan.sites.filter((s) => !REGISTRY.some(([st, k]) => st === s.store && exact(k) === s.key) &&
      globRows(s).length > 1).map((s) => `${s.file}:${s.line} ${where(s.store, s.key)} matches two rows: make one narrower`);
    expect([...stale, ...new Set(twice)]).toEqual([]);
  });

  it('only the query cache persister reads keys the scan cannot follow', () => {
    expect([...new Set(scan.adapters.map((a) => a.split(':')[0]))]).toEqual(['src/services/queryClient.ts']);
  });

  it('a restart, sign out, a second account and account deletion keep every lifetime (known gaps listed)', async () => {
    expect(await lifetimeFindings()).toEqual([]);
  });
});
