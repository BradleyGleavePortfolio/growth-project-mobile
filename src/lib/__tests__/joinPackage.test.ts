/**
 * B-PACKAGE-135: every coach code carries one package (backend b#902). The
 * accept points hand their response to presentJoinFrom; a paid join is kept
 * until it is paid; older backends (no join) change nothing; the checkout
 * carries join_code on both intents.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingJoin,
  joinOutcomeOf,
  presentJoinFrom,
  readPendingJoin,
  subscribeJoin,
  takePresentedJoin,
  type JoinOutcome,
} from '../joinPackage';
import { readInviteAttachOutcome } from '../inviteAttachOutcome';
import { createPackagePaymentIntent, createSubscriptionIntent } from '../packagePayment';

const mockPost = jest.fn();
jest.mock('../../services/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockPost(...a) } }));

function joinFixture(over: Partial<JoinOutcome> = {}): JoinOutcome {
  return {
    status: 'checkout_required',
    grant_mode: 'none',
    package: {
      id: 'pkg-1', name: 'Strength coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring',
      interval: 'month', interval_count: 1, recurring_amount_cents: null, recurring_interval: null,
      recurring_interval_count: null, trial_days: 0, is_free: false,
    },
    coach: { id: 'coach-1', first_name: 'Bradley' },
    code: 'GP-BRADLEY',
    ...over,
  };
}
const FREE = joinFixture({
  status: 'granted',
  grant_mode: 'free',
  package: { ...joinFixture().package, name: 'Getting started', amount_cents: 0, billing_type: 'one_time', interval: null, is_free: true },
});

beforeEach(async () => {
  jest.clearAllMocks();
  takePresentedJoin();
  await AsyncStorage.clear();
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('reading the join', () => {
  it('reads invite_join (auth routes) and join (attach, coachless redeem); rejects a bad shape', () => {
    expect(joinOutcomeOf({ invite_join: FREE })).toEqual(FREE);
    expect(joinOutcomeOf({ join: joinFixture() })?.status).toBe('checkout_required');
    expect(joinOutcomeOf({ join: { status: 'granted' } })).toBeNull();
    expect(joinOutcomeOf({ coach_id: 'coach-1' })).toBeNull();
  });

  it('a join means the code was accepted, even before a paid package is paid', () => {
    expect(readInviteAttachOutcome({ invite_attached: false, invite_join: joinFixture() }).attached).toBe(true);
    // Older backend, or a refusal: unchanged.
    expect(readInviteAttachOutcome({ invite_attached: false, invite_attach_error: 'code_expired' })).toEqual({
      attached: false,
      reason: 'code_expired',
    });
  });
});

describe('presentJoinFrom', () => {
  it('paid: shown now and kept as the pending join until it is paid', async () => {
    const seen = jest.fn();
    const off = subscribeJoin(seen);
    expect(presentJoinFrom({ coach_id: null, already_attached: false, join: joinFixture() })).toBe(true);
    await settle();
    expect(seen).toHaveBeenCalled();
    expect(takePresentedJoin()?.code).toBe('GP-BRADLEY');
    expect(takePresentedJoin()).toBeNull(); // read once
    expect((await readPendingJoin())?.package.id).toBe('pkg-1');
    await clearPendingJoin();
    expect(await readPendingJoin()).toBeNull();
    off();
  });

  it('free: shown once, nothing kept; a replay of a done join is not shown again', async () => {
    expect(presentJoinFrom({ already_attached: false, invite_join: FREE })).toBe(true);
    expect(takePresentedJoin()?.grant_mode).toBe('free');
    expect(presentJoinFrom({ already_attached: true, join: FREE })).toBe(true);
    expect(takePresentedJoin()).toBeNull();
    await settle();
    expect(await readPendingJoin()).toBeNull();
  });

  it('an older backend (no join) changes nothing', async () => {
    expect(presentJoinFrom({ coach_id: 'coach-1', already_attached: false })).toBe(false);
    expect(presentJoinFrom(undefined)).toBe(false);
    expect(takePresentedJoin()).toBeNull();
    expect(await readPendingJoin()).toBeNull();
  });
});

describe('checkout carries join_code', () => {
  it('payment-intent and subscription-intent send join_code only when given', async () => {
    mockPost.mockResolvedValue({
      data: { client_secret: 'cs', ephemeral_key: 'ek', customer_id: 'cus', mode: 'payment', purchase_id: 'p1' },
    });
    await createPackagePaymentIntent('pkg-1', 'key-1', 'GP-BRADLEY');
    await createPackagePaymentIntent('pkg-1', 'key-2');
    await createSubscriptionIntent('pkg-1', 'key-3', 4900, null, 0, 'GP-BRADLEY');
    expect(mockPost.mock.calls[0][1]).toEqual({ package_id: 'pkg-1', idempotency_key: 'key-1', join_code: 'GP-BRADLEY' });
    expect(mockPost.mock.calls[1][1]).toEqual({ package_id: 'pkg-1', idempotency_key: 'key-2' });
    expect(mockPost.mock.calls[2][1]).toMatchObject({ package_id: 'pkg-1', join_code: 'GP-BRADLEY' });
  });
});
