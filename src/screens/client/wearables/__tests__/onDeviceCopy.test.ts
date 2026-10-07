/**
 * S14 round 3 — on-device connect/refresh copy (owner error-copy rule).
 * Every failure says what happened and a working next action; known statuses
 * and machine codes get their own copy; unexpected failures carry a short
 * reference, a support path, and a Sentry report.
 */

import { AxiosError, AxiosHeaders } from 'axios';

const mockReportUnexpected = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReportUnexpected(...args),
}));

import {
  WEARABLES_SUPPORT_EMAIL,
  cloudConnectFailureMessage,
  cloudSessionLockedMessage,
  connectFailureMessage,
  ctaLabelFor,
  emptyImportMessage,
  notSyncingHereCopy,
  partialImportMessage,
  permissionOutcomeMessage,
  returnFromSettingsMessage,
  settingsDidNotOpenMessage,
  INGEST_DISABLED_COPY,
} from '../onDeviceCopy';
import { disconnectFailureMessage } from '../disconnectCopy';
import { SUPPORT_EMAIL } from '../../../../constants/support';
import {
  OnDeviceNotSignedInError,
  OnDeviceStepError,
} from '../../../../services/health/onDeviceSync';
import { OnDeviceSessionChangedError } from '../../../../services/health/sessionFence';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnavailableError,
} from '../../../../services/health/healthConnect/errors';

function httpError(status: number, data: unknown, requestId?: string): AxiosError {
  return new AxiosError('http', String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: new AxiosHeaders(requestId ? { 'x-request-id': requestId } : {}),
    config: { headers: new AxiosHeaders() },
    data,
  });
}

const networkError = () =>
  new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() });

beforeEach(() => mockReportUnexpected.mockReset());

const BANNED = [/Something went wrong/i, /^Please try again\.?$/i, /!/];

function expectPlain(text: string) {
  for (const re of BANNED) expect(text).not.toMatch(re);
}

describe('connectFailureMessage', () => {
  it('says nothing when the run was cancelled by closing the sheet', () => {
    expect(
      connectFailureMessage(new OnDeviceSessionChangedError('cancelled'), 'Apple Health'),
    ).toBeNull();
  });

  it('explains an account change and offers Continue', () => {
    const m = connectFailureMessage(new OnDeviceSessionChangedError(), 'Apple Health');
    expect(m?.action).toBe('connect');
    expect(m?.text).toMatch(/signed-in account changed/);
  });

  it('routes a signed-out person to Log in again', () => {
    const m = connectFailureMessage(new OnDeviceNotSignedInError(), 'Apple Health');
    expect(m?.action).toBe('login');
    expect(m?.text).toMatch(/Log in again/);
  });

  it.each([
    [
      new OnDeviceStepError('register', networkError()),
      'connect',
      /The Growth Project couldn't be reached/,
    ],
    [new OnDeviceStepError('import', networkError()), 'resume', /connection dropped/],
    [new OnDeviceStepError('import', httpError(401, {})), 'login', /session ended/],
    [new OnDeviceStepError('register', httpError(401, {})), 'login', /session has ended/],
    [
      new OnDeviceStepError('import', httpError(403, { code: 'wearables_connection_forbidden' })),
      'connect',
      /no longer linked to your account/,
    ],
    [
      new OnDeviceStepError('register', httpError(403, { code: 'forbidden' })),
      'none',
      /client account only/,
    ],
    [new OnDeviceStepError('import', httpError(429, {})), 'resume', /too many requests/],
    [
      new OnDeviceStepError('import', new HealthConnectPermissionDeniedError(['Steps'])),
      'open_settings',
      /access is turned off for The Growth Project/,
    ],
    [
      new OnDeviceStepError('import', new HealthConnectUnavailableError()),
      'resume',
      /Health Connect isn't ready/,
    ],
  ])('maps %p to its own copy', (err, action, re) => {
    const m = connectFailureMessage(err, 'Health Connect');
    expect(m?.action).toBe(action);
    expect(m?.text).toMatch(re);
    expectPlain(m?.text ?? '');
    expect(mockReportUnexpected).not.toHaveBeenCalled();
  });

  it('unexpected server failure: server reference, support path, Sentry report', () => {
    const m = connectFailureMessage(
      new OnDeviceStepError('import', httpError(500, {}, 'abcdef12-3456-7890')),
      'Apple Health',
    );
    expect(m?.text).toContain('Reference abcdef12.');
    expect(m?.text).toContain(WEARABLES_SUPPORT_EMAIL);
    expectPlain(m?.text ?? '');
    expect(mockReportUnexpected).toHaveBeenCalledWith(
      'wearables.on_device_connect',
      expect.objectContaining({ status: 500, requestId: 'abcdef12-3456-7890' }),
    );
  });

  it('unexpected local failure still gets a reference that is sent to Sentry', () => {
    const m = connectFailureMessage(new Error('boom'), 'Apple Health');
    const ref = /Reference ([A-Za-z0-9-]{1,8})\./.exec(m?.text ?? '')?.[1];
    expect(ref).toBeTruthy();
    const reported = mockReportUnexpected.mock.calls[0][1] as { requestId: string };
    expect(reported.requestId.startsWith(ref ?? 'x')).toBe(true);
    // No error message or health value is ever put into the report.
    expect(JSON.stringify(mockReportUnexpected.mock.calls)).not.toContain('boom');
  });
});

