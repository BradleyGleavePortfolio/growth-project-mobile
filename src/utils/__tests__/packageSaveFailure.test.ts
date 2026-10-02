// #321 fix round (Sol B-321-1): package save failure mapper.
const mockCaptureError = jest.fn();
jest.mock('../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import { describePackageSaveFailure } from '../packageSaveFailure';

const http = (status: number, data: unknown, headers?: Record<string, string>) => ({
  response: { status, data, headers },
});

beforeEach(() => mockCaptureError.mockClear());

describe('describePackageSaveFailure', () => {
  it('maps each status and machine code to a specific message and next action', () => {
    const cases: Array<[unknown, string, string]> = [
      [{ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' }, 'network', 'retry'],
      [{ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, 'timeout', 'retry'],
      [http(401, { message: 'Unauthorized' }), 'session', 'sign_in'],
      [http(403, { error: 'SUBSCRIPTION_INACTIVE', message: 'inactive' }), 'subscription', 'billing'],
      [http(403, { code: 'TIER_UPGRADE_REQUIRED', error: 'Forbidden', message: 'upgrade' }), 'subscription', 'billing'],
      [http(403, { message: 'Coach or owner access required', error: 'Forbidden' }), 'forbidden', 'back_to_packages'],
      [http(404, { code: 'PACKAGE_NOT_FOUND', message: 'No package with id x' }), 'not_found', 'back_to_packages'],
      [http(409, { code: 'PACKAGE_PRICING_LOCKED', message: 'locked' }), 'locked', 'new_package'],
      [http(409, { code: 'PACKAGE_ARCHIVED', message: 'archived' }), 'archived', 'back_to_packages'],
      [http(503, { error: 'PACKAGES_NOT_CONFIGURED', message: 'x' }), 'not_configured', 'back_to_packages'],
      [http(400, { code: 'PACKAGE_PRICE_BELOW_MINIMUM', error: 'Bad Request', message: 'Paid packages start at $19.99, or make it free.' }), 'price', 'fix_price'],
      [http(400, { code: 'PACKAGE_RECURRING_PRICE_BELOW_MINIMUM', message: 'The recurring price starts at $19.99.' }), 'price', 'fix_price'],
      [http(400, { code: 'PACKAGE_FREE_MUST_BE_ONE_TIME', message: '' }), 'price', 'fix_price'],
      [http(400, { code: 'PACKAGE_INVALID', message: 'Trial days must be between 0 and 365.' }), 'invalid', 'fix_input'],
      [http(400, { message: ['amount_cents must be a whole number of cents (0 for a free package)'], error: 'Bad Request' }), 'invalid', 'fix_input'],
      [http(429, { message: 'ThrottlerException: Too Many Requests' }), 'rate_limited', 'wait'],
      [http(500, { request_id: 'req-123' }), 'server', 'retry'],
      [http(502, 'Bad gateway'), 'server', 'retry'],
      [new Error('boom'), 'server', 'retry'],
    ];
    for (const [err, kind, action] of cases) {
      const f = describePackageSaveFailure(err, 'update');
      expect([f.kind, f.action]).toEqual([kind, action]);
      expect(f.message.length).toBeGreaterThan(20);
      expect(f.message).not.toMatch(/Something went wrong/i);
      expect(f.message).not.toMatch(/^Please try again\.?$/);
      expect(f.message).not.toContain('!');
    }
  });

  it('keeps the backend floor copy, and falls back to the owner copy when it is missing', () => {
    expect(
      describePackageSaveFailure(http(400, { code: 'PACKAGE_FREE_MUST_BE_ONE_TIME', message: 'Bad Request' }), 'create')
        .message,
    ).toBe('Free packages are one-time. Switch billing to One-time, or set a price of $19.99 or more.');
    expect(
      describePackageSaveFailure(http(400, { code: 'PACKAGE_PRICE_BELOW_MINIMUM' }), 'create').message,
    ).toBe('Paid packages start at $19.99, or make it free.');
  });

  it('unknown failures: reference from body request_id, then x-request-id, then a local id; reported to Sentry once', () => {
    const a = describePackageSaveFailure(http(500, { request_id: 'sol321-reference' }), 'create');
    expect(a.reference).toBe('SOL321RE');
    expect(a.support).toBe(true);
    expect(a.message).toBe(
      'The package was not created. There was a problem on our side. Your changes are still here. Tap Try again, or contact support and quote reference SOL321RE.',
    );
    expect(mockCaptureError).toHaveBeenLastCalledWith(expect.any(Error), {
      flow: 'package_save',
      mode: 'create',
      status: 500,
      code: null,
      reference: 'sol321-reference',
    });
    const b = describePackageSaveFailure(http(503, {}, { 'X-Request-Id': 'abcd-efgh-ijkl' }), 'update');
    expect(b.reference).toBe('ABCDEFGH');
    const c = describePackageSaveFailure(http(500, {}), 'update');
    expect(c.reference).toMatch(/^[A-Z0-9]{8}$/);
    expect(mockCaptureError).toHaveBeenCalledTimes(3);
  });

  it('known failures are not reported to Sentry and carry no reference', () => {
    for (const err of [
      http(401, {}),
      http(404, { code: 'PACKAGE_NOT_FOUND' }),
      http(400, { code: 'PACKAGE_PRICE_BELOW_MINIMUM' }),
      { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' },
    ]) {
      expect(describePackageSaveFailure(err, 'update').reference).toBeNull();
    }
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('the Sentry context never carries the request body, prices or headers', () => {
    describePackageSaveFailure(
      {
        response: { status: 500, data: { request_id: 'r1', message: 'x' } },
        config: { data: '{"amount_cents":1999,"title":"Secret plan"}', headers: { Authorization: 'Bearer tok' } },
      },
      'update',
    );
    const ctx = JSON.stringify(mockCaptureError.mock.calls[0][1]);
    expect(ctx).not.toMatch(/1999|Secret plan|Bearer/);
  });

  // S-FEE round 4 (#321 C-321-2).
  it('a 400 without PACKAGE_INVALID shows the fallback, never raw validator text', () => {
    const raw = [
      http(400, { message: ['property price should not exist'], error: 'Bad Request', statusCode: 400 }),
      http(400, { message: 'currency must be one of the following values: usd, gbp', error: 'Bad Request' }),
      http(400, { message: 'Validation failed (uuid is expected)', code: 'SOMETHING_ELSE' }),
    ];
    for (const err of raw) {
      const f = describePackageSaveFailure(err, 'create');
      expect(f.kind).toBe('invalid');
      expect(f.action).toBe('fix_input');
      expect(f.message).toBe(
        'One of the details is not valid. Check the name, price and billing, then save the package.',
      );
      expect(f.message).not.toMatch(/should not exist|must be one of|uuid/);
    }
  });

  // S-FEE round 5 (#321 Opus C-321-3, backend Sol C-629-4): the backend's
  // PACKAGE_INVALID text names API fields, so it is never shown as is.
  it('PACKAGE_INVALID is shown in plain words chosen by the field, never the API text', () => {
    const cases: Array<[string, 'create' | 'update' | 'publish' | 'unpublish', string]> = [
      [
        'recurring packages require interval = week | month | year',
        'publish',
        'Choose how clients pay: One-time, Monthly, Quarterly or Yearly, then publish the package.',
      ],
      [
        'amount_cents must be a whole number of cents, for example 1999 for $19.99.',
        'create',
        'Enter the price in dollars and cents, for example 19.99, or 0 to make it free, then save the package.',
      ],
      ['name is required', 'create', 'Give the package a name of 120 characters or fewer, then save the package.'],
      [
        'name must be shorter than or equal to 120 characters. name must be a string.',
        'update',
        'Give the package a name of 120 characters or fewer, then save the package.',
      ],
      [
        'currency must be a 3-letter ISO code',
        'create',
        'This package uses a currency the app cannot sell in. The package was not created. Contact support and we will fix the package.',
      ],
      [
        'interval_count must be an integer ≥ 1',
        'update',
        'Choose how clients pay: One-time, Monthly, Quarterly or Yearly, then save the package.',
      ],
      [
        'Check foo_bar and save again.',
        'unpublish',
        'One of the details is not valid. Check the name, price and billing, then unpublish the package.',
      ],
    ];
    for (const [message, mode, expected] of cases) {
      const f = describePackageSaveFailure(
        http(400, { code: 'PACKAGE_INVALID', error: 'PACKAGE_INVALID', message }),
        mode,
      );
      expect([f.kind, f.action, f.title]).toEqual(['invalid', 'fix_input', 'Check the package details']);
      expect(f.message).toBe(expected);
      expect(f.message).not.toMatch(/_|\||=|≥/);
    }
  });

  it('failure titles name the action that was tried (C-321-4)', () => {
    const titles = (['create', 'update', 'publish', 'unpublish'] as const).map(
      (mode) => describePackageSaveFailure(http(500, { request_id: 'r-1' }), mode).title,
    );
    expect(titles).toEqual([
      'Could not create the package',
      'Could not save the package',
      'Could not publish the package',
      'Could not unpublish the package',
    ]);
    expect(describePackageSaveFailure(http(429, {}), 'publish').title).toBe('Too many tries');
    expect(describePackageSaveFailure(http(429, {}), 'update').title).toBe('Too many saves');
  });

  it('publish and unpublish failures name the action that did not happen', () => {
    const below = describePackageSaveFailure(
      http(400, { code: 'PACKAGE_PRICE_BELOW_MINIMUM', message: 'Paid packages start at $19.99, or make it free.' }),
      'publish',
    );
    expect([below.kind, below.action]).toEqual(['price', 'fix_price']);
    expect(below.message).toBe('Paid packages start at $19.99, or make it free.');
    const offline = describePackageSaveFailure(
      { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' },
      'publish',
    );
    expect(offline.message).toMatch(/The package is not on sale yet\./);
    const session = describePackageSaveFailure(http(401, {}), 'unpublish');
    expect(session.message).toMatch(/The package is still on sale\. Sign in again, then unpublish the package\./);
  });
});
