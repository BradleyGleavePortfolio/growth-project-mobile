/**
 * featureFlagsApi — wire-contract / drift tests for GET /me/feature-flags.
 *
 * Mirrors the test seam from communityEventsApi.drift.test.ts (strict schema
 * drift) and coachAiBudgetApi.contract.test.ts (backend DTO parity), but drives
 * the assertions through the public `featureFlagsApi.getFeatureFlags()` call so
 * the boundary wrapping (ZodError → CommunityApiError{kind:'contract'}) is also
 * pinned, not just the schema in isolation.
 *
 * The backend contract (do NOT drift — see featureFlagsApi.ts header):
 *   200 { flags: { [name: string]: boolean }, evaluated_at: ISO8601 }  (.strict())
 *
 * A drifted shape (bad timestamp, extra top-level key, non-boolean flag value)
 * must THROW a `contract` CommunityApiError carrying status 200 here, rather
 * than feeding a malformed flag map into the app. A valid shape resolves to the
 * parsed value.
 */

import { featureFlagsApi } from '../featureFlagsApi';
import { CommunityApiError } from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
});

/**
 * Drive a single getFeatureFlags() call (the mock is `*Once`, so exactly one
 * invocation) and capture whatever it throws, so a test can assert the error's
 * constructor + kind + status without re-invoking and exhausting the mock.
 */
async function captureError(): Promise<unknown> {
  try {
    await featureFlagsApi.getFeatureFlags();
  } catch (err) {
    return err;
  }
  throw new Error('expected getFeatureFlags() to reject, but it resolved');
}

/** A canonical, backend-shaped valid response (every field present + valid). */
function validResponse(): Record<string, unknown> {
  return {
    flags: {
      community_search: true,
      coach_community_wearable_prompts: false,
      community_classroom: true,
      community_events: false,
    },
    evaluated_at: '2026-06-01T12:00:00.000Z',
  };
}

describe('featureFlagsApi.getFeatureFlags — wire contract for GET /me/feature-flags', () => {
  it('(a) throws a contract CommunityApiError (status 200) on a non-ISO evaluated_at', async () => {
    api.get.mockResolvedValueOnce({
      data: { ...validResponse(), evaluated_at: 'not-a-date' },
    });
    const err = await captureError();
    expect(err).toBeInstanceOf(CommunityApiError);
    expect(err).toMatchObject({ kind: 'contract', status: 200 });
  });

  it('(b) throws a contract CommunityApiError (status 200) on an unexpected extra top-level key', async () => {
    api.get.mockResolvedValueOnce({
      data: { ...validResponse(), surprise_field: 'nope' },
    });
    const err = await captureError();
    expect(err).toBeInstanceOf(CommunityApiError);
    expect(err).toMatchObject({ kind: 'contract', status: 200 });
  });

  it('(c) throws a contract CommunityApiError (status 200) on a non-boolean flag value', async () => {
    api.get.mockResolvedValueOnce({
      data: { flags: { x: 'true' }, evaluated_at: '2026-06-01T12:00:00.000Z' },
    });
    const err = await captureError();
    expect(err).toBeInstanceOf(CommunityApiError);
    expect(err).toMatchObject({ kind: 'contract', status: 200 });
  });

  it('(d) resolves with the parsed value on a valid ISO8601 + boolean flag map', async () => {
    const valid = validResponse();
    api.get.mockResolvedValueOnce({ data: valid });
    await expect(featureFlagsApi.getFeatureFlags()).resolves.toEqual(valid);
  });
});
