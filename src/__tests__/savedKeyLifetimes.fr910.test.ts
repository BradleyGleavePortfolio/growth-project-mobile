/**
 * FR-910: the lifetime half of KT-13 reports a broken lifetime. Each case breaks one thing in the storage
 * double or a reader for its own run only, then checks lifetimeFindings() names that key and rule. The
 * imported contract runs first with nothing broken.
 */
jest.mock('../storage/autosaveMirror', () => {
  const actual = jest.requireActual<typeof import('../storage/autosaveMirror')>('../storage/autosaveMirror');
  return { ...actual, readAutosaveMirror: jest.fn(actual.readAutosaveMirror) };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { readAutosaveMirror } from '../storage/autosaveMirror';
import { READERS } from '../../test/savedKeyLifetimes/savedKeyReaders';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const actualRead = jest.requireActual<typeof import('../storage/autosaveMirror')>('../storage/autosaveMirror')
  .readAutosaveMirror;
const removeMany = AsyncStorage.removeMany.bind(AsyncStorage);
const names = (found: string[], key: string, life: string, rule: string) =>
  found.filter((f) => f.includes(`'${key}' (${life}) breaks ${rule}:`));

describe('FR-910 the lifetime case reports a broken lifetime', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('an ACCOUNT key left on the phone with another value is reported (gone means absent)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeMany').mockImplementation(async (keys) => {
      await removeMany(keys);
      if (keys.includes('pending_invite_code')) await AsyncStorage.setItem('pending_invite_code', 'another-value');
    });
    try {
      expect(names(await lifetimeFindings(), 'pending_invite_code', 'ACCOUNT', 'signout')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a queue its reader no longer brings back after a restart is reported', async () => {
    jest.mocked(readAutosaveMirror).mockImplementation(async () => null);
    try {
      const found = await lifetimeFindings();
      expect(names(found, 'mwb_autosave_mirror:*', 'QUEUE', 'restart')).toHaveLength(1);
      expect(found.join('\n')).toContain("After a restart the app's reader does not bring it back.");
    } finally {
      jest.mocked(readAutosaveMirror).mockImplementation(actualRead);
    }
  });

  it("an unkeyed queue that sign out keeps is reported for the next account", async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeMany')
      .mockImplementation((keys) => removeMany(keys.filter((k) => k !== 'pending_food_logs_anonymous')));
    try {
      const found = await lifetimeFindings();
      expect(names(found, 'pending_food_logs_anonymous', 'QUEUE', 'keyed')).toHaveLength(1);
      expect(found.join('\n')).toContain("A's unsent work is still there for the next account.");
    } finally {
      spy.mockRestore();
    }
  });

  it('a mark the deletion path leaves with another value is reported (absence)', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeMany').mockImplementation(async (keys) => {
      await removeMany(keys);
      const left = keys.filter((k) => k.startsWith('roman_join_offer:'));
      for (const k of left) await AsyncStorage.setItem(k, 'another-value');
    });
    try {
      expect(names(await lifetimeFindings(), 'roman_join_offer:{uid}', 'MARK', 'deletion')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a QUEUE row with no reader entry fails closed', async () => {
    const saved = READERS['async coach_consult_v1:{uid}'];
    delete READERS['async coach_consult_v1:{uid}'];
    try {
      const found = names(await lifetimeFindings(), 'coach_consult_v1:{uid}', 'QUEUE', 'restart');
      expect(found).toHaveLength(1);
      expect(found[0]).toContain('No reader for it');
    } finally {
      READERS['async coach_consult_v1:{uid}'] = saved;
    }
  });
});
