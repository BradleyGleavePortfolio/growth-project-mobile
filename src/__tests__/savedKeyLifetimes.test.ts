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
 * The behavior half runs the real sign out (signOut, clearAllStorage, every sweep) and the real
 * deletion screen on the repo's storage mocks: AsyncStorage's jest mock (the storage/mmkv shim writes
 * `<namespace>:<key>` into it) and the expo-secure-store mock in jest.setup.js.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { render, waitFor } from '@testing-library/react-native';
import DeleteAccountScreen from '../screens/settings/DeleteAccountScreen';
import { signOut } from '../services/authActions';
import { setUserCache } from '../lib/userCache';
import { authEvents } from '../utils/authEvents';
import { scanSavedKeys, type KeySite, type Store } from '../../test/savedKeyLifetimes/scanSavedKeys';
import { KNOWN_GAPS, REGISTRY, RULES, type Row, type Rule } from '../../test/savedKeyLifetimes/savedKeyRegistry';
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
const ASYNC_READS = new Set(['getItem', 'getItemAsync', 'getStringAsync']);
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

/** The key as it sits in storage for one account. */
function physical([store, key, , , , sample]: Row, uid: string): string {
  const k = key.replace(/\{uid\}/g, uid).replace(/\*/g, sample ?? 'x');
  return store === 'async' || store === 'secure-store' ? k : `${store}:${k}`;
}
const SEED = 'seeded-for-the-account';
async function seed(row: Row, uid: string): Promise<void> {
  if (row[0] === 'secure-store') secure.set(physical(row, uid), SEED);
  else await AsyncStorage.setItem(physical(row, uid), SEED);
}
/** The key still holds what was seeded (a DEVICE key only has to exist: a nonce may be replaced). */
async function present(row: Row, uid: string): Promise<boolean> {
  const k = physical(row, uid);
  const v = row[0] === 'secure-store' ? secure.get(k) ?? null : await AsyncStorage.getItem(k);
  return row[2] === 'DEVICE' ? v !== null : v === SEED;
}
async function seedAccount(uid: string): Promise<void> {
  for (const row of REGISTRY) await seed(row, uid);
  await setUserCache({ id: uid, role: 'coach', name: uid } as Parameters<typeof setUserCache>[0]);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const scan = scanSavedKeys();
const found = new Map<string, string>(); // `${store} ${key}|${rule}` -> message

function fail(row: Row, rule: Rule, detail: string): void {
  const site = scan.sites.find((s) => rowOf(s) === row);
  const at = site ? `${site.file}:${site.line}` : `src/${row[3]}`;
  found.set(`${row[0]} ${row[1]}|${rule}`, `${at} ${where(row[0], row[1])} (${row[2]}) breaks ${rule}: ${RULES[rule]}. ${detail}`);
}

describe('KT-13 saved key lifetimes', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    secure.clear();
  });

  it('every saved key in src/ is in the registry', () => {
    const missing = scan.sites
      .filter((s) => !rowOf(s))
      .map((s) => `${s.file}:${s.line} ${where(s.store, s.key)} is not in the registry: register it with its lifetime (${kt13})`);
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

  it('sign out, a second account and account deletion keep every lifetime (known gaps listed)', async () => {
    for (const row of REGISTRY) {
      const [, key, life] = row;
      const reads = scan.sites.filter((s) => rowOf(s) === row && ASYNC_READS.has(s.method));
      if (life !== 'ACCOUNT' && reads.length === 0) fail(row, 'restart', 'Every read is synchronous.');
      if (life === 'MARK' && !key.includes('{uid}')) fail(row, 'keyed', 'The key has no account id.');
    }

    // Account A signs out with the app's own call, then B signs in on the same phone.
    await seedAccount(A);
    await signOut();
    await settle();
    for (const row of REGISTRY) {
      const kept = await present(row, A);
      const life = row[2];
      if (life === 'ACCOUNT' && kept) fail(row, 'signout', "A's key is still on the phone after sign out.");
      if ((life === 'MARK' || life === 'DEVICE') && !kept) fail(row, 'signout', 'Sign out removed it.');
      if (life === 'QUEUE' && !row[1].includes('{uid}') && kept) fail(row, 'keyed', "A's unsent work is still there for B.");
    }
    await setUserCache({ id: B, role: 'client', name: B } as Parameters<typeof setUserCache>[0]);
    authEvents.emit('login');
    await settle();
    for (const row of REGISTRY) {
      if ((row[2] === 'MARK' || row[2] === 'QUEUE') && row[1].includes('{uid}') && (await present(row, B))) {
        fail(row, 'keyed', "A's value shows under B's key.");
      }
    }

    // A fresh phone: account A finishes the real deletion path (the deletion screen sees "deleted").
    await AsyncStorage.clear();
    secure.clear();
    await seedAccount(A);
    const loggedOut = jest.fn();
    authEvents.on('logout', loggedOut);
    try {
      const screen = await render(React.createElement(DeleteAccountScreen, {
        navigation: { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) },
      } as unknown as React.ComponentProps<typeof DeleteAccountScreen>));
      await waitFor(() => expect(screen.getByTestId('deletion-complete')).toBeTruthy());
      await waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
      await settle();
    } finally {
      authEvents.off('logout', loggedOut);
    }
    for (const row of REGISTRY) {
      if (row[2] === 'MARK' && (await present(row, A))) fail(row, 'deletion', "A's mark is still on the phone.");
    }

    const known = new Set(KNOWN_GAPS.map(([store, key, rule]) => `${store} ${key}|${rule}`));
    const fresh = [...found].filter(([id]) => !known.has(id)).map(([, msg]) => `${msg} (${kt13})`);
    const closed = [...known].filter((id) => !found.has(id))
      .map((id) => `KNOWN GAP closed: ${id} now keeps its lifetime: delete its row in KNOWN_GAPS`);
    expect([...fresh, ...closed]).toEqual([]);
  });
});
