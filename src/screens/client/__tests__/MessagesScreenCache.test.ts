/**
 * Hunt #2 P0-1 + P1-2 — DM thread cache must be user-scoped and orphan
 * pending bubbles must be reaped on reconciliation.
 *
 * These tests cover the pure logic surface (cache key derivation + pending
 * reconciliation) and the MMKV round-trip via the cacheStorage shim, without
 * rendering the screen.
 */

import { cacheKeyFor, reconcilePending } from '../MessagesScreen';
import { cacheStorage } from '../../../storage/mmkv';

interface Msg {
  id: string;
  sender_role: 'coach' | 'client';
  body: string;
  created_at: string;
  pending?: boolean;
}

describe('cacheKeyFor', () => {
  it('produces a per-user key (not a fixed global)', () => {
    expect(cacheKeyFor('user-A')).toBe('messages_thread_client_user-A');
    expect(cacheKeyFor('user-B')).toBe('messages_thread_client_user-B');
    expect(cacheKeyFor('user-A')).not.toBe(cacheKeyFor('user-B'));
  });

  it('round-trips through cacheStorage so User-B never reads User-A cache', async () => {
    // Seed User-A's thread in the cache.
    const userA = 'aaa-111';
    const userB = 'bbb-222';
    const threadA: Msg[] = [
      { id: 'm1', sender_role: 'coach', body: 'private to A', created_at: '2026-01-01T00:00:00Z' },
    ];
    await cacheStorage.set(cacheKeyFor(userA), JSON.stringify(threadA));

    // User-B's key on the same device should be empty — and the global key
    // (the legacy bug) should also be empty since we never write it.
    const rawB = await cacheStorage.getStringAsync(cacheKeyFor(userB));
    expect(rawB).toBeUndefined();

    const rawLegacyGlobal = await cacheStorage.getStringAsync(
      'messages_thread_client',
    );
    expect(rawLegacyGlobal).toBeUndefined();

    // User-A's key still holds A's thread (sanity).
    const rawA = await cacheStorage.getStringAsync(cacheKeyFor(userA));
    expect(rawA).toBeDefined();
    expect(JSON.parse(String(rawA))).toEqual(threadA);

    // Clean up.
    await cacheStorage.delete(cacheKeyFor(userA));
  });
});

describe('reconcilePending', () => {
  it('drops a pending message whose body matches a returned server message', () => {
    const prev: Msg[] = [
      {
        id: 'pending_100',
        sender_role: 'client',
        body: 'hello',
        created_at: '2026-05-21T10:00:00Z',
        pending: true,
      },
    ];
    const server: Msg[] = [
      { id: 'srv-1', sender_role: 'client', body: 'hello', created_at: '2026-05-21T10:00:01Z' },
    ];
    expect(reconcilePending(prev, server)).toEqual([]);
  });

  it('keeps a pending message newer than the oldest server message', () => {
    const prev: Msg[] = [
      {
        id: 'pending_999',
        sender_role: 'client',
        body: 'in-flight',
        created_at: '2026-05-21T12:00:00Z',
        pending: true,
      },
    ];
    const server: Msg[] = [
      { id: 'srv-1', sender_role: 'coach', body: 'earlier', created_at: '2026-05-21T09:00:00Z' },
    ];
    const out = reconcilePending(prev, server);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('pending_999');
  });

  it('drops a pending message older than the oldest server message (orphan reaper)', () => {
    const prev: Msg[] = [
      {
        id: 'pending_1',
        sender_role: 'client',
        body: 'old orphan',
        created_at: '2026-05-01T00:00:00Z',
        pending: true,
      },
    ];
    const server: Msg[] = [
      { id: 'srv-1', sender_role: 'coach', body: 'something newer', created_at: '2026-05-20T00:00:00Z' },
    ];
    expect(reconcilePending(prev, server)).toEqual([]);
  });

  it('does not touch non-pending messages (only pending entries flow through)', () => {
    const prev: Msg[] = [
      { id: 'srv-old', sender_role: 'coach', body: 'committed', created_at: '2026-05-01T00:00:00Z' },
      {
        id: 'pending_2',
        sender_role: 'client',
        body: 'pending',
        created_at: '2026-05-21T11:00:00Z',
        pending: true,
      },
    ];
    const server: Msg[] = [
      { id: 'srv-1', sender_role: 'coach', body: 'first', created_at: '2026-05-21T09:00:00Z' },
    ];
    // The reaper returns only surviving pending rows; callers merge those
    // back in alongside server messages via mergeById.
    expect(reconcilePending(prev, server)).toEqual([
      {
        id: 'pending_2',
        sender_role: 'client',
        body: 'pending',
        created_at: '2026-05-21T11:00:00Z',
        pending: true,
      },
    ]);
  });
});
