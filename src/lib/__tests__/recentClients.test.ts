// Stage 3 — recent-clients local cache.
//
// Backs the UniversalClientSearch "recent on focus" affordance. Tests
// pin: read returns [] when missing or malformed, push moves an
// existing email to the top without duplication, push respects the
// MAX_RECENT cap, and clear empties the store.

const mockStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      mockStore[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete mockStore[k];
      return Promise.resolve();
    }),
  },
}));

import {
  pushRecentClient,
  readRecentClients,
  clearRecentClients,
} from '../recentClients';

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
});

describe('recentClients', () => {
  it('returns [] when nothing is cached', async () => {
    await expect(readRecentClients()).resolves.toEqual([]);
  });

  it('returns [] when the cache is malformed', async () => {
    mockStore['tgp.recent_clients.v1'] = '{"not":"an array"}';
    await expect(readRecentClients()).resolves.toEqual([]);
  });

  it('pushes a new client to the front and tags it with last_seen_at', async () => {
    await pushRecentClient({ email: 'a@example.com', name: 'A', pillars: ['fitness'] });
    const recent = await readRecentClients();
    expect(recent).toHaveLength(1);
    expect(recent[0].email).toBe('a@example.com');
    expect(typeof recent[0].last_seen_at).toBe('string');
  });

  it('moves an existing email to the front rather than duplicating', async () => {
    await pushRecentClient({ email: 'a@example.com', name: 'A', pillars: ['fitness'] });
    await pushRecentClient({ email: 'b@example.com', name: 'B', pillars: ['fitness'] });
    await pushRecentClient({ email: 'a@example.com', name: 'A', pillars: ['fitness', 'finance'] });
    const recent = await readRecentClients();
    expect(recent.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(recent[0].pillars).toEqual(['fitness', 'finance']);
  });

  it('caps recent list at 5 entries (oldest fall off)', async () => {
    for (let i = 0; i < 7; i++) {
      await pushRecentClient({ email: `u${i}@example.com`, name: `U${i}`, pillars: ['fitness'] });
    }
    const recent = await readRecentClients();
    expect(recent).toHaveLength(5);
    expect(recent[0].email).toBe('u6@example.com');
    expect(recent[4].email).toBe('u2@example.com');
  });

  it('clear() empties the cache', async () => {
    await pushRecentClient({ email: 'a@example.com', name: 'A', pillars: ['fitness'] });
    await clearRecentClients();
    await expect(readRecentClients()).resolves.toEqual([]);
  });
});
