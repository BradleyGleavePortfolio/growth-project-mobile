/**
 * importOfferDecision — account scoping and hostile-payload discard (UX-01).
 *
 * The record exists so the Roman import offer is asked once per account and
 * "Later" / "I am starting fresh" survive a relaunch. These tests pin the
 * properties that make it safe to trust on the next Home entry:
 *   1. it round-trips exactly and the latest answer wins,
 *   2. it is keyed per coach, so a second coach on a shared device can never
 *      read (or clear) the first coach's answer,
 *   3. anything that is not a well-formed, current-version, known-valued,
 *      same-coach record is DISCARDED and its key deleted — never half-trusted,
 *      and an unknown answer is never coerced into a known one,
 *   4. storage failures are truthful: a failed write throws, a failed read is
 *      "no answer" (re-offer), a failed clear is logged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  IMPORT_OFFER_DECISIONS,
  IMPORT_OFFER_DECISION_KEY_PREFIX,
  IMPORT_OFFER_DECISION_VERSION,
  clearImportOfferDecision,
  importOfferDecisionKey,
  isImportOfferDecision,
  readImportOfferDecision,
  writeImportOfferDecision,
  type PersistedImportOfferDecision,
} from '../importOfferDecision';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));

function record(over: Partial<PersistedImportOfferDecision> = {}): PersistedImportOfferDecision {
  return {
    version: IMPORT_OFFER_DECISION_VERSION,
    userId: 'coach-1',
    decision: 'later',
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('key shape', () => {
  it('namespaces by coach id under the swept prefix', () => {
    expect(importOfferDecisionKey('coach-1')).toBe(
      `${IMPORT_OFFER_DECISION_KEY_PREFIX}coach-1`,
    );
  });

  it('the prefix ends in a colon so a sweep cannot bleed into similar keys', () => {
    expect(IMPORT_OFFER_DECISION_KEY_PREFIX.endsWith(':')).toBe(true);
  });
});

describe('decision vocabulary', () => {
  it('accepts exactly the three canonical answers', () => {
    expect([...IMPORT_OFFER_DECISIONS]).toEqual(['yes', 'later', 'starting_fresh']);
    for (const d of IMPORT_OFFER_DECISIONS) expect(isImportOfferDecision(d)).toBe(true);
  });

  it.each<[unknown]>([['declined'], ['YES'], ['complete'], [''], [1], [null], [undefined], [{}]])(
    'rejects %p',
    (value) => {
      expect(isImportOfferDecision(value)).toBe(false);
    },
  );
});

describe('round trip', () => {
  it('returns the persisted answer and stores version + owner alongside it', async () => {
    await writeImportOfferDecision('coach-1', 'later');
    expect(await readImportOfferDecision('coach-1')).toBe('later');
    const raw = await AsyncStorage.getItem(importOfferDecisionKey('coach-1'));
    expect(JSON.parse(raw as string)).toEqual(record({ decision: 'later' }));
  });

  it('stores no timestamp or cadence field (no client clock decides anything)', async () => {
    await writeImportOfferDecision('coach-1', 'starting_fresh');
    const raw = await AsyncStorage.getItem(importOfferDecisionKey('coach-1'));
    expect(Object.keys(JSON.parse(raw as string)).sort()).toEqual(
      ['decision', 'userId', 'version'],
    );
  });

  it('returns null when the coach has not answered', async () => {
    expect(await readImportOfferDecision('coach-1')).toBeNull();
  });

  it('the latest answer wins (later, then yes)', async () => {
    await writeImportOfferDecision('coach-1', 'later');
    await writeImportOfferDecision('coach-1', 'yes');
    expect(await readImportOfferDecision('coach-1')).toBe('yes');
  });

  it('clear is idempotent and leaves nothing behind', async () => {
    await writeImportOfferDecision('coach-1', 'later');
    await clearImportOfferDecision('coach-1');
    await clearImportOfferDecision('coach-1');
    expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
    expect(await readImportOfferDecision('coach-1')).toBeNull();
  });
});

describe('user scoping', () => {
  it('never hands one coach another coach\'s answer', async () => {
    await writeImportOfferDecision('coach-1', 'starting_fresh');
    await writeImportOfferDecision('coach-2', 'later');
    expect(await readImportOfferDecision('coach-1')).toBe('starting_fresh');
    expect(await readImportOfferDecision('coach-2')).toBe('later');
    expect(await readImportOfferDecision('coach-3')).toBeNull();
  });

  it('clearing one coach leaves the other coach\'s answer intact', async () => {
    await writeImportOfferDecision('coach-1', 'later');
    await writeImportOfferDecision('coach-2', 'later');
    await clearImportOfferDecision('coach-1');
    expect(await readImportOfferDecision('coach-1')).toBeNull();
    expect(await readImportOfferDecision('coach-2')).toBe('later');
  });

  it('discards a payload whose userId disagrees with its own key', async () => {
    // A hand-edited or migrated record. Reconciling it would show coach-1 a
    // card that reflects coach-2's answer.
    await AsyncStorage.setItem(
      importOfferDecisionKey('coach-1'),
      JSON.stringify(record({ userId: 'coach-2' })),
    );
    expect(await readImportOfferDecision('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
  });
});

describe('malformed payloads are discarded, not half-trusted', () => {
  it.each<[string, string]>([
    ['unparseable JSON', '{not json'],
    ['a JSON primitive', '"later"'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['an array', '["later"]'],
  ])('discards %s and deletes the key', async (_label, raw) => {
    await AsyncStorage.setItem(importOfferDecisionKey('coach-1'), raw);
    expect(await readImportOfferDecision('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['a future schema version', { version: IMPORT_OFFER_DECISION_VERSION + 1 }],
    ['a past schema version', { version: 0 }],
    ['a string version', { version: String(IMPORT_OFFER_DECISION_VERSION) }],
    ['an empty user id', { userId: '' }],
    ['an unknown decision value', { decision: 'declined' }],
    ['a wrongly-cased decision value', { decision: 'Later' }],
    ['a non-string decision', { decision: 1 }],
  ])('discards %s and deletes the key', async (_label, over) => {
    await AsyncStorage.setItem(
      importOfferDecisionKey('coach-1'),
      JSON.stringify({ ...record(), ...over }),
    );
    expect(await readImportOfferDecision('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
  });

  it.each(['version', 'userId', 'decision'])('discards a record missing %s', async (field) => {
    const partial: Record<string, unknown> = { ...record() };
    delete partial[field];
    await AsyncStorage.setItem(importOfferDecisionKey('coach-1'), JSON.stringify(partial));
    expect(await readImportOfferDecision('coach-1')).toBeNull();
    expect(await AsyncStorage.getItem(importOfferDecisionKey('coach-1'))).toBeNull();
  });
});

describe('storage failures are truthful', () => {
  it('a failed write throws rather than pretending the answer is on disk', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(writeImportOfferDecision('coach-1', 'later')).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }
    expect(await readImportOfferDecision('coach-1')).toBeNull();
  });

  it('a failed read is "no answer", never a fabricated one, and does not delete the key', async () => {
    await writeImportOfferDecision('coach-1', 'starting_fresh');
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
    try {
      expect(await readImportOfferDecision('coach-1')).toBeNull();
    } finally {
      spy.mockRestore();
    }
    // The record itself was not touched by the failed read.
    expect(await readImportOfferDecision('coach-1')).toBe('starting_fresh');
  });

  it('a failed clear is logged, not thrown', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('io'));
    try {
      await expect(clearImportOfferDecision('coach-1')).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