describe('other copy', () => {
  it('partial import offers Continue import, all-failed offers Try again', () => {
    const partial = partialImportMessage('Apple Health', {
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c',
      postedCount: 4,
      complete: false,
    });
    expect(partial.action).toBe('resume');
    expect(partial.text).toMatch(/Continue import/);
    const none = partialImportMessage('Apple Health', {
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c',
      postedCount: 0,
      complete: false,
    });
    expect(none.text).toMatch(/Try again/);
    expectPlain(partial.text);
    expectPlain(none.text);
  });

  it('not syncing here and lane-off copy are plain', () => {
    expect(notSyncingHereCopy('Apple Health')).toBe(
      'Apple Health is not syncing on this phone. Tap Reconnect to continue.',
    );
    expectPlain(INGEST_DISABLED_COPY);
  });
});

/** No first person in client-facing error copy (owner bar, agent 113). */
const FIRST_PERSON = /\b(we|we've|we'll|we're|us|our)\b/i;

describe('S-WEAR-3: support address and plain, third-person copy', () => {
  it('uses the one app support address (S-ERRORS #324)', () => {
    expect(WEARABLES_SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
  });

  it('no message says we / us / our', () => {
    const texts: string[] = [];
    const errs: unknown[] = [
      new OnDeviceSessionChangedError(),
      new OnDeviceNotSignedInError(),
      new OnDeviceStepError('register', networkError()),
      new OnDeviceStepError('import', networkError()),
      new OnDeviceStepError('import', httpError(429, {})),
      new OnDeviceStepError('register', httpError(429, {})),
      new OnDeviceStepError('import', httpError(500, {})),
      new OnDeviceStepError('register', httpError(500, {})),
    ];
    for (const e of errs) texts.push(connectFailureMessage(e, 'Apple Health')?.text ?? '');
    for (const status of [401, 403, 429, 500]) {
      texts.push(cloudConnectFailureMessage(httpError(status, {}), 'Oura').text);
    }
    texts.push(cloudConnectFailureMessage(networkError(), 'Oura').text);
    texts.push(cloudConnectFailureMessage(new Error('x'), 'Oura').text);
    for (const o of ['denied', 'unavailable', 'update_required', 'unsupported', 'error'] as const) {
      for (const p of ['APPLE_HEALTHKIT', 'HEALTH_CONNECT', 'SAMSUNG_HEALTH'] as const) {
        texts.push(permissionOutcomeMessage(o, p, 'X').text);
      }
    }
    texts.push(emptyImportMessage('APPLE_HEALTHKIT', 'Apple Health').text);
    texts.push(emptyImportMessage('HEALTH_CONNECT', 'Health Connect').text);
    texts.push(settingsDidNotOpenMessage('settings', 'Health Connect').text);
    texts.push(settingsDidNotOpenMessage('store', 'Health Connect').text);
    texts.push(returnFromSettingsMessage('Health Connect').text);
    texts.push(cloudSessionLockedMessage('Oura').text);
    for (const status of [null, 401, 403, 404, 429, 500]) {
      const err = status === null ? networkError() : httpError(status, {});
      texts.push(disconnectFailureMessage(err, 'Oura').text);
    }
    for (const t of texts) {
      expect(t).not.toMatch(FIRST_PERSON);
      expectPlain(t);
      expect(t).not.toContain('hello@thegrowthproject.app');
    }
  });
});

describe('Sol B-317-8: cloudConnectFailureMessage', () => {
  it.each([
    [null, {}, 'connect', /couldn't be reached.*internet/],
    [401, {}, 'login', /session has ended/],
    [403, {}, 'none', /client account only/],
    [429, {}, 'connect', /Too many tries/],
    [503, { code: 'wearables_cloud_disabled' }, 'none', /is not available in this version/],
  ])('status %p maps to its own copy, never to Sentry', (status, data, action, re) => {
    const err = status === null ? networkError() : httpError(status as number, data);
    const m = cloudConnectFailureMessage(err, 'Oura');
    expect(m.action).toBe(action);
    expect(m.text).toMatch(re);
    expect(mockReportUnexpected).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 400])('status %p: reference, support address, Sentry; no internet advice', (status) => {
    const m = cloudConnectFailureMessage(httpError(status, {}, '99887766-aaaa'), 'Oura');
    expect(m.text).toContain('Reference 99887766.');
    expect(m.text).toContain(WEARABLES_SUPPORT_EMAIL);
    expect(m.text).not.toMatch(/internet/);
    expect(mockReportUnexpected).toHaveBeenCalledWith(
      'wearables.cloud_connect',
      expect.objectContaining({ status, requestId: '99887766-aaaa' }),
    );
  });
});

describe('S-WEAR-3: permission states', () => {
  it('Health Connect refusal opens its permissions; Apple Health refusal re-runs Continue', () => {
    expect(permissionOutcomeMessage('denied', 'HEALTH_CONNECT', 'Health Connect').action).toBe('open_settings');
    expect(permissionOutcomeMessage('denied', 'SAMSUNG_HEALTH', 'Samsung Health').action).toBe('open_settings');
    expect(permissionOutcomeMessage('denied', 'APPLE_HEALTHKIT', 'Apple Health').action).toBe('connect');
  });

  it('missing vs outdated Health Connect get their own button', () => {
    const missing = permissionOutcomeMessage('unavailable', 'HEALTH_CONNECT', 'Health Connect');
    const outdated = permissionOutcomeMessage('update_required', 'HEALTH_CONNECT', 'Health Connect');
    expect(missing.action).toBe('open_store');
    expect(ctaLabelFor(missing)).toBe('Get Health Connect');
    expect(ctaLabelFor(outdated)).toBe('Update Health Connect');
    expect(missing.text).not.toBe(outdated.text);
  });

  it('a native error is reported with a reference and no health data', () => {
    const m = permissionOutcomeMessage('error', 'APPLE_HEALTHKIT', 'Apple Health');
    expect(m.text).toMatch(/mention reference [A-Za-z0-9-]{8}\./);
    expect(mockReportUnexpected).toHaveBeenCalledWith(
      'wearables.on_device_permission',
      expect.objectContaining({ status: null, code: 'native_permission_error' }),
    );
  });

  it('default button labels', () => {
    expect(ctaLabelFor({ action: 'connect' })).toBe('Continue');
    expect(ctaLabelFor({ action: 'resume' })).toBe('Try again');
    expect(ctaLabelFor({ action: 'login' })).toBe('Log in again');
    expect(ctaLabelFor({ action: 'open_settings' })).toBe('Open Health Connect');
  });
});
