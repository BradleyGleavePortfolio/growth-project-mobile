/**
 * importPairingMirror — durability, user scoping, and hostile-payload discard
 * (M5-C).
 *
 * The mirror exists because the import flow sends the coach out to a browser,
 * so an OS kill mid-pairing is an ORDINARY event, not an edge case. These tests
 * pin the three properties that make the record safe to trust on relaunch:
 *   1. it round-trips exactly, including the server's verbatim `expires_at`,
 *   2. it is keyed per coach, so a second coach on a shared device can never
 *      read (or clear) the first coach's live pairing code,
 *   3. anything that is not a well-formed, current-version, same-coach record is
 *      DISCARDED and its key deleted — never half-trusted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  IMPORT_PAIRING_MIRROR_KEY_PREFIX,
  IMPORT_PAIRING_MIRROR_VERSION,
  clearImportPairingMirror,
  importPairingMirrorKey,
  readImportPairingMirror,
  writeImportPairingMirror,
  type MirroredPairingSession,
} from '../importPairingMirror';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function session(over: Partial<MirroredPairingSession> = {}): MirroredPairingSession {
  return {
    version: IMPORT_PAIRING_MIRROR_VERSION,
    userId: 'coach-1',
    platformId: 'trainerize',
    code: '482913',
    expiresAt: '2026-07-27T10:15:00.000Z',
    idempotencyKey: 'b0a1c2d3-e4f5-4607-8899-aabbccddeeff',
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('key shape', () => {
  it('namespaces by coach id under the swept prefix', () => {
    expect(importPairingMirrorKey('coach-1')).toBe(
      `${IMPORT_PAIRING_MIRROR_KEY_PREFIX}coach-1`,
    );
  });
});

describe('round trip', () => {
  it('returns every persisted field unchanged', async () => {
    await writeImportPairingMirror(session());
    expect(await readImportPairingMirror('coach-1')).toEqual(session());
  });

  it('stores the server expiry verbatim rather than a derived value', async () => {
    await writeImportPairingMirror(session({ expiresAt: '2099-01-01T00:00:00Z' }));
    const raw = await AsyncStorage.getItem(importPairingMirrorKey('coach-1'));
    expect(JSON.parse(raw as string).expiresAt).toBe('2099-01-01T00:00:00Z');
  });

  it('reads back a long-past expiry unchanged — expiry is the server\'s call', async () => {
    // Rule 16: the mirror never applies a client clock. A stamp from 2001 is
    // still returned so the server /status contract can be the one to say
    // `expired`; discarding it locally would silently strand a live session.
    const stale = session({ expiresAt: '2001-01-01T00:00:00.000Z' });
    await writeImportPairingMirror(stale);
    expect(await readImportPairingMirror('coach-1')).toEqual(stale);
  });

  it('returns null when the coach has no pending session', async () => {
    expect(await readImportPairingMirror('coach-1')).toBeNull();
  });

  it('overwrites a prior session for the same coach', async () => {
    await writeImportPairingMirror(session({ code: '111111' }));
    await writeImportPairingMirror(session({ code: '222222' }));
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('222222');
  });
});

describe('user scoping', () => {
  it('never hands one coach another coach\'s session', async () => {
    await writeImportPairingMirror(session({ userId: 'coach-1', code: '111111' }));
    await writeImportPairingMirror(session({ userId: 'coach-2', code: '222222' }));
    expect((await readImportPairingMirror('coach-1'))?.code).toBe('111111');
    expect((await readImportPairingMirror('coach-2'))?.code).toBe('222222');
  });

  it('clearing one coach leaves the other coach\'s session intact', async () => {
    await writeImportPairingMirror(session({ userId: 'coach-1' }));
    await writeImportPairingMirror(session({ userId: 'coach-2' }));
    await clearImportPairingMirror('coach-1');
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    expect(await readImportPairingMirror('coach-2')).not.toBeNull();
  });

  it('discards a payload whose userId disagrees with its own key', async () => {
    // A hand-edited or migrated record. Reconciling it would hand coach-1 a code
    // that pairs into coach-2's account.
    await AsyncStorage.setItem(
      importPairingMirrorKey('coach-1'),
      JSON.stringify(session({ userId: 'coach-2' })),
    );
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importPairingMirrorKey('coach-1'))).toBeNull();
  });
});

describe('malformed payloads are discarded, not half-trusted', () => {
  it.each<[string, string]>([
    ['unparseable JSON', '{not json'],
    ['a JSON primitive', '"482913"'],
    ['null', 'null'],
    ['an empty object', '{}'],
  ])('discards %s and deletes the key', async (_label, raw) => {
    await AsyncStorage.setItem(importPairingMirrorKey('coach-1'), raw);
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importPairingMirrorKey('coach-1'))).toBeNull();
  });

  it.each<[string, Partial<MirroredPairingSession>]>([
    ['a future schema version', { version: IMPORT_PAIRING_MIRROR_VERSION + 1 }],
    ['a past schema version', { version: 0 }],
    ['an empty code', { code: '' }],
    ['an empty platform', { platformId: '' }],
    ['an empty idempotency key', { idempotencyKey: '' }],
    ['an empty user id', { userId: '' }],
  ])('discards %s and deletes the key', async (_label, over) => {
    await AsyncStorage.setItem(
      importPairingMirrorKey('coach-1'),
      JSON.stringify({ ...session(), ...over }),
    );
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importPairingMirrorKey('coach-1'))).toBeNull();
  });

  it.each(['version', 'platformId', 'code', 'expiresAt', 'idempotencyKey'])(
    'discards a record missing %s',
    async (field) => {
      const partial: Record<string, unknown> = { ...session() };
      delete partial[field];
      await AsyncStorage.setItem(
        importPairingMirrorKey('coach-1'),
        JSON.stringify(partial),
      );
      expect(await readImportPairingMirror('coach-1')).toBeNull();
    },
  );
});

describe('clear', () => {
  it('is idempotent on an absent key', async () => {
    await expect(clearImportPairingMirror('coach-1')).resolves.toBeUndefined();
    await expect(clearImportPairingMirror('coach-1')).resolves.toBeUndefined();
  });

  it('swallows a storage failure rather than throwing at a terminal state', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'removeItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(clearImportPairingMirror('coach-1')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('write failures surface to the caller', () => {
  it('throws so the caller never believes a write happened that did not', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(writeImportPairingMirror(session())).rejects.toThrow('disk full');
    spy.mockRestore();
  });

  it('returns null (not a throw) when the read itself fails', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('disk read error'));
    expect(await readImportPairingMirror('coach-1')).toBeNull();
    spy.mockRestore();
  });
});
