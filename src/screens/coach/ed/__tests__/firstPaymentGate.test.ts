/**
 * firstPaymentGate — ED.3 MMKV once-only gate evidence.
 *
 * Proves the once-only contract directly at the storage seam (the gate the
 * Wow-screen owner consults): the FIRST consult is "unseen" → the celebration
 * may fire; after `markFirstPaymentSeen`, EVERY subsequent consult is "seen" →
 * a re-open / re-subscribe / duplicate INSERT is a no-op. The key is namespaced
 * per coach so two coaches do not share a gate.
 *
 * The repo's MMKV abstraction falls back to the AsyncStorage shim under Jest
 * (src/storage/mmkv.ts isMmkvAvailable() returns false in NODE_ENV=test), and
 * AsyncStorage is mocked globally (jest.setup.js), so these assertions exercise
 * the SAME async get/set surface the device MMKV instance presents.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  firstPaymentSeenKey,
  hasSeenFirstPayment,
  markFirstPaymentSeen,
} from '../firstPaymentGate';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('firstPaymentGate — once-only MMKV gate', () => {
  it('uses the per-coach key shape from the brief', () => {
    expect(firstPaymentSeenKey('coach-123')).toBe(
      'roman.ed3.first-payment-seen.coach-123',
    );
  });

  it('first open is UNSEEN; after marking, the second open is a NO-OP (seen)', async () => {
    const coachId = 'coach-abc';

    // First consult — the gate is open, so the celebration may fire.
    expect(await hasSeenFirstPayment(coachId)).toBe(false);

    // The Wow screen is dismissed → the gate closes.
    await markFirstPaymentSeen(coachId);

    // Second open (app relaunch / re-subscribe / duplicate INSERT) — no-op.
    expect(await hasSeenFirstPayment(coachId)).toBe(true);
    // Third, to prove it stays closed.
    expect(await hasSeenFirstPayment(coachId)).toBe(true);
  });

  it('is idempotent — marking twice keeps the gate closed', async () => {
    const coachId = 'coach-idem';
    await markFirstPaymentSeen(coachId);
    await markFirstPaymentSeen(coachId);
    expect(await hasSeenFirstPayment(coachId)).toBe(true);
  });

  it('gates per coach — one coach being seen does not close another coach', async () => {
    await markFirstPaymentSeen('coach-1');
    expect(await hasSeenFirstPayment('coach-1')).toBe(true);
    expect(await hasSeenFirstPayment('coach-2')).toBe(false);
  });

  it('treats an empty coach id as already-seen (never shows)', async () => {
    expect(await hasSeenFirstPayment('')).toBe(true);
  });
});
